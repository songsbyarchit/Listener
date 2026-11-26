'use strict';

const PREF_KEY = 'listnr:prefs';
const SERVER_URL = 'http://127.0.0.1:8787';

const DEFAULTS = Object.freeze({
  voice: 'af_heart',
  rate: 1,
  volume: 1,
  sentenceGap: 160,
  paragraphGap: 600,
  follow: true
});

const FALLBACK_VOICES = [
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

const els = {
  read: document.getElementById('read-page'),
  readLabel: document.getElementById('read-label'),
  error: document.getElementById('error'),
  note: document.getElementById('server-note'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  voice: document.getElementById('voice'),
  rate: document.getElementById('rate'),
  rateValue: document.getElementById('rate-value'),
  volume: document.getElementById('volume'),
  volumeValue: document.getElementById('volume-value'),
  sentenceGap: document.getElementById('sentence-gap'),
  sentenceGapValue: document.getElementById('sentence-gap-value'),
  paragraphGap: document.getElementById('paragraph-gap'),
  paragraphGapValue: document.getElementById('paragraph-gap-value'),
  follow: document.getElementById('follow'),
  reset: document.getElementById('reset')
};

let prefs = { ...DEFAULTS };
let defaultVoice = DEFAULTS.voice;
let saveTimer = null;

init();

async function init() {
  prefs = normalizePrefs(await readStoredPrefs());
  fillVoices(FALLBACK_VOICES);
  render();
  bind();
  watchStorage();
  checkServer();
}

function normalizePrefs(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    voice: typeof source.voice === 'string' && source.voice ? source.voice : DEFAULTS.voice,
    rate: clampNumber(source.rate, 0.5, 3, DEFAULTS.rate),
    volume: clampNumber(source.volume, 0, 1, DEFAULTS.volume),
    sentenceGap: Math.round(clampNumber(source.sentenceGap, 0, 600, DEFAULTS.sentenceGap)),
    paragraphGap: Math.round(clampNumber(source.paragraphGap, 0, 1500, DEFAULTS.paragraphGap)),
    follow: source.follow !== false
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function formatRate(rate) {
  return `${Number(rate).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}×`;
}

async function readStoredPrefs() {
  try {
    const stored = await chrome.storage.local.get(PREF_KEY);
    return stored?.[PREF_KEY];
  } catch {
    return null;
  }
}

function render() {
  els.rate.value = String(prefs.rate);
  els.rateValue.textContent = formatRate(prefs.rate);
  els.volume.value = String(prefs.volume);
  els.volumeValue.textContent = `${Math.round(prefs.volume * 100)}%`;
  els.sentenceGap.value = String(prefs.sentenceGap);
  els.sentenceGapValue.textContent = `${prefs.sentenceGap} ms`;
  els.paragraphGap.value = String(prefs.paragraphGap);
  els.paragraphGapValue.textContent = `${prefs.paragraphGap} ms`;
  els.follow.checked = prefs.follow;
  if (els.voice.options.length) els.voice.value = prefs.voice;
}

function bind() {
  els.read.addEventListener('click', readThisPage);

  els.rate.addEventListener('input', () => {
    prefs.rate = clampNumber(els.rate.value, 0.5, 3, DEFAULTS.rate);
    els.rateValue.textContent = formatRate(prefs.rate);
    savePrefs();
  });

  els.volume.addEventListener('input', () => {
    prefs.volume = clampNumber(els.volume.value, 0, 1, DEFAULTS.volume);
    els.volumeValue.textContent = `${Math.round(prefs.volume * 100)}%`;
    savePrefs();
  });

  els.sentenceGap.addEventListener('input', () => {
    prefs.sentenceGap = Math.round(clampNumber(els.sentenceGap.value, 0, 600, DEFAULTS.sentenceGap));
    els.sentenceGapValue.textContent = `${prefs.sentenceGap} ms`;
    savePrefs();
  });

  els.paragraphGap.addEventListener('input', () => {
    prefs.paragraphGap = Math.round(clampNumber(els.paragraphGap.value, 0, 1500, DEFAULTS.paragraphGap));
    els.paragraphGapValue.textContent = `${prefs.paragraphGap} ms`;
    savePrefs();
  });

  els.voice.addEventListener('change', () => {
    prefs.voice = els.voice.value || DEFAULTS.voice;
    savePrefs();
  });

  els.follow.addEventListener('change', () => {
    prefs.follow = els.follow.checked;
    savePrefs();
  });

  els.reset.addEventListener('click', () => {
    prefs = { ...DEFAULTS, voice: defaultVoice };
    ensureVoiceOption(prefs.voice);
    els.voice.value = prefs.voice;
    render();
    savePrefs(0);
  });
}

function watchStorage() {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[PREF_KEY]) return;
      prefs = normalizePrefs(changes[PREF_KEY].newValue);
      ensureVoiceOption(prefs.voice);
      render();
    });
  } catch {
    // Storage events are unavailable only on restricted pages.
  }
}

function savePrefs(delay = 150) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      chrome.storage.local.set({ [PREF_KEY]: { ...prefs } }).catch(() => {});
    } catch {
      // Ignore restricted pages.
    }
  }, delay);
}

async function readThisPage() {
  els.error.hidden = true;
  els.read.disabled = true;
  els.readLabel.textContent = 'Starting…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'listnr:read-page' });
    if (result?.ok) {
      window.close();
      return;
    }
    showError(result?.error || 'LISTNR could not start on this page.');
  } catch {
    showError('LISTNR could not reach the extension. Reload it and try again.');
  }
  els.read.disabled = false;
  els.readLabel.textContent = 'Read this page';
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
}

async function checkServer() {
  setStatus('checking');
  try {
    await fetchJson('/api/health', 4000);
  } catch {
    setStatus('offline');
    fillVoices(FALLBACK_VOICES);
    return;
  }

  let payload = null;
  try {
    payload = await fetchJson('/api/voices', 8000);
  } catch {
    payload = null;
  }

  const voices = Array.isArray(payload?.voices) && payload.voices.length ? payload.voices : FALLBACK_VOICES;
  if (typeof payload?.defaultVoice === 'string' && payload.defaultVoice) {
    defaultVoice = payload.defaultVoice;
  }
  fillVoices(voices);
  setStatus('online', payload?.provider);
}

async function fetchJson(path, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SERVER_URL}${path}`, {
      signal: controller.signal,
      cache: 'no-store'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function setStatus(state, provider) {
  els.statusDot.classList.toggle('is-online', state === 'online');
  els.statusDot.classList.toggle('is-offline', state === 'offline');
  els.note.hidden = state !== 'offline';

  if (state === 'checking') {
    els.statusText.textContent = 'Checking server…';
    return;
  }
  if (state === 'offline') {
    els.statusText.textContent = 'Server offline';
    return;
  }
  els.statusText.textContent = provider === 'kokoro' || !provider ? 'Local voice ready' : `${providerLabel(provider)} ready`;
}

function providerLabel(provider) {
  if (provider === 'elevenlabs') return 'ElevenLabs';
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'custom') return 'Custom voice';
  return String(provider).replace(/^\w/, (letter) => letter.toUpperCase());
}

function fillVoices(list) {
  const current = prefs.voice;
  const seen = new Set();
  els.voice.textContent = '';

  for (const voice of list) {
    const id = typeof voice?.id === 'string' ? voice.id : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    els.voice.append(voiceOption(id, voice.name, voice.note));
  }

  ensureVoiceOption(current);
  els.voice.value = current;
}

function ensureVoiceOption(id) {
  if (!id) return;
  if ([...els.voice.options].some((option) => option.value === id)) return;
  els.voice.append(voiceOption(id, id, ''));
  els.voice.value = id;
}

function voiceOption(id, name, note) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = name ? `${name}${note ? ` — ${note}` : ''}` : id;
  return option;
}
