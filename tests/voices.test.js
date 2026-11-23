import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, request, createMockTts } from './helpers.js';

test('voices preview through the local TTS server and default voice applies to new documents', async () => {
  const mock = createMockTts({ audio: 'preview-audio' });
  const app = await startApp({ ttsFetchImpl: mock.fetchImpl });
  try {
    const voices = await request(app.base, '/api/voices');
    assert.equal(voices.status, 200);
    assert.ok(voices.json.voices.some((voice) => voice.id === 'af_bella'));

    const preview = await fetch(`${app.base}/api/voices/af_bella/preview`);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-type'), /audio\/mpeg/);
    assert.equal(await preview.text(), 'preview-audio');

    const saved = await request(app.base, '/api/settings', {
      method: 'PATCH',
      json: { defaultVoice: 'af_bella' }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.defaultVoice, 'af_bella');

    const created = await request(app.base, '/api/documents', {
      method: 'POST',
      json: { title: 'Voice default', text: 'One sentence for the test.' }
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.document.settings.voice, 'af_bella');
    assert.equal(created.json.document.settings.sentenceGap, 160);
    assert.equal(created.json.document.settings.paragraphGap, 600);

    const patched = await request(app.base, `/api/documents/${created.json.document.id}/state`, {
      method: 'PATCH',
      json: { settings: { sentenceGap: 240, paragraphGap: 900 } }
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.settings.sentenceGap, 240);
    assert.equal(patched.json.settings.paragraphGap, 900);

    const badGap = await request(app.base, `/api/documents/${created.json.document.id}/state`, {
      method: 'PATCH',
      json: { settings: { sentenceGap: 9000 } }
    });
    assert.equal(badGap.status, 400);
  } finally {
    await app.close();
  }
});
