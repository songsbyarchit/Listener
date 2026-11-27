import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, request } from './helpers.js';

test('saves, lists, marks done and removes clips', async () => {
  const app = await startApp();
  try {
    const first = await request(app.base, '/api/clips', {
      method: 'POST',
      json: { title: 'Tides', url: 'https://example.com/tides', site: 'example.com', kind: 'article', text: 'The Moon does most of the work.' }
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.clip.words, 7);
    // Clipping the same article again replaces it rather than duplicating it.
    await request(app.base, '/api/clips', {
      method: 'POST',
      json: { title: 'Tides', url: 'https://example.com/tides', kind: 'article', text: 'The Moon does the work.' }
    });
    await request(app.base, '/api/clips', {
      method: 'POST',
      json: { title: 'Tides', url: 'https://example.com/tides', kind: 'selection', text: 'Two bulges.' }
    });
    let list = await request(app.base, '/api/clips');
    assert.equal(list.json.clips.length, 2);
    const id = list.json.clips[0].id;
    const done = await request(app.base, `/api/clips/${id}`, { method: 'PATCH', json: { done: true } });
    assert.equal(done.json.clip.done, true);
    await request(app.base, `/api/clips/${id}`, { method: 'DELETE' });
    list = await request(app.base, '/api/clips');
    assert.equal(list.json.clips.length, 1);
    const empty = await request(app.base, '/api/clips', { method: 'POST', json: { text: '  ' } });
    assert.equal(empty.status, 400);
  } finally {
    await app.close();
  }
});
