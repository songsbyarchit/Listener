import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  startApp,
  request,
  waitForDocument,
  createMockTts
} from './helpers.js';

test('import a document, fetch speech, then resume its saved position', async () => {
  const mock = createMockTts({ audio: 'ID3-fake-audio-payload' });
  const first = await startApp({ ttsFetchImpl: mock.fetchImpl });
  const dataDir = first.dataDir;

  const form = new FormData();
  form.append(
    'file',
    new Blob(
      [
        'The Moon does most of the work. Its gravity pulls the water into two bulges.\n\n' +
          'Because Earth rotates, most coasts see two high tides each day.'
      ],
      { type: 'text/plain' }
    ),
    'tides.txt'
  );
  form.append('title', 'The Tides');

  const upload = await fetch(`${first.base}/api/documents/import/file`, {
    method: 'POST',
    body: form
  });
  assert.equal(upload.status, 202);
  const uploadBody = await upload.json();
  const id = uploadBody.document.id;
  assert.equal(uploadBody.document.status, 'extracting');

  const ready = await waitForDocument(first.base, id);
  assert.equal(ready.status, 'ready');
  assert.equal(ready.title, 'The Tides');
  assert.ok(ready.segmentCount >= 3);

  const audio = await fetch(`${first.base}/api/documents/${id}/audio/0?voice=af_heart`);
  assert.equal(audio.status, 200);
  assert.match(audio.headers.get('content-type'), /audio\/mpeg/);
  assert.equal(await audio.text(), 'ID3-fake-audio-payload');

  const audioAgain = await fetch(`${first.base}/api/documents/${id}/audio/0?voice=af_heart`);
  assert.equal(audioAgain.status, 200);
  await audioAgain.text();

  const speechCalls = mock.calls.filter((call) => call.url.endsWith('/audio/speech'));
  assert.equal(speechCalls.length, 1, 'second request should hit the audio cache');
  assert.equal(speechCalls[0].body.voice, 'af_heart');
  assert.equal(speechCalls[0].body.model, 'kokoro');

  const saved = await request(first.base, `/api/documents/${id}/state`, {
    method: 'PATCH',
    json: {
      position: { segmentIndex: 2, chapterIndex: 0, paragraphIndex: 1 },
      settings: { voice: 'af_bella', rate: 1.3, volume: 0.75 }
    }
  });
  assert.equal(saved.status, 200);

  const exported = await request(first.base, `/api/documents/${id}/export.txt`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  assert.match(exported.text, /The Moon does most of the work/);
  assert.equal((exported.text.match(/The Tides/g) || []).length, 1);

  await first.close({ keepData: true });

  const second = await startApp({ dataDir, ttsFetchImpl: mock.fetchImpl });
  try {
    const resumed = await request(second.base, `/api/documents/${id}`);
    assert.equal(resumed.status, 200);
    assert.equal(resumed.json.document.position.segmentIndex, 2);
    assert.equal(resumed.json.document.settings.voice, 'af_bella');
    assert.equal(resumed.json.document.settings.rate, 1.3);

    const list = await request(second.base, '/api/documents?q=Moon');
    assert.equal(list.status, 200);
    assert.equal(list.json.documents.length, 1);
    assert.ok(list.json.documents[0].progress > 0);

    const deleted = await request(second.base, `/api/documents/${id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 204);
    assert.deepEqual(fs.readdirSync(path.join(dataDir, 'uploads')), []);
  } finally {
    await second.close();
  }
});

test('rejects unsupported uploads and oversized pasted text', async () => {
  const mock = createMockTts();
  const app = await startApp({ ttsFetchImpl: mock.fetchImpl });
  try {
    const form = new FormData();
    form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'notes.exe');
    const rejected = await fetch(`${app.base}/api/documents/import/file`, {
      method: 'POST',
      body: form
    });
    assert.equal(rejected.status, 415);

    const tooLarge = await request(app.base, '/api/documents', {
      method: 'POST',
      json: { text: 'x'.repeat(2_000_001) }
    });
    assert.equal(tooLarge.status, 413);
  } finally {
    await app.close();
  }
});
