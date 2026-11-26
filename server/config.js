import path from 'node:path';

export const DEFAULT_VOICES = [
  { id: 'af_heart', name: 'Heart', note: 'US English · warm female' },
  { id: 'af_bella', name: 'Bella', note: 'US English · bright female' },
  { id: 'af_nicole', name: 'Nicole', note: 'US English · soft female' },
  { id: 'af_sarah', name: 'Sarah', note: 'US English · clear female' },
  { id: 'am_michael', name: 'Michael', note: 'US English · calm male' },
  { id: 'am_fenrir', name: 'Fenrir', note: 'US English · deep male' },
  { id: 'am_adam', name: 'Adam', note: 'US English · neutral male' },
  { id: 'bf_emma', name: 'Emma', note: 'UK English · female' },
  { id: 'bm_george', name: 'George', note: 'UK English · male' }
];

const DEFAULT_DATA_DIR = path.resolve('data');

function numberFromEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseVoiceList(value) {
  if (!value) return DEFAULT_VOICES;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, ...label] = entry.split(':');
      const known = DEFAULT_VOICES.find((voice) => voice.id === id.trim());
      return {
        id: id.trim(),
        name: (label.join(':').trim() || known?.name || id.trim()),
        note: known?.note || 'Kokoro voice'
      };
    });
}

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.LISTNR_DATA_DIR || DEFAULT_DATA_DIR);
  const port = numberFromEnv(env.PORT, 8787);

  return {
    // Loopback by default. Containers set HOST=0.0.0.0 while publishing only
    // 127.0.0.1 on the host.
    host: env.HOST || '127.0.0.1',
    port,
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    audioDir: path.join(dataDir, 'audio'),
    tessdataDir: path.join(dataDir, 'tessdata'),
    dbPath: path.join(dataDir, 'listnr.db'),
    maxUploadBytes: numberFromEnv(env.MAX_UPLOAD_MB, 30) * 1024 * 1024,
    maxPasteChars: numberFromEnv(env.MAX_PASTE_CHARS, 2_000_000),
    maxUrlBytes: numberFromEnv(env.MAX_URL_MB, 8) * 1024 * 1024,
    audioCacheMaxBytes: numberFromEnv(env.AUDIO_CACHE_MAX_MB, 1024) * 1024 * 1024,
    tts: {
      provider: env.TTS_PROVIDER || 'kokoro',
      baseUrl: (env.TTS_BASE_URL || 'http://127.0.0.1:8880/v1').replace(/\/+$/, ''),
      model: env.TTS_MODEL || 'kokoro',
      voice: env.TTS_VOICE || 'af_heart',
      format: env.TTS_FORMAT || 'mp3',
      apiKey: env.TTS_API_KEY || '',
      timeoutMs: numberFromEnv(env.TTS_TIMEOUT_MS, 45_000),
      voices: parseVoiceList(env.TTS_VOICES)
    },
    urlImport: {
      timeoutMs: numberFromEnv(env.URL_TIMEOUT_MS, 20_000),
      maxRedirects: numberFromEnv(env.URL_MAX_REDIRECTS, 5)
    }
  };
}
