import dns from 'node:dns/promises';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { HttpError, badRequest, forbidden } from './errors.js';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal'
]);

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home.arpa'
];

const blockedAddresses = new net.BlockList();

for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
]) {
  blockedAddresses.addSubnet(address, prefix, 'ipv4');
}

for (const [address, prefix] of [
  ['::', 96],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48]
]) {
  blockedAddresses.addSubnet(address, prefix, 'ipv6');
}

export function isBlockedAddress(address) {
  const normalized = String(address || '').trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isBlockedAddress(mapped[1]);

  const family = net.isIP(normalized);
  if (family === 4) return blockedAddresses.check(normalized, 'ipv4');
  if (family === 6) return blockedAddresses.check(normalized, 'ipv6');
  return true;
}

export function isBlockedHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function bareHostname(hostname) {
  return String(hostname || '').replace(/^\[/, '').replace(/\]$/, '');
}

export async function validatePublicUrl(input, { lookup = dns.lookup } = {}) {
  let url;
  try {
    url = new URL(String(input || '').trim());
  } catch {
    throw badRequest('That is not a valid URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw badRequest('Only http:// and https:// URLs can be imported.');
  }
  if (url.username || url.password) {
    throw badRequest('URLs with embedded credentials are not allowed.');
  }
  if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) {
    throw badRequest('That URL has an invalid port.');
  }

  const hostname = bareHostname(url.hostname);
  if (!hostname) throw badRequest('The URL has no host.');

  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw forbidden('Private, loopback, and link-local addresses are not allowed.');
    }
    return { url, addresses: [{ address: hostname, family: net.isIP(hostname) }] };
  }

  if (isBlockedHostname(hostname)) {
    throw forbidden('Private, loopback, and local hostnames are not allowed.');
  }

  let results;
  try {
    results = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw badRequest('That hostname could not be resolved.');
  }

  const addresses = (Array.isArray(results) ? results : [results])
    .filter((entry) => entry && entry.address)
    .map((entry) => ({
      address: entry.address,
      family: entry.family || net.isIP(entry.address)
    }));

  if (!addresses.length) throw badRequest('That hostname could not be resolved.');
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw forbidden('That hostname resolves to a private or local address.');
  }

  return { url, addresses };
}

function createPinnedAgent(addresses) {
  const target = addresses[0];
  return new Agent({
    connect: {
      lookup(_hostname, _options, callback) {
        callback(null, target.address, target.family === 6 ? 6 : 4);
      }
    }
  });
}

async function readLimitedBody(response, maxBytes) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, 'The page is too large to import.', 'too_large');
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, 'The page is too large to import.', 'too_large');
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

function decodeHtml(buffer, contentType) {
  const charset = /charset=([^;]+)/i.exec(contentType || '')?.[1]?.trim().replace(/["']/g, '');
  if (charset) {
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      // Fall through to UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(buffer);
}

export async function fetchPublicHtml(
  inputUrl,
  {
    lookup = dns.lookup,
    fetchImpl = null,
    maxRedirects = 5,
    timeoutMs = 20_000,
    maxBytes = 8 * 1024 * 1024
  } = {}
) {
  let current = String(inputUrl || '');
  const fetcher = fetchImpl || undiciFetch;

  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const { url, addresses } = await validatePublicUrl(current, { lookup });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let agent = null;

    try {
      const options = {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
          'User-Agent': 'LISTNR/0.2 (local document reader)'
        }
      };

      if (!fetchImpl) {
        agent = createPinnedAgent(addresses);
        options.dispatcher = agent;
      }

      let response;
      try {
        response = await fetcher(url, options);
      } catch {
        throw new HttpError(502, 'The page could not be fetched.', 'fetch_failed');
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new HttpError(502, 'The page redirected without a location.', 'bad_redirect');
        current = new URL(location, url).toString();
        continue;
      }

      if (!response.ok) {
        throw new HttpError(502, `The page returned HTTP ${response.status}.`, 'fetch_failed');
      }

      const contentType = response.headers.get('content-type') || '';
      if (!/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
        throw new HttpError(415, 'That URL did not return a readable HTML or text page.', 'unsupported_content');
      }

      const buffer = await readLimitedBody(response, maxBytes);
      return {
        html: decodeHtml(buffer, contentType),
        url: url.toString(),
        contentType
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new HttpError(504, 'The page took too long to respond.', 'timeout');
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (agent) await agent.close().catch(() => {});
    }
  }

  throw new HttpError(502, 'Too many redirects.', 'too_many_redirects');
}
