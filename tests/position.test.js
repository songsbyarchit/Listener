import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, request, createMockTts } from './helpers.js';

test('reading position and settings survive a server restart', async (t) => {
  const mock = createMockTts();
  const first = await startApp({ ttsFetchImpl: mock.fetchImpl });
  t.after(() => {
    // The second app cleans up the directory.
  });

  const created = await request(first.base, '/api/documents', {
    method: 'POST',
    json: {
      title: 'Position test',
      text: 'First sentence. Second sentence.\n\nA second paragraph follows. And another sentence.'
    }
  });
  assert.equal(created.status, 201);
  const id = created.json.document.id;

  const patched = await request(first.base, `/api/documents/${id}/state`, {
    method: 'PATCH',
    json: {
      position: { segmentIndex: 2, chapterIndex: 0, paragraphIndex: 1 },
      settings: { voice: 'af_bella', rate: 1.25, volume: 0.65 }
    }
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.position.segmentIndex, 2);
  assert.equal(patched.json.settings.voice, 'af_bella');
  assert.equal(patched.json.settings.rate, 1.25);

  const invalidPosition = await request(first.base, `/api/documents/${id}/state`, {
    method: 'PATCH',
    json: { position: { segmentIndex: 999 } }
  });
  assert.equal(invalidPosition.status, 400);

  const invalidRate = await request(first.base, `/api/documents/${id}/state`, {
    method: 'PATCH',
    json: { settings: { rate: 9 } }
  });
  assert.equal(invalidRate.status, 400);

  const dataDir = first.dataDir;
  await first.close({ keepData: true });

  const second = await startApp({ dataDir, ttsFetchImpl: mock.fetchImpl });
  try {
    const fetched = await request(second.base, `/api/documents/${id}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.document.position.segmentIndex, 2);
    assert.equal(fetched.json.document.position.paragraphIndex, 1);
    assert.equal(fetched.json.document.settings.voice, 'af_bella');
    assert.equal(fetched.json.document.settings.rate, 1.25);
    assert.equal(fetched.json.document.settings.volume, 0.65);
  } finally {
    await second.close();
  }
});
