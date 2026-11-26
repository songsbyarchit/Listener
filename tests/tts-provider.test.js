import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startApp, request, createMockTts } from './helpers.js';

const RACHEL = '21m00Tcm4TlvDq8ikWAM';

async function saveElevenLabs(app, key = 'sk_test_secret_1234') {
  return request(app.base, '/api/tts/settings', {
    method: 'PATCH',
    json: { provider: 'elevenlabs', apiKey: key }
  });
}

test('voice settings default to local Kokoro and never expose a key', async () => {
  const app = await startApp();
  try {
    const settings = await request(app.base, '/api/tts/settings');
    assert.equal(settings.status, 200);
    assert.equal(settings.json.provider, 'kokoro');
    assert.equal(settings.json.usingEnvDefaults, true);
    assert.equal(settings.json.apiKeyConfigured, false);
    assert.equal(settings.json.apiKey, undefined);
    assert.ok(Array.isArray(settings.json.providers));
    assert.ok(settings.json.providers.some((provider) => provider.id === 'elevenlabs'));
  } finally {
    await app.close();
  }
});

test('ElevenLabs saves a masked key, lists voices, and speaks a whole passage with context', async () => {
  const mock = createMockTts();
  const app = await startApp({ ttsFetchImpl: mock.fetchImpl });
  try {
    const saved = await saveElevenLabs(app);
    assert.equal(saved.status, 200);
    assert.equal(saved.json.provider, 'elevenlabs');
    assert.equal(saved.json.apiKeyConfigured, true);
    assert.equal(saved.json.apiKeyHint, '1234');
    assert.equal(JSON.stringify(saved.json).includes('sk_test_secret'), false);
    assert.equal(saved.json.defaultVoice, RACHEL);
    assert.ok(saved.json.voices.some((voice) => voice.id === RACHEL));

    const created = await request(app.base, '/api/documents', {
      method: 'POST',
      json: {
        title: 'Passage context',
        text: 'The tide comes in. Then it goes out. The shore keeps the rhythm.'
      }
    });
    assert.equal(created.status, 201);
    const document = created.json.document;
    assert.equal(document.settings.voice, RACHEL);

    const audio = await fetch(`${app.base}/api/documents/${document.id}/audio/1`);
    assert.equal(audio.status, 200);
    assert.equal(await audio.text(), 'fake-mp3-bytes');

    const call = mock.calls.find((entry) => entry.url.includes('/v1/text-to-speech/'));
    assert.ok(call, 'ElevenLabs synthesis endpoint was called');
    assert.ok(call.url.includes(`/v1/text-to-speech/${RACHEL}`));
    assert.match(call.url, /output_format=mp3_44100_128/);
    assert.match(call.url, /enable_logging=false/);
    assert.equal(call.headers['xi-api-key'], 'sk_test_secret_1234');
    assert.equal(call.body.text, 'Then it goes out.');
    assert.equal(call.body.model_id, 'eleven_multilingual_v2');
    assert.equal(call.body.previous_text, 'The tide comes in.');
    assert.equal(call.body.next_text, 'The shore keeps the rhythm.');
    assert.equal(
      mock.calls.some((entry) => entry.url.endsWith('/audio/speech')),
      false,
      'must not use the OpenAI-compatible endpoint for ElevenLabs'
    );
  } finally {
    await app.close();
  }
});

test('headless env configuration picks the provider defaults', async () => {
  const mock = createMockTts();
  const app = await startApp({
    ttsFetchImpl: mock.fetchImpl,
    env: { TTS_PROVIDER: 'elevenlabs', TTS_API_KEY: 'sk_env_only_4321' }
  });
  try {
    const settings = await request(app.base, '/api/tts/settings');
    assert.equal(settings.json.provider, 'elevenlabs');
    assert.equal(settings.json.baseUrl, 'https://api.elevenlabs.io');
    assert.equal(settings.json.model, 'eleven_multilingual_v2');
    assert.equal(settings.json.apiKeyConfigured, true);
    assert.equal(settings.json.usingEnvDefaults, true);

    const voices = await request(app.base, '/api/voices');
    assert.equal(voices.json.provider, 'elevenlabs');
    assert.ok(voices.json.voices.some((voice) => voice.id === RACHEL));
  } finally {
    await app.close();
  }
});

test('saved settings and keys survive a restart', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'listnr-provider-'));
  const mock = createMockTts();
  const first = await startApp({ dataDir, ttsFetchImpl: mock.fetchImpl });
  try {
    const saved = await saveElevenLabs(first, 'sk_persist_9999');
    assert.equal(saved.status, 200);
  } finally {
    await first.close({ keepData: true });
  }

  const second = await startApp({ dataDir, ttsFetchImpl: mock.fetchImpl });
  try {
    const settings = await request(second.base, '/api/tts/settings');
    assert.equal(settings.json.provider, 'elevenlabs');
    assert.equal(settings.json.apiKeyConfigured, true);
    assert.equal(settings.json.apiKeyHint, '9999');
    assert.equal(settings.json.usingEnvDefaults, false);
  } finally {
    await second.close();
  }
});

test('provider switching clears the previous key and enforces transport rules', async () => {
  const mock = createMockTts();
  const app = await startApp({ ttsFetchImpl: mock.fetchImpl });
  try {
    await saveElevenLabs(app);

    const backToLocal = await request(app.base, '/api/tts/settings', {
      method: 'PATCH',
      json: { provider: 'kokoro' }
    });
    assert.equal(backToLocal.status, 200);
    assert.equal(backToLocal.json.provider, 'kokoro');
    assert.equal(backToLocal.json.apiKeyConfigured, false);

    const noKey = await request(app.base, '/api/tts/settings', {
      method: 'PATCH',
      json: { provider: 'elevenlabs' }
    });
    assert.equal(noKey.status, 400);
    assert.equal(noKey.json.error.code, 'tts_key_required');

    const insecure = await request(app.base, '/api/tts/settings', {
      method: 'PATCH',
      json: {
        provider: 'custom',
        baseUrl: 'http://voice.example.com/v1',
        model: 'voice-model',
        apiKey: 'plain-http-key'
      }
    });
    assert.equal(insecure.status, 400);
    assert.equal(insecure.json.error.code, 'tts_insecure_url');

    const lan = await request(app.base, '/api/tts/settings', {
      method: 'PATCH',
      json: { provider: 'custom', baseUrl: 'http://192.168.1.40:8000/v1', model: 'kokoro' }
    });
    assert.equal(lan.status, 200);
    assert.equal(lan.json.provider, 'custom');
    assert.equal(lan.json.apiKeyConfigured, false);

    const secure = await request(app.base, '/api/tts/settings', {
      method: 'PATCH',
      json: { provider: 'custom', baseUrl: 'https://voice.example.com/v1', model: 'voice-model' }
    });
    assert.equal(secure.status, 200);
  } finally {
    await app.close();
  }
});

test('the OpenAI preset uses its own static voice list', async () => {
  const app = await startApp({ ttsFetchImpl: createMockTts().fetchImpl });
  try {
    const saved = await request(app.base, '/api/tts/settings', {
      method: 'PATCH',
      json: { provider: 'openai', apiKey: 'sk-openai-1234' }
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.provider, 'openai');
    assert.equal(saved.json.defaultVoice, 'alloy');
    assert.ok(saved.json.voices.some((voice) => voice.id === 'alloy'));

    const settings = await request(app.base, '/api/tts/settings');
    assert.equal(JSON.stringify(settings.json).includes('sk-openai-1234'), false);
  } finally {
    await app.close();
  }
});

test('a document made under Kokoro falls back to a valid provider voice', async () => {
  const mock = createMockTts();
  const app = await startApp({ ttsFetchImpl: mock.fetchImpl });
  try {
    const created = await request(app.base, '/api/documents', {
      method: 'POST',
      json: { title: 'Old voice', text: 'One sentence recorded under Kokoro.' }
    });
    assert.equal(created.json.document.settings.voice, 'af_heart');

    await saveElevenLabs(app);

    const audio = await fetch(
      `${app.base}/api/documents/${created.json.document.id}/audio/0?voice=af_heart`
    );
    assert.equal(audio.status, 200);
    await audio.text();

    const call = mock.calls.find((entry) => entry.url.includes('/v1/text-to-speech/'));
    assert.ok(call.url.includes(`/v1/text-to-speech/${RACHEL}`));
    assert.equal(call.body.text, 'One sentence recorded under Kokoro.');
  } finally {
    await app.close();
  }
});

test('the connection test never synthesizes audio and reports rejected keys', async () => {
  const mock = createMockTts();
  const app = await startApp({ ttsFetchImpl: mock.fetchImpl });
  try {
    const ok = await request(app.base, '/api/tts/test', {
      method: 'POST',
      json: { provider: 'elevenlabs', apiKey: 'sk_probe_0001' }
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ok, true);
    assert.equal(ok.json.authorized, true);
    assert.equal(
      mock.calls.some((entry) => entry.url.includes('/text-to-speech/')),
      false,
      'testing the key must not spend credits'
    );

    const missing = await request(app.base, '/api/tts/test', {
      method: 'POST',
      json: { provider: 'elevenlabs' }
    });
    assert.equal(missing.status, 200);
    assert.equal(missing.json.ok, false);
    assert.equal(missing.json.code, 'tts_key_required');
  } finally {
    await app.close();
  }

  const unauthorized = async (url) =>
    new Response(JSON.stringify({ detail: 'invalid api key' }), {
      status: String(url).includes('/v1/voices') ? 401 : 404,
      headers: { 'content-type': 'application/json' }
    });
  const second = await startApp({ ttsFetchImpl: unauthorized });
  try {
    const bad = await request(second.base, '/api/tts/test', {
      method: 'POST',
      json: { provider: 'elevenlabs', apiKey: 'sk_wrong_0000' }
    });
    assert.equal(bad.status, 200);
    assert.equal(bad.json.ok, false);
    assert.equal(bad.json.authorized, false);
  } finally {
    await second.close();
  }
});
