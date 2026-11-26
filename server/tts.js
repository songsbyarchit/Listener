import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from './errors.js';
import { DEFAULT_VOICES } from './config.js';
import {
  elevenLabsUrl,
  getProvider,
  isValidVoiceForProvider,
  readTtsSettings
} from './tts-providers.js';
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
  opus: 'audio/opus',
  aac: 'audio/aac',
  pcm: 'audio/pcm'
};

const ELEVEN_LABS_FORMATS = {
  mp3: 'mp3_44100_128',
  wav: 'wav_44100',
  opus: 'opus_48000_128',
  ogg: 'opus_48000_128'
};

const ELEVEN_LABS_MAX_CHARS = 5000;

export function isValidVoice(voice) {
  return isValidVoiceForProvider('kokoro', voice);
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

function elevenLabsNote(labels) {
  if (!labels || typeof labels !== 'object') return 'ElevenLabs voice';
  const parts = [labels.accent, labels.description, labels.gender, labels.age, labels.use_case]
    .filter((value) => typeof value === 'string' && value.trim());
  return parts.length ? `ElevenLabs · ${parts.slice(0, 2).join(' · ')}` : 'ElevenLabs voice';
}

function audioFormat(settings) {
  const format = String(settings.format || 'mp3').toLowerCase();
  if (settings.provider !== 'elevenlabs') return format;
  return ELEVEN_LABS_FORMATS[format] ? format === 'ogg' ? 'opus' : format : 'mp3';
}

function elevenLabsOutputFormat(settings) {
  return ELEVEN_LABS_FORMATS[String(settings.format || 'mp3').toLowerCase()] || 'mp3_44100_128';
}

function authHeaders(settings) {
  if (!settings.apiKey) return {};
  return settings.provider === 'elevenlabs'
    ? { 'xi-api-key': settings.apiKey }
    : { Authorization: `Bearer ${settings.apiKey}` };
}

function keyFingerprint(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 12);
}

function providerError(settings, status, detail) {
  const label = getProvider(settings.provider)?.label || 'The voice service';
  const suffix = detail ? `: ${detail}` : '.';

  if (status === 401 || status === 403) {
    return new HttpError(
      502,
      `${label} rejected the API key. Update it in the voice provider configuration.`,
      'tts_auth_failed'
    );
  }
  if (status === 402) {
    return new HttpError(402, `${label} says this account is out of credits.`, 'tts_quota');
  }
  if (status === 429) {
    return new HttpError(429, `${label} is rate limiting requests. Wait a moment and retry.`, 'tts_rate_limited');
  }
  if (status === 404 && settings.provider === 'openai') {
    return new HttpError(
      502,
      'OpenAI no longer serves this speech model at /audio/speech. Switch to another voice provider in the server configuration.',
      'tts_provider_retired'
    );
  }
  if (status === 413) {
    return new HttpError(413, `${label} rejected this passage as too long.`, 'tts_text_too_long');
  }
  if ((status === 400 || status === 404 || status === 422) && settings.provider === 'elevenlabs') {
    return new HttpError(
      400,
      'That voice is not available on this ElevenLabs account. Pick another voice.',
      'invalid_voice'
    );
  }
  return new HttpError(502, `${label} returned HTTP ${status}${suffix}`, 'tts_failed');
}

export function createTtsService({ config, db, fetchImpl = globalThis.fetch }) {
  const inFlight = new Map();
  let voiceCache = null;

  const settingsNow = () => readTtsSettings(db, config);

  function signature(settings) {
    return [
      settings.provider,
      settings.baseUrl,
      settings.model,
      settings.apiKey ? keyFingerprint(settings.apiKey) : ''
    ].join('|');
  }

  async function elevenLabsVoices(settings, timeoutMs) {
    try {
      const response = await fetchImpl(elevenLabsUrl(settings, '/voices?page_size=100'), {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { ...authHeaders(settings), accept: 'application/json' },
        redirect: 'error'
      });
      if (!response.ok) return [];

      const payload = await response.json();
      const raw = Array.isArray(payload) ? payload : payload?.voices || [];
      return raw
        .map((entry) => {
          const id = String(entry?.voice_id || entry?.id || '').trim();
          if (!id || !isValidVoiceForProvider('elevenlabs', id)) return null;
          return {
            id,
            name: String(entry?.name || id),
            note: elevenLabsNote(entry?.labels)
          };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async function compatibleVoices(settings, timeoutMs) {
    const endpoints = [
      `${settings.baseUrl}/audio/voices`,
      `${settings.baseUrl}/voices`
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetchImpl(endpoint, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: authHeaders(settings),
          redirect: 'error'
        });
        if (!response.ok) continue;

        const payload = await response.json();
        const raw = Array.isArray(payload) ? payload : payload?.voices || payload?.data || [];
        const voices = raw
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
              note: known?.note || 'Endpoint voice'
            };
          });
        if (voices.length) return voices;
      } catch {
        // Try the next endpoint.
      }
    }

    return [];
  }

  async function fetchVoices({ force = false, timeoutMs = 2500, settingsOverride } = {}) {
    const settings = settingsOverride || settingsNow();
    const sig = signature(settings);

    if (!force && voiceCache?.signature === sig && Date.now() - voiceCache.at < 60_000) {
      return voiceCache.voices;
    }

    let remote = [];
    if (settings.provider === 'elevenlabs') {
      remote = await elevenLabsVoices(settings, timeoutMs);
    } else if (settings.provider !== 'openai') {
      remote = await compatibleVoices(settings, timeoutMs);
    }

    const merged = new Map();
    for (const voice of settings.voices) merged.set(voice.id, voice);
    for (const voice of remote) merged.set(voice.id, voice);

    voiceCache = { signature: sig, at: Date.now(), voices: [...merged.values()] };
    return voiceCache.voices;
  }

  async function probe({ timeoutMs = 2500, settingsOverride } = {}) {
    const settings = settingsOverride || settingsNow();
    const provider = getProvider(settings.provider);
    const base = {
      provider: settings.provider,
      providerLabel: provider?.label || settings.provider,
      baseUrl: settings.baseUrl,
      model: settings.model,
      keyConfigured: Boolean(settings.apiKey)
    };

    const endpoints =
      settings.provider === 'elevenlabs'
        ? [elevenLabsUrl(settings, '/voices?page_size=1')]
        : [`${settings.baseUrl}/models`, `${settings.baseUrl}/audio/voices`, `${settings.baseUrl}/voices`];

    let lastError = null;
    for (const endpoint of endpoints) {
      try {
        const response = await fetchImpl(endpoint, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: authHeaders(settings),
          redirect: 'error'
        });

        if (response.status === 401 || response.status === 403) {
          return {
            ...base,
            reachable: true,
            authorized: false,
            status: response.status,
            message: 'The API key was rejected.'
          };
        }
        if (response.status < 500) {
          return {
            ...base,
            reachable: true,
            authorized: true,
            status: response.status
          };
        }
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = String(error?.cause?.code || error?.message || 'unreachable');
      }
    }

    return {
      ...base,
      reachable: false,
      authorized: null,
      message: lastError || 'unreachable'
    };
  }

  async function requestElevenLabs(settings, text, voice, context) {
    if (text.length > ELEVEN_LABS_MAX_CHARS) {
      throw new HttpError(
        413,
        `ElevenLabs accepts ${ELEVEN_LABS_MAX_CHARS.toLocaleString()} characters per request. This passage is ${text.length.toLocaleString()}.`,
        'tts_text_too_long'
      );
    }

    const query = new URLSearchParams({
      output_format: elevenLabsOutputFormat(settings),
      // Keep read-aloud text out of the provider's history and logs.
      enable_logging: 'false'
    });
    const url = `${elevenLabsUrl(settings, `/text-to-speech/${encodeURIComponent(voice)}`)}?${query}`;

    const body = { text, model_id: settings.model };
    if (context?.previousText) body.previous_text = context.previousText;
    if (context?.nextText) body.next_text = context.nextText;

    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'audio/mpeg',
          ...authHeaders(settings)
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(settings.timeoutMs),
        redirect: 'error'
      });
    } catch (error) {
      throw new HttpError(
        503,
        `${getProvider(settings.provider)?.label || 'The voice service'} is not reachable. Check the connection and try again.`,
        'tts_unavailable'
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json();
        detail = String(payload?.detail?.message || payload?.detail || payload?.error?.message || '').slice(0, 300);
      } catch {
        // Non-JSON error body.
      }
      throw providerError(settings, response.status, detail);
    }

    return response;
  }

  async function requestCompatible(settings, text, voice) {
    const body = {
      model: settings.model,
      voice,
      input: text,
      response_format: settings.format
    };

    let response;
    try {
      response = await fetchImpl(`${settings.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(settings)
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(settings.timeoutMs),
        redirect: 'error'
      });
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? 'timed out' : 'is not reachable';
      throw new HttpError(
        503,
        `The voice service ${reason} at ${settings.baseUrl}. Check the provider configuration and try again.`,
        'tts_unavailable'
      );
    }

    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json();
        detail = String(payload?.error?.message || payload?.detail || '').slice(0, 300);
      } catch {
        // Non-JSON error body.
      }
      throw providerError(settings, response.status, detail);
    }

    return response;
  }

  async function requestSpeech(settings, text, voice, context) {
    const response =
      settings.provider === 'elevenlabs'
        ? await requestElevenLabs(settings, text, voice, context)
        : await requestCompatible(settings, text, voice);

    const arrayBuffer = await response.arrayBuffer();
    if (!arrayBuffer.byteLength) {
      throw new HttpError(502, 'The voice service returned empty audio.', 'tts_empty');
    }

    const format = audioFormat(settings);
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: contentTypeFor(format, response.headers.get('content-type')),
      format
    };
  }

  function cacheKey(settings, voice, text, context) {
    const format = String(settings.format || 'mp3').toLowerCase();

    const parts = settings.usingEnvDefaults
      ? [settings.model, voice, format, text]
      : [settings.provider, settings.baseUrl, settings.model, format, voice, text];

    // Passage context changes the audio, so it must change the cache entry too.
    if (settings.provider === 'elevenlabs' && context) {
      parts.push(`prev:${context.previousText || ''}`, `next:${context.nextText || ''}`);
    }

    return crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex');
  }

  async function synthesize(text, voice, { context } = {}) {
    const settings = settingsNow();

    if (!isValidVoiceForProvider(settings.provider, voice)) {
      throw new HttpError(400, 'That is not a valid voice name.', 'invalid_voice', {
        provider: settings.provider,
        voice
      });
    }

    const key = cacheKey(settings, voice, text, context);

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
      const audio = await requestSpeech(settings, text, voice, context);
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
    probe,
    settings: settingsNow
  };
}
