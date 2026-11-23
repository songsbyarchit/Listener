import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, request, createMockTts } from './helpers.js';

const HTML = `<!doctype html>
<html><head><title>Captured page</title></head>
<body>
<nav><a href="/">Home</a><a href="/login">Log in</a></nav>
<article>
<h1>The captured article</h1>
<p>The Moon does most of the work. Its gravity pulls the water into two bulges.</p>
<h2>Why it matters</h2>
<p>Most coastlines see two high tides and two low tides each day.</p>
</article>
</body></html>`;

test('imports a captured page DOM without fetching the URL', async () => {
  const mock = createMockTts();
  const app = await startApp({ ttsFetchImpl: mock.fetchImpl });
  try {
    const created = await request(app.base, '/api/documents/import/page', {
      method: 'POST',
      json: {
        url: 'https://private.example/account/article',
        title: 'Browser tab title',
        html: HTML
      }
    });

    assert.equal(created.status, 201);
    const document = created.json.document;
    assert.equal(document.title, 'The captured article');
    assert.equal(document.sourceType, 'page');
    assert.equal(document.sourceUrl, 'https://private.example/account/article');
    assert.ok(document.segmentCount >= 4);
    assert.match(JSON.stringify(document.content), /two high tides/);
    assert.doesNotMatch(JSON.stringify(document.content), /Log in|Home/);
  } finally {
    await app.close();
  }
});

test('falls back to captured plain text when HTML extraction fails', async () => {
  const mock = createMockTts();
  const app = await startApp({ ttsFetchImpl: mock.fetchImpl });
  try {
    const created = await request(app.base, '/api/documents/import/page', {
      method: 'POST',
      json: {
        url: 'https://example.test/plain',
        title: 'Plain capture',
        text: 'A short but readable page. It has two sentences.'
      }
    });

    assert.equal(created.status, 201);
    assert.equal(created.json.document.sourceType, 'page');
    assert.equal(created.json.document.title, 'Plain capture');
    assert.ok(created.json.document.segmentCount >= 1);
  } finally {
    await app.close();
  }
});

test('rejects a page capture with no readable content', async () => {
  const mock = createMockTts();
  const app = await startApp({ ttsFetchImpl: mock.fetchImpl });
  try {
    const rejected = await request(app.base, '/api/documents/import/page', {
      method: 'POST',
      json: { url: 'https://example.test/empty', title: 'Empty', text: '   ' }
    });
    assert.equal(rejected.status, 400);
  } finally {
    await app.close();
  }
});
