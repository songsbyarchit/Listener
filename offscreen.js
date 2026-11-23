/* LISTNR offscreen audio engine.
 *
 * Two engines:
 *  - "free":   speechSynthesis, one utterance per sentence. Exact gaps are
 *              inserted between utterances, so paragraphs breathe.
 *  - "studio": OpenAI speech API, one request per paragraph group, prefetched
 *              one group ahead. Playback speed uses playbackRate (pitch kept).
 *
 * The engine owns the queue. The service worker forwards events to the reader.
 */

'use strict';

const DEFAULTS = {
  engine: 'free',
  rate: 1,
  voiceURI: '',
  sentenceGap: 160,
  paragraphGap: 600,
  studioModel: 'gpt-4o-mini-tts',
  studioVoice: 'coral'
};

const PRICE_PER_MILLION = {
  'tts-1': 15,
  'tts-1-hd': 30,
  'gpt-4o-mini-tts': 15.92
};

const STUDIO_VOICES = [
  'coral', 'alloy', 'ash', 'ballad', 'echo', 'fable',
  'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'
];

const MAX_GROUP_CHARS = 3000;

let settings = { ...DEFAULTS, openaiKey: '' };
let segments = [];
let meta = {};
let idx = 0;
let state = 'idle'; // playing | paused | idle
let session = 0;
let gapTimer = null;
let utterance = null;
let lastBoundary = 0;
let pausedAt = null;
let restartDirty = false;
let studioChars = 0;
let studioGroups = [];

const studio = {
  audio: null,
  cache: new Map(),
  playToken: 0,
  bounds: [],
  sentIndex: -1
};

/* ------------------------------------------------------------------ */
/* Messaging                                                           */
/* ------------------------------------------------------------------ */

function emit(event) {
  chrome.runtime.sendMessage({ source: 'offscreen', event }).catch(() => {});
}

function emitUsage() {
  const price = PRICE_PER_MILLION[settings.studioModel] ?? 15.92;
  const cost = Math.round((studioChars / 1_000_000) * price * 1000) / 1000;
  emit({ kind: 'usage', chars: studioChars, cost });
}

function publicSettings() {
  return {
    engine: settings.engine,
    rate: settings.rate,
    voiceURI: settings.voiceURI,
    sentenceGap: settings.sentenceGap,
    paragraphGap: settings.paragraphGap,
    studioModel: settings.studioModel,
    studioVoice: settings.studioVoice
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') return;
  handleMessage(message)
    .then((result) => sendResponse(result || { ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

async function handleMessage(message) {
  switch (message.action) {
    case 'start':
      await startSession(message);
      return { ok: true };
    case 'cmd':
      return handleCommand(message.cmd, message.payload || {});
    default:
      return { ok: false, error: `Unknown action: ${message.action}` };
  }
}

async function handleCommand(cmd, payload) {
  switch (cmd) {
    case 'play':
    case 'resume':
      await play();
      break;
    case 'pause':
      pause();
      break;
    case 'playpause':
      if (state === 'playing') pause();
      else await play();
      break;
    case 'stop':
      stopSession();
      break;
    case 'next':
      jump(idx + 1, { shouldPlay: state === 'playing' });
      break;
    case 'prev':
      jump(lastBoundary > 6 ? idx : idx - 1, { shouldPlay: state === 'playing' });
      break;
    case 'seek':
      jump(Number(payload.index), { shouldPlay: state === 'playing' });
      break;
    case 'setRate':
      setRate(payload.rate);
      break;
    case 'setVoice':
      setVoice(payload.voiceURI);
      break;
    case 'setEngine':
      setEngine(payload.engine);
      break;
    case 'reloadSettings':
      settings = await loadSettings();
      emit({ kind: 'settings', settings: publicSettings() });
      break;
    default:
      return { ok: false, error: `Unknown command: ${cmd}` };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

async function loadSettings() {
  try {
    const [sync, local] = await Promise.all([
      chrome.storage.sync.get(DEFAULTS),
      chrome.storage.local.get(['openaiKey'])
    ]);
    return { ...DEFAULTS, ...sync, openaiKey: local.openaiKey || '' };
  } catch {
    return { ...DEFAULTS, openaiKey: '' };
  }
}

loadSettings().then((loaded) => {
  settings = loaded;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    for (const [key, change] of Object.entries(changes)) {
      if (key in DEFAULTS && change.newValue !== undefined) settings[key] = change.newValue;
    }
  } else if (area === 'local' && changes.openaiKey) {
    settings.openaiKey = changes.openaiKey.newValue || '';
  }
});

/* ------------------------------------------------------------------ */
/* Session lifecycle                                                   */
/* ------------------------------------------------------------------ */

async function startSession(message) {
  stopAllAudio();
  const my = ++session;

  segments = Array.isArray(message.segments)
    ? message.segments.filter((segment) => segment && typeof segment.text === 'string' && segment.text.trim())
    : [];
  meta = message.meta || {};
  idx = 0;
  lastBoundary = 0;
  pausedAt = null;
  restartDirty = false;
  studioChars = 0;
  studioGroups = buildGroups(segments);
  state = 'idle';

  settings = await loadSettings();
  if (my !== session) return;

  if (settings.engine === 'studio' && !settings.openaiKey) {
    settings.engine = 'free';
    emit({
      kind: 'notice',
      message: 'No OpenAI key saved — using the free browser voice.'
    });
  }

  emit({ kind: 'session', settings: publicSettings(), total: segments.length, meta });
  emit({ kind: 'usage', chars: 0, cost: 0 });

  if (!segments.length) {
    state = 'idle';
    emit({ kind: 'finished' });
    return;
  }

  await primeVoices();
  if (my !== session) return;

  state = 'playing';
  emit({ kind: 'state', state });
  setTimeout(() => {
    if (my === session && state === 'playing') speakCurrent(0);
  }, 60);
}

function stopSession() {
  session += 1;
  stopAllAudio();
  segments = [];
  studioGroups = [];
  idx = 0;
  state = 'idle';
  emit({ kind: 'state', state });
}

function stopAllAudio() {
  clearGap();
  cancelSpeech();
  haltStudio();
  clearStudioCache();
  studioChars = 0;
  pausedAt = null;
  restartDirty = false;
}

function finishSession() {
  clearGap();
  cancelSpeech();
  haltStudio();
  idx = segments.length;
  state = 'idle';
  emit({ kind: 'state', state });
  emit({ kind: 'finished' });
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

async function play() {
  if (!segments.length) return;

  if (state === 'playing') return;

  if (state === 'paused') {
    if (settings.engine === 'studio' && studio.audio) {
      state = 'playing';
      emit({ kind: 'state', state });
      try {
        await studio.audio.play();
      } catch {
        emit({ kind: 'error', message: 'Audio could not resume. Press play again.' });
      }
      return;
    }

    state = 'playing';
    emit({ kind: 'state', state });

    if (!restartDirty && utterance && speechSynthesis.paused) {
      try {
        speechSynthesis.resume();
        pausedAt = null;
        return;
      } catch {
        /* fall through and restart the sentence */
      }
    }

    const offset = pausedAt && pausedAt.index === idx ? pausedAt.charOffset : 0;
    pausedAt = null;
    restartDirty = false;
    cancelSpeech();
    speakCurrent(offset);
    return;
  }

  // idle (fresh session or after the end)
  if (idx >= segments.length) idx = 0;
  state = 'playing';
  emit({ kind: 'state', state });
  await primeVoices();
  speakCurrent(0);
}

function pause() {
  if (state !== 'playing') return;

  state = 'paused';
  pausedAt = { index: idx, charOffset: lastBoundary };
  clearGap();

  if (settings.engine === 'studio' && studio.audio) {
    try {
      studio.audio.pause();
    } catch {
      /* ignore */
    }
    emit({ kind: 'state', state });
    return;
  }

  const current = utterance;
  if (current) {
    try {
      speechSynthesis.pause();
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (state !== 'paused' || utterance !== current) return;
      if (!speechSynthesis.paused) {
        // Pause is unsupported by this voice/platform. Cancel and resume from
        // the last word boundary instead.
        current.__cancelled = true;
        utterance = null;
        try {
          speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
    }, 160);
  }

  emit({ kind: 'state', state });
}

function jump(target, { shouldPlay = state === 'playing' } = {}) {
  if (!segments.length) return;
  const numeric = Number(target);
  const nextIndex = Number.isFinite(numeric) ? numeric : idx;
  const bounded = Math.max(0, Math.min(segments.length - 1, nextIndex));

  cancelSpeech();
  clearGap();
  haltStudio();

  idx = bounded;
  lastBoundary = 0;
  pausedAt = null;
  restartDirty = false;

  if (shouldPlay) {
    state = 'playing';
    emit({ kind: 'state', state });
    speakCurrent(0);
  } else {
    state = 'paused';
    emit({ kind: 'state', state });
    emit({ kind: 'segment', index: idx, charOffset: 0 });
  }
}

function setRate(value) {
  const rate = clamp(Number(value) || 1, 0.5, 3);
  settings.rate = rate;

  if (state === 'paused') {
    restartDirty = true;
    return;
  }
  if (state !== 'playing') return;

  if (settings.engine === 'studio' && studio.audio) {
    studio.audio.playbackRate = rate;
    try {
      studio.audio.preservesPitch = true;
    } catch {
      /* older Chrome */
    }
    return;
  }

  const offset = lastBoundary;
  cancelSpeech();
  clearGap();
  restartDirty = false;
  setTimeout(() => {
    if (state === 'playing') speakCurrent(offset);
  }, 40);
}

function setVoice(voiceURI) {
  settings.voiceURI = typeof voiceURI === 'string' ? voiceURI : '';

  if (state === 'paused') {
    restartDirty = true;
    return;
  }
  if (state !== 'playing' || settings.engine !== 'free') return;

  const offset = lastBoundary;
  cancelSpeech();
  clearGap();
  setTimeout(() => {
    if (state === 'playing') speakCurrent(offset);
  }, 40);
}

function setEngine(engine) {
  const next = engine === 'studio' ? 'studio' : 'free';
  if (next === 'studio' && !settings.openaiKey) {
    emit({ kind: 'notice', message: 'Add an OpenAI API key to use Studio voice.' });
    return;
  }
  if (settings.engine === next) return;

  settings.engine = next;
  if (state !== 'playing' && state !== 'paused') return;

  const wasPlaying = state === 'playing';
  cancelSpeech();
  clearGap();
  haltStudio();

  if (wasPlaying) {
    state = 'playing';
    emit({ kind: 'state', state });
    speakCurrent(0);
  } else {
    state = 'paused';
    emit({ kind: 'state', state });
    emit({ kind: 'segment', index: idx, charOffset: 0 });
  }
}

/* ------------------------------------------------------------------ */
/* Free browser voice                                                  */
/* ------------------------------------------------------------------ */

function speakCurrent(offset = 0) {
  clearGap();
  if (!segments.length) return;
  if (idx >= segments.length) {
    finishSession();
    return;
  }
  if (idx < 0) idx = 0;

  if (settings.engine === 'studio') {
    studioPlay();
    return;
  }
  speakLocal(offset);
}

function speakLocal(fromChar = 0) {
  const segment = segments[idx];
  if (!segment) return;

  const text = segment.text.slice(Math.max(0, fromChar));
  if (!text.trim()) {
    advanceWithGap();
    return;
  }

  const current = new SpeechSynthesisUtterance(text);
  const voice = resolveVoice();
  if (voice) {
    current.voice = voice;
    current.lang = voice.lang;
  } else if (navigator.language) {
    current.lang = navigator.language;
  }
  current.rate = clamp(settings.rate, 0.5, 3);
  current.pitch = 1;
  current.volume = 1;
  current.__cancelled = false;

  current.onstart = () => {
    if (utterance !== current || current.__cancelled) return;
    if (state !== 'playing') {
      try {
        speechSynthesis.pause();
      } catch {
        /* ignore */
      }
    }
    emit({ kind: 'segment', index: idx, charOffset: fromChar || 0 });
    emit({ kind: 'state', state });
  };

  current.onboundary = (event) => {
    if (utterance !== current || current.__cancelled) return;
    if (event.name && event.name !== 'word' && event.name !== 'sentence') return;
    const charIndex = event.charIndex || 0;
    lastBoundary = (fromChar || 0) + charIndex;
    emit({
      kind: 'boundary',
      index: idx,
      baseOffset: fromChar || 0,
      charIndex,
      charLength: event.charLength || 0
    });
  };

  current.onend = () => {
    if (utterance !== current || current.__cancelled) return;
    utterance = null;
    lastBoundary = 0;
    if (state === 'playing') advanceWithGap();
  };

  current.onerror = (event) => {
    if (utterance !== current || current.__cancelled) return;
    const error = event?.error;
    if (error === 'interrupted' || error === 'canceled') return;
    utterance = null;
    emit({ kind: 'error', message: `Browser voice error: ${error || 'unknown'}` });
    if (state === 'playing') advanceWithGap();
  };

  utterance = current;
  lastBoundary = fromChar || 0;

  try {
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(current);
  } catch {
    emit({ kind: 'error', message: 'The browser could not start speech synthesis.' });
  }
}

function advanceWithGap() {
  const previous = segments[idx];
  idx += 1;
  if (idx >= segments.length) {
    finishSession();
    return;
  }
  const next = segments[idx];
  const gap = gapMs(previous, next);
  gapTimer = setTimeout(() => {
    gapTimer = null;
    if (state === 'playing') speakCurrent(0);
  }, gap);
}

function gapMs(previous, next) {
  if (!previous || !next) return 40;
  let gap = next.p !== previous.p ? settings.paragraphGap : settings.sentenceGap;
  if (isHeading(previous.kind) || isHeading(next.kind)) {
    gap = Math.max(gap, settings.paragraphGap) + 200;
  }
  return Math.max(40, Math.round(gap / Math.max(1, settings.rate)));
}

function cancelSpeech() {
  if (utterance) {
    utterance.__cancelled = true;
    utterance = null;
  }
  try {
    speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  lastBoundary = 0;
}

function clearGap() {
  if (gapTimer) {
    clearTimeout(gapTimer);
    gapTimer = null;
  }
}

function resolveVoice() {
  if (!settings.voiceURI) return null;
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((voice) => voice.voiceURI === settings.voiceURI) ||
    voices.find((voice) => voice.name === settings.voiceURI) ||
    null
  );
}

function primeVoices() {
  if (speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve();
    };
    speechSynthesis.addEventListener('voiceschanged', finish);
    setTimeout(finish, 1500);
  });
}

/* ------------------------------------------------------------------ */
/* Studio voice (OpenAI)                                               */
/* ------------------------------------------------------------------ */

function buildGroups(list) {
  const groups = [];
  let current = null;
  for (const segment of list) {
    const tooLong = current && current.text.length + segment.text.length + 1 > MAX_GROUP_CHARS;
    if (!current || segment.p !== current.p || tooLong) {
      current = {
        p: segment.p,
        start: segment.i,
        end: segment.i + 1,
        text: segment.text,
        sentences: [segment]
      };
      groups.push(current);
    } else {
      current.text += ' ' + segment.text;
      current.end = segment.i + 1;
      current.sentences.push(segment);
    }
  }
  return groups;
}

function groupFor(index) {
  for (const group of studioGroups) {
    if (index >= group.start && index < group.end) return group;
  }
  return studioGroups[0] || null;
}

function groupKey(group) {
  return `${group.start}:${group.end}`;
}

async function studioPlay() {
  const group = groupFor(idx);
  if (!group) {
    finishSession();
    return;
  }
  if (!settings.openaiKey) {
    fallbackToFree('No OpenAI key saved.');
    return;
  }

  const mySession = session;
  const token = ++studio.playToken;

  let url;
  try {
    url = await groupAudio(group);
  } catch (error) {
    if (mySession !== session || token !== studio.playToken) return;
    if (error?.message === 'Stopped') return;
    fallbackToFree(`Studio voice failed: ${error?.message || 'unknown error'}`);
    return;
  }

  if (mySession !== session || token !== studio.playToken) return;
  startStudioPlayback(url, group, token);
  prefetchAfter(group);
}

function fallbackToFree(message) {
  emit({ kind: 'error', message });
  settings.engine = 'free';
  emit({ kind: 'engine', engine: 'free' });
  emit({ kind: 'notice', message: 'Switched to the free browser voice for this session.' });
  if (state === 'playing') speakLocal(0);
}

function groupAudio(group) {
  const key = groupKey(group);
  const cached = studio.cache.get(key);
  if (cached) return cached.promise;

  const mySession = session;
  const promise = requestSpeech(group.text).then((url) => {
    if (mySession !== session) {
      URL.revokeObjectURL(url);
      throw new Error('Stopped');
    }
    studioChars += group.text.length;
    emitUsage();
    return url;
  });

  const entry = { promise, url: null };
  studio.cache.set(key, entry);
  promise
    .then((url) => {
      entry.url = url;
    })
    .catch(() => {
      if (studio.cache.get(key) === entry) studio.cache.delete(key);
    });

  trimCache(group);
  return promise;
}

function trimCache(currentGroup) {
  if (studio.cache.size <= 10) return;
  for (const [key, entry] of studio.cache) {
    if (studio.cache.size <= 10) break;
    if (key === groupKey(currentGroup)) continue;
    if (entry.url) URL.revokeObjectURL(entry.url);
    studio.cache.delete(key);
  }
}

function clearStudioCache() {
  for (const entry of studio.cache.values()) {
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  studio.cache.clear();
}

function prefetchAfter(group) {
  const position = studioGroups.indexOf(group);
  const next = studioGroups[position + 1];
  if (next) groupAudio(next).catch(() => {});
}

function startStudioPlayback(url, group, token) {
  // Detach a stale audio node without invalidating the current token.
  if (studio.audio) {
    const old = studio.audio;
    studio.audio = null;
    old.onended = null;
    old.ontimeupdate = null;
    old.onerror = null;
    try {
      old.pause();
    } catch {
      /* ignore */
    }
    try {
      old.removeAttribute('src');
      old.load();
    } catch {
      /* ignore */
    }
  }

  const audio = new Audio(url);
  audio.preload = 'auto';
  audio.playbackRate = clamp(settings.rate, 0.5, 3);
  try {
    audio.preservesPitch = true;
  } catch {
    /* older Chrome */
  }

  studio.audio = audio;
  studio.bounds = [];
  studio.sentIndex = -1;

  const sentences = group.sentences;
  const found = sentences.findIndex((sentence) => sentence.i === idx);
  const startPosition = Math.max(0, found);

  const begin = () => {
    if (studio.audio !== audio || token !== studio.playToken) return;
    studio.bounds = computeBounds(audio, sentences);
    const startAt = studio.bounds[startPosition]?.start || 0;
    if (startAt > 0.04) {
      try {
        audio.currentTime = startAt;
      } catch {
        /* seeking not ready */
      }
    }

    if (state !== 'playing') {
      studio.sentIndex = startPosition;
      return;
    }

    audio
      .play()
      .then(() => {
        if (studio.audio !== audio || token !== studio.playToken) return;
        studio.sentIndex = startPosition;
        idx = sentences[startPosition]?.i ?? idx;
        emit({ kind: 'segment', index: idx, charOffset: 0 });
        emit({ kind: 'state', state: 'playing' });
      })
      .catch(() => {
        emit({ kind: 'error', message: 'Studio audio was blocked. Press play again.' });
        state = 'paused';
        emit({ kind: 'state', state });
      });
  };

  if (audio.readyState >= 1) begin();
  else audio.addEventListener('loadedmetadata', begin, { once: true });

  audio.ontimeupdate = () => {
    if (studio.audio !== audio || !studio.bounds.length) return;
    const time = audio.currentTime;
    let current = studio.bounds.findIndex((bound) => time >= bound.start && time < bound.end);
    if (current < 0) current = studio.bounds.length - 1;

    if (current !== studio.sentIndex) {
      studio.sentIndex = current;
      const bound = studio.bounds[current];
      if (bound && bound.index !== idx) {
        idx = bound.index;
        emit({ kind: 'segment', index: idx, charOffset: 0 });
      }
    }
  };

  audio.onended = () => {
    if (studio.audio !== audio || token !== studio.playToken) return;
    studio.audio = null;
    studio.bounds = [];
    studio.sentIndex = -1;

    if (group.end >= segments.length) {
      finishSession();
      return;
    }

    idx = group.end;
    if (state !== 'playing') {
      emit({ kind: 'segment', index: idx, charOffset: 0 });
      return;
    }

    const gap = gapMs(segments[group.end - 1], segments[group.end]);
    gapTimer = setTimeout(() => {
      gapTimer = null;
      if (state === 'playing') speakCurrent(0);
    }, gap);
  };

  audio.onerror = () => {
    if (studio.audio !== audio) return;
    studio.audio = null;
    emit({ kind: 'error', message: 'Studio audio could not be played.' });
    state = 'paused';
    emit({ kind: 'state', state });
  };
}

function computeBounds(audio, sentences) {
  const total = sentences.reduce((sum, sentence) => sum + sentence.text.length + 1, 0) || 1;
  const duration =
    Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : total / 14;

  let accumulated = 0;
  return sentences.map((sentence) => {
    const start = (accumulated / total) * duration;
    accumulated += sentence.text.length + 1;
    const end = (accumulated / total) * duration;
    return { start, end, index: sentence.i };
  });
}

function haltStudio() {
  studio.playToken += 1;
  const audio = studio.audio;
  studio.audio = null;
  studio.bounds = [];
  studio.sentIndex = -1;
  if (!audio) return;
  audio.onended = null;
  audio.ontimeupdate = null;
  audio.onerror = null;
  try {
    audio.pause();
  } catch {
    /* ignore */
  }
  try {
    audio.removeAttribute('src');
    audio.load();
  } catch {
    /* ignore */
  }
}

async function requestSpeech(text) {
  if (!settings.openaiKey) throw new Error('No API key saved.');

  const model = settings.studioModel || 'gpt-4o-mini-tts';
  const body = {
    model,
    voice: STUDIO_VOICES.includes(settings.studioVoice) ? settings.studioVoice : 'coral',
    input: text,
    response_format: 'mp3'
  };

  if (model === 'gpt-4o-mini-tts') {
    body.instructions =
      'Read with warm, natural pacing, clear consonants, and gentle pauses at punctuation and paragraph breaks. Keep the tone conversational, never rushed.';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? 'request timed out' : 'network error');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = payload?.error?.message || '';
    } catch {
      /* not JSON */
    }
    throw new Error(detail || `HTTP ${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error('empty audio response');
  return URL.createObjectURL(blob);
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

function isHeading(kind) {
  return typeof kind === 'string' && /^h[1-6]$/.test(kind);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
