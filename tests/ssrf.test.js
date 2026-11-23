import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchPublicHtml,
  isBlockedAddress,
  validatePublicUrl
} from '../server/ssrf.js';
import { fakeLookup } from './helpers.js';

test('blocks private, loopback, link-local, and mapped addresses', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.5.4',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1'
  ]) {
    assert.equal(isBlockedAddress(address), true, `${address} should be blocked`);
  }

  for (const address of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isBlockedAddress(address), false, `${address} should be allowed`);
  }
});

test('rejects non-public URLs and credentials', async () => {
  const lookup = fakeLookup({ 'public.example': ['93.184.216.34'] });

  await assert.rejects(() => validatePublicUrl('file:///etc/passwd', { lookup }), /http/i);
  await assert.rejects(() => validatePublicUrl('http://127.0.0.1/', { lookup }), /Private|loopback/i);
  await assert.rejects(() => validatePublicUrl('http://[::1]/', { lookup }), /Private|loopback/i);
  await assert.rejects(() => validatePublicUrl('http://localhost/', { lookup }), /local/i);
  await assert.rejects(
    () => validatePublicUrl('https://user:pass@public.example/', { lookup }),
    /credentials/i
  );
  await assert.rejects(
    () => validatePublicUrl('https://internal.example/', {
      lookup: fakeLookup({ 'internal.example': ['10.1.2.3'] })
    }),
    /private/i
  );

  const accepted = await validatePublicUrl('https://public.example/article', { lookup });
  assert.equal(accepted.url.hostname, 'public.example');
  assert.equal(accepted.addresses[0].address, '93.184.216.34');
});

test('re-validates redirects and blocks a redirect to loopback', async () => {
  const lookup = fakeLookup({ 'public.example': ['93.184.216.34'] });
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/secret' }
    });
  };

  await assert.rejects(
    () => fetchPublicHtml('https://public.example/start', { lookup, fetchImpl }),
    /Private|loopback/i
  );
  assert.equal(fetches, 1);
});

test('blocks a redirect hostname that resolves privately', async () => {
  const lookup = fakeLookup({
    'public.example': ['93.184.216.34'],
    'internal.example': ['10.0.0.7']
  });
  const fetchImpl = async () =>
    new Response(null, {
      status: 302,
      headers: { location: 'https://internal.example/admin' }
    });

  await assert.rejects(
    () => fetchPublicHtml('https://public.example/start', { lookup, fetchImpl }),
    /private/i
  );
});

test('fetches a public HTML page through the injected fetcher', async () => {
  const lookup = fakeLookup({ 'public.example': ['93.184.216.34'] });
  const fetchImpl = async () =>
    new Response('<html><body><p>Hello public web.</p></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });

  const result = await fetchPublicHtml('https://public.example/page', {
    lookup,
    fetchImpl
  });
  assert.equal(result.url, 'https://public.example/page');
  assert.match(result.html, /Hello public web/);
});
