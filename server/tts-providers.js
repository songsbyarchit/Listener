import { isBlockedAddress, isBlockedHostname } from './ssrf.js';
import { HttpError, badRequest } from './errors.js';
import { deleteAppSetting, getAppSetting, setAppSetting } from './db.js';

const KOKORO_VOICE = /^[a-z]{2}_[a-z0-9_]{1,40}$/i;
const GENERIC_VOICE = /^[A-Za-z0-9_-]{1,64}$/;
const MODEL_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const FORMAT_PATTERN = /^(mp3|wav|opus|flac|ogg|aac|pcm)$/i;

const OPENAI_VOICES = [
  { id: 'alloy', name: 'Alloy', note: 'OpenAI · neutral' },
  { id: 'ash', name: 'Ash', note: 'OpenAI · soft male' },
  { id: 'ballad', name: 'Ballad', note: 'OpenAI · expressive male' },
  { id: 'coral', name: 'Coral', note: 'OpenAI · bright female' },
  { id: 'echo', name: 'Echo', note: 'OpenAI · warm male' },
  { id: 'fable', name: 'Fable', note: 'OpenAI · British narrator' },
  { id: 'nova', name: 'Nova', note: 'OpenAI · bright female' },
  { id: 'onyx', name: 'Onyx', note: 'OpenAI · deep male' },
  { id: 'sage', name: 'Sage', note: 'OpenAI · calm female' },
  { id: 'shimmer', name: 'Shimmer', note: 'OpenAI · clear female' },
  { id: 'verse', name: 'Verse', note: 'OpenAI · expressive male' },
  { id: 'marin', name: 'Marin', note: 'OpenAI · best quality' },
  { id: 'cedar', name: 'Cedar', note: 'OpenAI · best quality' }
];

export const PROVIDERS = {
  kokoro: {
    id: 'kokoro',
    label: 'Local Kokoro (free)',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8880/v1',
    model: 'kokoro',
    models: ['kokoro'],
    format: 'mp3',
    requiresKey: false,
    voices: null,
    voicePattern: KOKORO_VOICE,
    note: 'Free and private. Needs Kokoro-FastAPI running on this machine.',
    docs: null
  },
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    kind: 'elevenlabs',
    baseUrl: 'https://api.elevenlabs.io',
    model: 'eleven_multilingual_v2',
    models: ['eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2_5'],
    format: 'mp3',
    requiresKey: true,
    voices: null,
    voicePattern: GENERIC_VOICE,
    note: 'Hosted voice. Roughly $10 per hour of audio on Multilingual v2; Flash and Turbo cost about half.',
    docs: 'https://elevenlabs.io/pricing'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (retires Jan 2027)',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-tts',
    models: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
    format: 'mp3',
    requiresKey: true,
    voices: OPENAI_VOICES,
    voicePattern: GENERIC_VOICE,
    note: 'Hosted voice. Roughly $1 per hour of audio on tts-1. OpenAI retires these models on 6 January 2027.',
    docs: 'https://platform.openai.com/docs/guides/text-to-speech',
    sunset: '2027-01-06'
  },
  custom: {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    kind: 'openai-compatible',
    baseUrl: '',
    model: '',
    models: [],
    format: 'mp3',
    requiresKey: false,
    voices: null,
    voicePattern: GENERIC_VOICE,
    note: 'Any endpoint that speaks the OpenAI /audio/speech API — a LAN server, proxy, or another Kokoro box.',
    docs: null
  }
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

const SETTING_KEYS = [
  'tts.provider',
  'tts.baseUrl',
  'tts.model',
  'tts.format',
  'tts.apiKey',
  'tts.apiKeyOrigin',
  'tts.voices'
];

export function getProvider(id) {
  return PROVIDERS[id] || null;
}

export function providerPresets() {
  return PROVIDER_IDS.map((id) => {
    const provider = PROVIDERS[id];
    return {
      id,
      label: provider.label,
      baseUrl: provider.baseUrl,
      model: provider.model,
      models: provider.models,
      format: provider.format,
      requiresKey: provider.requiresKey,
      note: provider.note,
      docs: provider.docs || null,
      sunset: provider.sunset || null
    };
  });
}

function bareHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

export function isLoopbackHost(hostname) {
  const host = bareHost(hostname);
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
}

export function isPrivateHost(hostname) {
  const host = bareHost(hostname);
  if (!host) return false;
  if (host === 'localhost') return true;
  if (!host.includes('.')) return true; // Docker service names such as "kokoro".
  if (isBlockedAddress(host)) return true;
  if (isBlockedHostname(host)) return true;
  return false;
}

export function originOf(value) {
  try {
    return new URL(String(value)).origin;
  } catch {
    return null;
  }
}

export function normalizeBaseUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) throw badRequest('Enter a base URL.');
  if (text.length > 500) throw badRequest('That base URL is too long.');

  let url;
  try {
    url = new URL(text);
  } catch {
    throw badRequest('That base URL is not a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('The base URL must start with http:// or https://.');
  }
  if (url.username || url.password) {
    throw badRequest('Do not put credentials in the base URL.');
  }
  if (url.search || url.hash) {
    throw badRequest('The base URL cannot contain a query string or fragment.');
  }

  return url.toString().replace(/\/+$/, '');
}

function normalizeModel(value) {
  const model = String(value ?? '').trim();
  if (!model) return '';
  if (!MODEL_PATTERN.test(model)) throw badRequest('That model name is not valid.');
  return model;
}

function normalizeFormat(value) {
  const format = String(value ?? '').trim().toLowerCase();
  if (!format) return 'mp3';
  if (!FORMAT_PATTERN.test(format)) throw badRequest('Unsupported audio format.');
  return format;
}

export function normalizeApiKey(value) {
  const key = String(value ?? '').trim();
  if (!key) return '';
  if (key.length > 512) throw badRequest('That API key is too long.');
  if (/[\s\u0000-\u001f\u007f]/.test(key)) {
    throw badRequest('That API key contains whitespace or invalid characters.');
  }
  return key;
}

function assertTransport(baseUrl, { hasKey }) {
  const url = new URL(baseUrl);
  if (url.protocol === 'https:') return;

  const host = bareHost(url.hostname);
  if (isPrivateHost(host) && (!hasKey || isLoopbackHost(host))) return;

  if (hasKey) {
    throw new HttpError(
      400,
      'Use https:// for a voice service that needs an API key outside this machine.',
      'tts_insecure_url'
    );
  }
  throw new HttpError(400, 'Cloud voice services must use https://.', 'tts_insecure_url');
}

export function parseVoices(value) {
  if (!value) return [];
  const entries = Array.isArray(value) ? value : String(value).split(',');

  return entries
    .map((entry) => {
      if (entry && typeof entry === 'object') {
        const id = String(entry.id || entry.voice_id || '').trim();
        if (!id) return null;
        return {
          id,
          name: String(entry.name || entry.label || id),
          note: String(entry.note || '')
        };
      }
      const [rawId, ...label] = String(entry).split(':');
      const id = rawId.trim();
      if (!id) return null;
      return { id, name: label.join(':').trim() || id, note: '' };
    })
    .filter(Boolean);
}

export function serializeVoices(voices) {
  return (voices || [])
    .map((voice) => (voice.name && voice.name !== voice.id ? `${voice.id}:${voice.name}` : voice.id))
    .join(',');
}

export function isValidVoiceForProvider(providerId, voice) {
  const provider = PROVIDERS[providerId] || PROVIDERS.kokoro;
  const value = String(voice ?? '').trim();
  if (!value || value.length > 64) return false;
  return provider.voicePattern.test(value);
}

function voicesFor(providerId, config) {
  const provider = PROVIDERS[providerId] || PROVIDERS.kokoro;
  if (providerId === 'kokoro') {
    return Array.isArray(config.tts.voices) ? config.tts.voices : [];
  }
  return provider.voices ? provider.voices.map((voice) => ({ ...voice })) : [];
}

export function readTtsSettings(db, config) {
  const rows = new Map(
    db
      .prepare(`SELECT key, value FROM app_settings WHERE key IN (${SETTING_KEYS.map(() => '?').join(',')})`)
      .all(...SETTING_KEYS)
      .map((row) => [row.key, row.value])
  );

  const providerId = rows.get('tts.provider');
  const provider = PROVIDERS[providerId];

  if (!provider) {
    const envProviderId = PROVIDERS[config.tts.provider] ? config.tts.provider : 'kokoro';
    const envProvider = PROVIDERS[envProviderId];
    const apiKey = config.tts.apiKey || '';

    // A headless setup can set only TTS_PROVIDER + TTS_API_KEY. In that case
    // the Kokoro defaults for URL and model do not apply.
    const baseUrl =
      envProviderId !== 'kokoro' && config.tts.baseUrl === PROVIDERS.kokoro.baseUrl
        ? envProvider.baseUrl
        : config.tts.baseUrl;
    const model =
      envProviderId !== 'kokoro' && config.tts.model === PROVIDERS.kokoro.model
        ? envProvider.model
        : config.tts.model;

    return {
      provider: envProviderId,
      providerConfig: envProvider,
      baseUrl,
      model,
      format: config.tts.format || envProvider.format || 'mp3',
      apiKey,
      apiKeyOrigin: apiKey ? originOf(baseUrl) : null,
      voices: voicesFor(envProviderId, config),
      voice: config.tts.voice,
      timeoutMs: config.tts.timeoutMs,
      usingEnvDefaults: true
    };
  }

  const baseUrl = rows.get('tts.baseUrl') ?? provider.baseUrl;
  const storedOrigin = rows.get('tts.apiKeyOrigin') ?? null;
  const storedKey = rows.get('tts.apiKey') ?? '';
  const keyMatchesOrigin = !storedOrigin || storedOrigin === originOf(baseUrl);
  const storedVoices = parseVoices(rows.get('tts.voices'));
  const presetVoices = voicesFor(providerId, config);

  return {
    provider: providerId,
    providerConfig: provider,
    baseUrl,
    model: rows.get('tts.model') ?? provider.model,
    format: rows.get('tts.format') ?? provider.format ?? 'mp3',
    apiKey: keyMatchesOrigin ? storedKey : '',
    apiKeyOrigin: storedOrigin,
    voices: storedVoices.length ? storedVoices : presetVoices,
    voice: config.tts.voice,
    timeoutMs: config.tts.timeoutMs,
    usingEnvDefaults: false
  };
}

export function resolveTtsSettings(db, config, patch = {}) {
  const base = readTtsSettings(db, config);
  const has = (key) => patch[key] !== undefined && patch[key] !== null;

  const providerId = has('provider') ? String(patch.provider) : base.provider;
  const provider = PROVIDERS[providerId];
  if (!provider) throw badRequest('Unknown voice provider.');

  const switching = providerId !== base.provider;

  const baseUrl = has('baseUrl')
    ? normalizeBaseUrl(patch.baseUrl)
    : switching
      ? provider.baseUrl
      : base.baseUrl;

  if (!baseUrl) throw badRequest('Enter a base URL for that provider.');

  let model = has('model')
    ? normalizeModel(patch.model)
    : switching
      ? provider.model
      : base.model;

  if (!model && providerId === 'kokoro') model = provider.model;
  if (!model && !switching && base.model) model = base.model;
  if (!model && provider.requiresKey) model = provider.model;
  if (!model) throw badRequest('Enter a model name for that provider.');

  const format = has('format')
    ? normalizeFormat(patch.format)
    : switching
      ? provider.format || 'mp3'
      : base.format;

  const baseOrigin = originOf(baseUrl);
  let apiKey;
  if (patch.clearApiKey === true) apiKey = '';
  else if (has('apiKey')) apiKey = normalizeApiKey(patch.apiKey);
  else if (switching || baseOrigin !== base.apiKeyOrigin) apiKey = '';
  else apiKey = base.apiKey;

  if (provider.requiresKey && !apiKey) {
    throw new HttpError(400, `${provider.label} needs an API key.`, 'tts_key_required');
  }

  assertTransport(baseUrl, { hasKey: Boolean(apiKey) });

  let voices;
  if (has('voices')) voices = parseVoices(patch.voices);
  else if (switching) voices = voicesFor(providerId, config);
  else voices = base.voices;

  return {
    provider: providerId,
    providerConfig: provider,
    baseUrl,
    model,
    format,
    apiKey,
    apiKeyOrigin: apiKey ? baseOrigin : null,
    voices,
    voice: base.voice,
    timeoutMs: base.timeoutMs,
    usingEnvDefaults: false
  };
}

export function writeTtsSettings(db, config, patch) {
  const next = resolveTtsSettings(db, config, patch);

  const write = db.transaction(() => {
    setAppSetting(db, 'tts.provider', next.provider);
    setAppSetting(db, 'tts.baseUrl', next.baseUrl);
    setAppSetting(db, 'tts.model', next.model);
    setAppSetting(db, 'tts.format', next.format);

    if (next.apiKey) {
      setAppSetting(db, 'tts.apiKey', next.apiKey);
      setAppSetting(db, 'tts.apiKeyOrigin', next.apiKeyOrigin || originOf(next.baseUrl) || '');
    } else {
      deleteAppSetting(db, 'tts.apiKey');
      deleteAppSetting(db, 'tts.apiKeyOrigin');
    }

    if (next.provider === 'custom' && next.voices.length) {
      setAppSetting(db, 'tts.voices', serializeVoices(next.voices));
    } else {
      deleteAppSetting(db, 'tts.voices');
    }
  });

  write();
  return readTtsSettings(db, config);
}

export function resetTtsSettings(db) {
  const remove = db.transaction(() => {
    for (const key of SETTING_KEYS) deleteAppSetting(db, key);
  });
  remove();
}

export function publicTtsSettings(settings) {
  const provider = PROVIDERS[settings.provider] || PROVIDERS.kokoro;
  return {
    provider: settings.provider,
    providerLabel: provider.label,
    baseUrl: settings.baseUrl,
    model: settings.model,
    format: settings.format,
    apiKeyConfigured: Boolean(settings.apiKey),
    apiKeyHint: settings.apiKey ? String(settings.apiKey).slice(-4) : null,
    usingEnvDefaults: Boolean(settings.usingEnvDefaults),
    note: provider.note,
    docs: provider.docs || null,
    sunset: provider.sunset || null,
    voices: settings.voices,
    providers: providerPresets()
  };
}

function voiceId(voice) {
  return typeof voice === 'string' ? voice : voice?.id;
}

export function effectiveDefaultVoice(db, settings, knownVoices = []) {
  const provider = settings.provider;
  const discovered = knownVoices.map(voiceId).filter((id) => isValidVoiceForProvider(provider, id));
  const configured = (settings.voices || [])
    .map(voiceId)
    .filter((id) => isValidVoiceForProvider(provider, id));

  const stored = getAppSetting(db, 'defaultVoice');
  const all = [...new Set([...discovered, ...configured])];

  // A saved default is only meaningful if the active provider actually has it.
  if (stored && isValidVoiceForProvider(provider, stored) && (!all.length || all.includes(stored))) {
    return stored;
  }

  if (discovered.length) return discovered[0];
  if (configured.length) return configured[0];

  // The env-configured TTS_VOICE only makes sense for a local/custom endpoint;
  // a hosted provider must not inherit a Kokoro voice id.
  const envVoiceApplies = settings.usingEnvDefaults || provider === 'kokoro' || provider === 'custom';
  if (envVoiceApplies && settings.voice && isValidVoiceForProvider(provider, settings.voice)) {
    return settings.voice;
  }

  return provider === 'kokoro' ? settings.voice || 'af_heart' : '';
}

export function elevenLabsUrl(settings, path) {
  const base = String(settings.baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '');
  return `${base}/v1${path}`;
}
