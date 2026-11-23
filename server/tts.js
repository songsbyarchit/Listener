import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from './errors.js';
import { DEFAULT_VOICES } from './config.js';
import {
  getCachedAudio,
  putCachedAudio,
  pruneAudioCache
} from './db.js';

const MIME_BY_FORMAT = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  opus: 'audio/opus'
};

const VOICE_PATTERN = /^[a-z]{2}_[a-z0-9_]{1,40}$/i;

export function isValidVoice(voice) {
  return VOICE_PATTERN.test(String(voice || ''));
}

function extensionFor(format, contentType) {
  const clean = String(format || '').toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(clean)) return clean;
  if (/wav/i.test(contentType || '')) return 'wav';
  if (/ogg|opus/i.test(contentType || '')) return 'ogg';
  if (/flac/i.test(contentType || '')) return 'flac';
  return 'mp3';
}

function contentTypeFor(format, headerValue) {
  const header = String(headerValue || '').split(';')[0].trim();
  if (header.startsWith('audio/')) return header;
  return MIME_BY_FORMAT[String(format || '').toLowerCase()] || 'audio/mpeg';
}

function displayName(id, known) {
  const match = known.find((voice) => voice.id === id);
  if (match) return match.name;
  const [, name] = id.split('_');
  return String(name || id)
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function createTtsService({ config, db, fetchImpl = globalThis.fetch }) {
  const inFlight = new Map();
  let voiceCache = null;
  let voiceCacheAt = 0;

  async function fetchVoices({ timeoutMs = 2500 } = {}) {
    if (voiceCache && Date.now() - voiceCacheAt < 60_000) return voiceCache;

    let remote = [];
    const endpoints = [
      `${config.tts.baseUrl}/audio/voices`,
      `${config.tts.baseUrl}/voices`
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetchImpl(endpoint, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: config.tts.apiKey ? { Authorization: `Bearer ${config.tts.apiKey}` } : {}
        });
        if (!response.ok) continue;
        const payload = await response.json();
        const raw = Array.isArray(payload) ? payload : payload?.voices || payload?.data || [];
        remote = raw
          .map((entry) =>
            typeof entry === 'string'
              ? entry
              : entry?.id || entry?.name || entry?.voice_id || ''
          )
          .filter(Boolean)
          .map((id) => {
            const known = DEFAULT_VOICES.find((voice) => voice.id === id);
            return {
              id,
              name: displayName(id, DEFAULT_VOICES),
              note: known?.note || 'Kokoro voice'
            };
          });
        if (remote.length) break;
      } catch {
        // Try the next endpoint.
      }
    }

    const merged = new Map();
    for (const voice of config.tts.voices) merged.set(voice.id, voice);
    for (const voice of remote) merged.set(voice.id, voice);
    voiceCache = [...merged.values()];
    voiceCacheAt = Date.now();
    return voiceCache;
  }

  async function probe() {
    const endpoints = [
      `${config.tts.baseUrl}/models`,
      `${config.tts.baseUrl}/audio/voices`,
      `${config.tts.baseUrl}/voices`
    ];
    let lastError = null;

    for (const endpoint of endpoints) {
      try {
        const response = await fetchImpl(endpoint, {
          signal: AbortSignal.timeout(2500),
          headers: config.tts.apiKey ? { Authorization: `Bearer ${config.tts.apiKey}` } : {}
        });
        if (response.status < 500) {
          return {
            reachable: true,
            status: response.status,
            baseUrl: config.tts.baseUrl,
            model: config.tts.model
          };
        }
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = String(error?.cause?.code || error?.message || 'unreachable');
      }
    }

    return {
      reachable: false,
      baseUrl: config.tts.baseUrl,
      model: config.tts.model,
      message: lastError || 'unreachable'
    };
  }

  async function requestSpeech(text, voice) {
    const format = config.tts.format;
    const body = {
      model: config.tts.model,
      voice,
      input: text,
      response_format: format
    };

    let response;
    try {
      response = await fetchImpl(`${config.tts.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.tts.apiKey ? { Authorization: `Bearer ${config.tts.apiKey}` } : {})
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.tts.timeoutMs)
      });
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? 'timed out' : 'is not reachable';
      throw new HttpError(
        503,
        `The local voice server ${reason} at ${config.tts.baseUrl}. Start Kokoro-FastAPI and try again.`,
        'tts_unavailable'
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json();
        detail = payload?.error?.message || payload?.detail || '';
      } catch {
        // Non-JSON error body.
      }
      throw new HttpError(
        502,
        `The local voice server returned HTTP ${response.status}${detail ? `: ${detail}` : '.'}`,
        'tts_failed'
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer.byteLength) {
      throw new HttpError(502, 'The local voice server returned empty audio.', 'tts_empty');
    }

    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: contentTypeFor(format, response.headers.get('content-type')),
      format
    };
  }

  async function synthesize(text, voice) {
    if (!isValidVoice(voice)) {
      throw new HttpError(400, 'That is not a valid voice name.', 'invalid_voice');
    }

    const format = String(config.tts.format || 'mp3').toLowerCase();
    const key = crypto
      .createHash('sha256')
      .update(`${config.tts.model}\u0000${voice}\u0000${format}\u0000${text}`)
      .digest('hex');

    const cached = getCachedAudio(db, key);
    if (cached && fs.existsSync(cached.file)) {
      return {
        file: cached.file,
        contentType: cached.content_type,
        key,
        cached: true
      };
    }

    if (inFlight.has(key)) return inFlight.get(key);

    const promise = (async () => {
      const audio = await requestSpeech(text, voice);
      const extension = extensionFor(audio.format, audio.contentType);
      const relativePath = path.join('audio', key.slice(0, 2), `${key}.${extension}`);
      const absolutePath = path.join(config.dataDir, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

      const temporary = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporary, audio.buffer);
      fs.renameSync(temporary, absolutePath);

      putCachedAudio(db, {
        key,
        file: absolutePath,
        contentType: audio.contentType,
        bytes: audio.buffer.byteLength
      });
      pruneAudioCache(db, config.audioCacheMaxBytes);

      return {
        file: absolutePath,
        contentType: audio.contentType,
        key,
        cached: false
      };
    })().finally(() => {
      inFlight.delete(key);
    });

    inFlight.set(key, promise);
    return promise;
  }

  return {
    synthesize,
    fetchVoices,
    probe
  };
}
