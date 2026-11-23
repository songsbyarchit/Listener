const IS_EXTENSION = location.protocol === 'chrome-extension:';
const IS_PANEL = IS_EXTENSION && document.body?.dataset?.listnrPanel === '1';
const API_BASE = IS_EXTENSION ? 'http://127.0.0.1:8787' : '';
const KOKORO_COMMAND = 'docker run --rm -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest';

const DEFAULTS = {
  voice: 'af_heart',
  rate: 1,
  volume: 1,
  sentenceGap: 160,
  paragraphGap: 600
};

const TOP_VOICES = ['af_heart', 'af_bella', 'am_michael', 'bf_emma'];

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

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.5 5.2c0-.8.9-1.3 1.6-.9l9 6.8c.6.4.6 1.4 0 1.8l-9 6.8c-.7.4-1.6-.1-1.6-.9V5.2Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.3" y="4.4" width="4.2" height="15.2" rx="1.5"/><rect x="13.5" y="4.4" width="4.2" height="15.2" rx="1.5"/></svg>'
};

const SOURCE_LABELS = {
  paste: 'Pasted text',
  txt: 'Text file',
  md: 'Markdown',
  markdown: 'Markdown',
  html: 'HTML',
  htm: 'HTML',
  xhtml: 'HTML',
  pdf: 'PDF',
  epub: 'EPUB',
  image: 'Image OCR',
  url: 'Web page',
  page: 'Web page'
};

const S = {
  serverOnline: false,
  documents: [],
  voices: FALLBACK_VOICES.slice(),
  defaultVoice: 'af_heart',
  tts: null,
  current: null,
  content: null,
  chapters: [],
  segmentMeta: [],
  spans: [],
  cursor: 0,
  settings: { ...DEFAULTS },
  playback: 'idle',
  audio: null,
  previewAudio: null,
  previewUrl: null,
  audioIndex: -1,
  audioCache: new Map(),
  playToken: 0,
  gapTimer: null,
  pollTimer: null,
  saveTimer: null,
  searchTimer: null,
  toastTimer: null,
  bannerKind: null,
  view: 'empty',
  pollFailures: 0,
  started: false
};

let els = {};

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

init();

async function init() {
  cacheElements();
  bindEvents();
  setupAudio();

  const online = await connectToServer();
  if (!online) return;

  await Promise.all([loadSettings(), loadVoices()]);
  await loadLibrary();
  refreshTtsStatus();
  const consumed = await consumePendingDocument();
  if (!consumed) routeFromHash();
}

async function consumePendingDocument() {
  if (!IS_PANEL || !S.serverOnline || !chrome.storage?.session) return false;
  try {
    const stored = await chrome.storage.session.get('listnrPendingDoc');
    const pending = stored.listnrPendingDoc;
    if (!pending?.id) return false;
    await chrome.storage.session.remove('listnrPendingDoc');
    navigateToDocument(pending.id);
    return true;
  } catch {
    return false;
  }
}

function cacheElements() {
  const ids = [
    'rail', 'rail-close', 'rail-open', 'btn-paste', 'btn-upload', 'btn-url', 'file-input',
    'search', 'doc-list', 'doc-count', 'server-pill', 'server-pill-text', 'voice-pill',
    'voice-pill-text', 'offline', 'retry-connection', 'empty', 'empty-upload', 'empty-paste',
    'empty-url', 'dropzone', 'reader', 'doc-source', 'doc-title', 'doc-meta', 'export-link',
    'delete-doc', 'banner', 'voice-select', 'manage-voices', 'rate', 'rate-value', 'volume',
    'volume-value', 'chapter-select', 'sentence-gap', 'sentence-gap-value', 'paragraph-gap',
    'paragraph-gap-value', 'doc-scroll', 'document', 'player-progress-fill', 'playback-state',
    'position-label', 'time-label', 'prev-chapter', 'prev', 'play', 'stop', 'next',
    'next-chapter', 'modal-backdrop', 'modal', 'toast', 'drop-overlay', 'voice-config'
  ];
  els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
}

function setupAudio() {
  S.audio = new Audio();
  S.audio.preload = 'auto';
  try {
    S.audio.preservesPitch = true;
  } catch {
    // Older engines.
  }
  S.audio.addEventListener('ended', handleAudioEnded);
  S.audio.addEventListener('error', () => {
    if (!S.audio.getAttribute('src')) return;
    setPlayback('error');
    showToast('Audio playback failed. Try another voice or sentence.', 5000);
  });
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

async function api(path, { method = 'GET', json, body, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: json !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: json !== undefined ? JSON.stringify(json) : body,
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = new Error(payload?.error?.message || `Request failed (${response.status}).`);
      error.status = response.status;
      error.code = payload?.error?.code;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('The local server did not respond in time.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function connectToServer() {
  setServerPill('checking');
  try {
    await api('/api/health', { timeoutMs: 3000 });
    S.serverOnline = true;
    setServerPill('online');
    if (S.view === 'offline') showView(S.current ? 'reader' : 'empty');
    return true;
  } catch {
    S.serverOnline = false;
    setServerPill('offline');
    showView('offline');
    return false;
  }
}

async function loadSettings() {
  try {
    const settings = await api('/api/settings');
    S.defaultVoice = settings?.defaultVoice || S.defaultVoice;
  } catch {
    // The voice list endpoint also carries a default.
  }
}

async function loadVoices() {
  try {
    const payload = await api('/api/voices', { timeoutMs: 5000 });
    if (Array.isArray(payload?.voices) && payload.voices.length) {
      S.voices = payload.voices;
    }
    if (payload?.defaultVoice) S.defaultVoice = payload.defaultVoice;
  } catch {
    S.voices = FALLBACK_VOICES.slice();
  }
  fillVoiceSelect();
  updateVoicePill();
}

async function loadLibrary() {
  if (!S.serverOnline) return;
  const query = els.search.value.trim();
  try {
    const payload = await api(`/api/documents?q=${encodeURIComponent(query)}`);
    S.documents = payload?.documents || [];
    renderLibrary();
  } catch (error) {
    showToast(error.message);
  }
}

async function refreshTtsStatus() {
  if (!S.serverOnline) return;
  try {
    S.tts = await api('/api/tts/status', { timeoutMs: 5000 });
  } catch {
    S.tts = { reachable: false };
  }
  updateVoicePill();
  if (S.tts.reachable === false && S.current && S.current.status === 'ready') {
    showTtsBanner();
  } else if (S.tts.reachable) {
    hideBanner();
  }
}

/* ------------------------------------------------------------------ */
/* Routing and views                                                   */
/* ------------------------------------------------------------------ */

function routeFromHash() {
  if (!S.serverOnline) return;
  const match = location.hash.match(/^#\/doc\/([a-zA-Z0-9-]{8,})/);
  if (match) {
    if (S.current?.id === match[1] && S.content) return;
    openDocument(match[1]);
  } else {
    showHome();
  }
}

function showHome() {
  if (S.current) saveNow();
  stopPolling();
  clearGap();
  S.settings = { ...DEFAULTS, voice: S.defaultVoice || DEFAULTS.voice };
  S.playToken += 1;
  if (S.audio) {
    S.audio.pause();
    S.audio.removeAttribute('src');
    try {
      S.audio.load();
    } catch {
      // Ignore.
    }
  }
  clearAudioCache();
  S.audioIndex = -1;
  S.current = null;
  S.content = null;
  S.chapters = [];
  S.segmentMeta = [];
  S.spans = [];
  S.cursor = 0;
  S.playback = 'idle';
  setDocumentTitle(null);
  hideBanner();
  closeRail();
  showView('empty');
  updatePlayer();
  updateVoicePill();
  renderLibrary();
}

function showView(view) {
  S.view = view;
  els.offline.hidden = view !== 'offline';
  els.empty.hidden = view !== 'empty';
  els.reader.hidden = view !== 'reader';
}

function setServerPill(state) {
  const dot = els['server-pill']?.querySelector('.dot');
  if (!dot) return;
  dot.classList.toggle('offline', state === 'offline');
  els['server-pill-text'].textContent =
    state === 'online' ? 'Local server' : state === 'checking' ? 'Checking server…' : 'Server offline';
}

function updateVoicePill() {
  if (!els['voice-pill']) return;
  const dot = els['voice-pill'].querySelector('.dot');
  if (S.tts?.reachable === false) {
    dot.classList.add('offline');
    els['voice-pill-text'].textContent = 'Voice server offline';
  } else {
    dot.classList.remove('offline');
    els['voice-pill-text'].textContent = `Voice: ${voiceLabel(S.current?.settings?.voice || S.settings.voice)}`;
  }
}

/* ------------------------------------------------------------------ */
/* Library                                                             */
/* ------------------------------------------------------------------ */

function renderLibrary() {
  const list = els['doc-list'];
  if (!list) return;
  list.textContent = '';
  els['doc-count'].textContent = S.documents.length ? String(S.documents.length) : '';

  if (!S.documents.length) {
    const empty = document.createElement('p');
    empty.className = 'doc-list-empty';
    empty.textContent = els.search.value.trim()
      ? 'No documents match that search.'
      : 'Nothing here yet. Paste text or import a file to start.';
    list.append(empty);
    return;
  }

  for (const doc of S.documents) {
    const item = document.createElement('div');
    item.className = 'doc-item';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    if (S.current?.id === doc.id) item.classList.add('is-active');

    const title = document.createElement('p');
    title.className = 'doc-title';
    title.textContent = doc.title;

    const sub = document.createElement('p');
    sub.className = 'doc-sub';
    const bits = [sourceLabel(doc.sourceType)];
    if (doc.wordCount) bits.push(`${formatNumber(doc.wordCount)} words`);
    if (doc.status === 'extracting') bits.push('extracting…');
    else if (doc.status === 'error') bits.push('needs attention');
    else if (doc.lastOpenedAt) bits.push(relativeTime(doc.lastOpenedAt));
    sub.textContent = bits.join(' · ');

    const progress = document.createElement('div');
    progress.className = 'doc-progress';
    const fill = document.createElement('span');
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, doc.progress || 0)) * 100)}%`;
    progress.append(fill);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'doc-delete';
    remove.title = 'Delete document';
    remove.setAttribute('aria-label', `Delete ${doc.title}`);
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      confirmDelete(doc);
    });

    item.append(title, sub, progress, remove);
    item.addEventListener('click', () => navigateToDocument(doc.id));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigateToDocument(doc.id);
      }
    });
    list.append(item);
  }
}

function sourceLabel(type) {
  return SOURCE_LABELS[type] || (type ? type.toUpperCase() : 'Document');
}

function relativeTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function navigateToDocument(id) {
  closeRail();
  if (location.hash === `#/doc/${id}`) openDocument(id);
  else location.hash = `#/doc/${id}`;
}

/* ------------------------------------------------------------------ */
/* Document loading and rendering                                      */
/* ------------------------------------------------------------------ */

async function openDocument(id) {
  stopPolling();
  clearGap();
  S.playToken += 1;
  if (S.audio) {
    S.audio.pause();
    S.audio.removeAttribute('src');
    try {
      S.audio.load();
    } catch {
      // Ignore.
    }
  }
  clearAudioCache();
  S.audioIndex = -1;
  S.current = null;
  S.content = null;
  S.chapters = [];
  S.segmentMeta = [];
  S.spans = [];
  showView('reader');
  showLoadingDocument();

  try {
    const payload = await api(`/api/documents/${id}`);
    const doc = payload.document;
    if (!doc) throw new Error('Document not found.');
    S.current = doc;
    S.content = doc.content;
    S.chapters = doc.content?.chapters || [];
    S.settings = { ...DEFAULTS, ...(doc.settings || {}) };
    S.cursor = clampNumber(doc.position?.segmentIndex || 0, 0, Math.max(0, doc.segmentCount - 1));
    S.playback = 'idle';
    setDocumentTitle(doc.title);
    renderReaderHeader();
    fillVoiceSelect();
    fillChapterSelect();
    applySettingsToControls();
    updatePlayer();

    if (doc.status === 'extracting') {
      showView('reader');
      renderExtracting();
      pollDocument(id);
      renderLibrary();
      return;
    }

    if (doc.status === 'error') {
      renderReaderError(doc.error || 'Extraction failed.');
      renderLibrary();
      return;
    }

    if (!doc.content) throw new Error('This document has no readable content.');
    renderDocumentContent();
    setCursor(S.cursor, { scroll: true, save: false });
    setPlayback('idle');
    updatePlayer();
    loadLibrary();
    setDocumentTitle(doc.title);
    updateVoicePill();
    if (S.tts?.reachable === false) showTtsBanner();
    if (location.hash !== `#/doc/${id}`) location.hash = `#/doc/${id}`;
  } catch (error) {
    showView('reader');
    renderReaderError(error.message);
  }
}

function setDocumentTitle(title) {
  document.title = title ? `${title} — LISTNR` : 'LISTNR — Listener';
}

function showLoadingDocument() {
  els['doc-title'].textContent = 'Opening document…';
  els['doc-source'].textContent = '';
  els['doc-meta'].textContent = '';
  els.document.textContent = '';
  const box = document.createElement('div');
  box.className = 'loading-doc';
  box.innerHTML =
    '<p class="eyebrow">Extracting</p><h2>Preparing your document…</h2><p>Text is being parsed locally. This can take a moment for PDFs, EPUBs, and OCR.</p><div class="skeleton"><span></span><span></span><span></span><span></span><span></span></div>';
  els.document.append(box);
  setPlayback('loading');
}

function renderExtracting() {
  els.document.textContent = '';
  const box = document.createElement('div');
  box.className = 'loading-doc';
  box.innerHTML =
    '<p class="eyebrow">Extracting</p><h2>Reading the pages…</h2><p>LISTNR is extracting text and finding headings and paragraphs. This stays on this machine.</p><div class="skeleton"><span></span><span></span><span></span><span></span><span></span></div>';
  els.document.append(box);
  setPlayback('extracting');
  updatePlayer();
}

function renderReaderError(message) {
  els.document.textContent = '';
  const card = document.createElement('div');
  card.className = 'error-card';
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Could not read this document';
  const heading = document.createElement('h2');
  heading.textContent = 'Something needs attention.';
  const detail = document.createElement('p');
  detail.className = 'error-message';
  detail.textContent = message || 'Extraction failed.';
  const actions = document.createElement('div');
  actions.className = 'empty-actions';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'cta';
  retry.textContent = 'Retry extraction';
  retry.addEventListener('click', retryExtraction);

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'cta ghost';
  back.textContent = 'Back to library';
  back.addEventListener('click', () => {
    location.hash = '#/';
  });

  actions.append(retry, back);
  card.append(eyebrow, heading, detail, actions);
  els.document.append(card);
  setPlayback('error');
  updatePlayer();
}

function renderReaderHeader() {
  const doc = S.current;
  if (!doc) return;
  const bits = [sourceLabel(doc.sourceType)];
  if (doc.author) bits.push(doc.author);
  els['doc-source'].textContent = bits.join(' · ');
  els['doc-title'].textContent = doc.title;
  const minutes = doc.minutes || Math.max(1, Math.round((doc.wordCount || 0) / 155));
  const chapterCount = doc.content?.chapters?.length || 0;
  els['doc-meta'].textContent = [
    doc.wordCount ? `${formatNumber(doc.wordCount)} words` : null,
    chapterCount ? `${chapterCount} ${chapterCount === 1 ? 'chapter' : 'chapters'}` : null,
    `~${minutes} min`
  ]
    .filter(Boolean)
    .join(' · ');
  els['export-link'].href = `${API_BASE}/api/documents/${doc.id}/export.txt`;
}

function renderDocumentContent() {
  const content = S.content;
  els.document.textContent = '';
  S.spans = [];
  S.segmentMeta = [];

  content.chapters.forEach((chapter, chapterIndex) => {
    const section = document.createElement('section');
    section.className = 'chapter';

    const firstParagraph = chapter.paragraphs[0];
    const firstText = firstParagraph?.sentences?.map((sentence) => sentence.text).join(' ') || '';
    const headingMatchesChapter =
      firstParagraph &&
      /^h[1-2]$/.test(firstParagraph.kind) &&
      normalizeForCompare(firstText) === normalizeForCompare(chapter.title);

    if (!headingMatchesChapter) {
      const kicker = document.createElement('div');
      kicker.className = 'chapter-kicker';
      kicker.append(`Chapter ${chapterIndex + 1}`);
      const showChapterTitle =
        chapter.title &&
        normalizeForCompare(chapter.title) !== normalizeForCompare(S.current?.title || '');
      if (showChapterTitle) {
        kicker.append(' · ');
        const bold = document.createElement('b');
        bold.textContent = chapter.title;
        kicker.append(bold);
      }
      section.append(kicker);
    }

    chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
      const tag = /^h[1-6]$/.test(paragraph.kind)
        ? paragraph.kind
        : paragraph.kind === 'code'
          ? 'pre'
          : paragraph.kind === 'quote'
            ? 'blockquote'
            : 'p';
      const block = document.createElement(tag);
      block.className = 'block';
      block.dataset.kind = paragraph.kind;

      let firstSegment = null;
      paragraph.sentences.forEach((sentence, position) => {
        if (position > 0) block.append(' ');
        const span = document.createElement('span');
        span.className = 'sentence';
        span.dataset.index = String(sentence.i);
        span.textContent = sentence.text;
        span.addEventListener('click', (event) => {
          event.stopPropagation();
          startAt(sentence.i);
        });
        block.append(span);
        S.spans[sentence.i] = span;
        S.segmentMeta[sentence.i] = {
          chapterIndex,
          paragraphIndex,
          kind: paragraph.kind,
          text: sentence.text
        };
        if (firstSegment == null) firstSegment = sentence.i;
      });

      block.addEventListener('click', (event) => {
        if (event.target.closest('.sentence')) return;
        if (firstSegment != null) startAt(firstSegment);
      });
      section.append(block);
    });

    els.document.append(section);
  });
}

function fillChapterSelect() {
  const select = els['chapter-select'];
  if (!select) return;
  select.textContent = '';
  S.chapters.forEach((chapter, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${index + 1}. ${chapter.title}`;
    select.append(option);
  });
  select.disabled = S.chapters.length <= 1;
}

function fillVoiceSelect() {
  const select = els['voice-select'];
  if (!select) return;
  const current = S.settings.voice;
  select.textContent = '';
  const voices = S.voices.length ? S.voices : FALLBACK_VOICES;
  for (const voice of voices) {
    const option = document.createElement('option');
    option.value = voice.id;
    option.textContent = `${voice.name} — ${voice.note || voice.id}`;
    select.append(option);
  }
  if (current && !voices.some((voice) => voice.id === current)) {
    const option = document.createElement('option');
    option.value = current;
    option.textContent = current;
    select.append(option);
  }
  select.value = current || S.defaultVoice || 'af_heart';
}

function applySettingsToControls() {
  els.rate.value = String(S.settings.rate ?? 1);
  els['rate-value'].textContent = formatRate(S.settings.rate ?? 1);
  els.volume.value = String(S.settings.volume ?? 1);
  els['volume-value'].textContent = `${Math.round((S.settings.volume ?? 1) * 100)}%`;
  els['sentence-gap'].value = String(S.settings.sentenceGap ?? 160);
  els['sentence-gap-value'].textContent = `${S.settings.sentenceGap ?? 160} ms`;
  els['paragraph-gap'].value = String(S.settings.paragraphGap ?? 600);
  els['paragraph-gap-value'].textContent = `${S.settings.paragraphGap ?? 600} ms`;
  if (S.audio) {
    S.audio.playbackRate = clampNumber(Number(S.settings.rate) || 1, 0.5, 3);
    S.audio.volume = clampNumber(Number(S.settings.volume) || 0, 0, 1);
  }
  fillVoiceSelect();
  updateVoicePill();
}

/* ------------------------------------------------------------------ */
/* Cursor, progress, player                                            */
/* ------------------------------------------------------------------ */

function setCursor(index, { scroll = true, save = true } = {}) {
  if (!S.content) return;
  const count = S.content.segmentCount || 0;
  if (!count) return;
  const next = clampNumber(index, 0, count - 1);
  const old = S.spans[S.cursor];
  if (old) old.classList.remove('is-active');
  S.cursor = next;
  const span = S.spans[next];
  if (span) {
    span.classList.add('is-active');
    if (scroll) scrollSentenceIntoView(span);
  }

  const meta = S.segmentMeta[next];
  if (meta) {
    els['chapter-select'].value = String(meta.chapterIndex);
    els['position-label'].textContent = `Sentence ${next + 1} of ${count}`;
  }

  updateProgress();
  if (save) saveNowDebounced();
}

function scrollSentenceIntoView(span) {
  const scroller = els['doc-scroll'];
  if (!scroller || !span) return;
  const sentenceRect = span.getBoundingClientRect();
  const viewRect = scroller.getBoundingClientRect();
  if (sentenceRect.top < viewRect.top + 36 || sentenceRect.bottom > viewRect.bottom - 64) {
    span.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function setPlayback(state) {
  S.playback = state;
  document.body.classList.toggle('is-playing', state === 'playing');
  updatePlayer();
}

function updatePlayer() {
  if (!els.play) return;
  const state = S.playback;
  const ready = S.current?.status === 'ready' && Boolean(S.content);
  const chipText =
    state === 'playing'
      ? 'Playing'
      : state === 'loading'
        ? 'Loading'
        : state === 'paused'
          ? 'Paused'
          : state === 'stopped'
            ? 'Stopped'
            : state === 'finished'
              ? 'Finished'
              : state === 'extracting'
                ? 'Extracting'
                : state === 'error'
                  ? 'Error'
                  : 'Ready';

  els['playback-state'].textContent = chipText;
  els['playback-state'].dataset.state = state;
  els.play.innerHTML = state === 'playing' || state === 'loading' ? ICON.pause : ICON.play;
  els.play.setAttribute('aria-label', state === 'playing' || state === 'loading' ? 'Pause' : 'Play');
  els.play.disabled = !ready;

  const controlsDisabled = !ready;
  for (const button of [els.prev, els.next, els.stop, els['prev-chapter'], els['next-chapter']]) {
    if (button) button.disabled = controlsDisabled;
  }
  if (els['chapter-select']) els['chapter-select'].disabled = !ready || S.chapters.length <= 1;
  if (els['voice-select']) els['voice-select'].disabled = !S.current;
  if (els.rate) els.rate.disabled = !S.current;
  if (els.volume) els.volume.disabled = !S.current;

  if (!S.content) {
    els['position-label'].textContent = '—';
    els['time-label'].textContent = '';
    els['player-progress-fill'].style.width = '0%';
    return;
  }

  updateProgress();
}

function updateProgress() {
  if (!S.content) return;
  const count = S.content.segmentCount || 1;
  const fraction =
    S.playback === 'finished' ? 1 : clampNumber(S.cursor / count, 0, 1);
  els['player-progress-fill'].style.width = `${fraction * 100}%`;
  if (S.playback === 'loading') {
    els['time-label'].textContent = 'Preparing audio…';
    return;
  }
  const remainingWords = Math.max(0, (S.current?.wordCount || 0) * (1 - fraction));
  const minutes = Math.max(0, Math.round(remainingWords / 155 / clampNumber(S.settings.rate, 0.5, 3)));
  els['time-label'].textContent =
    S.playback === 'finished' ? 'Finished' : minutes ? `~${minutes} min left` : '';
}

function formatRate(rate) {
  return `${Number(rate).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}×`;
}

/* ------------------------------------------------------------------ */
/* Narration                                                           */
/* ------------------------------------------------------------------ */

function startAt(index) {
  if (!S.current || S.current.status !== 'ready') return;
  playAt(index);
}

async function playAt(index) {
  if (!S.content) return;
  const count = S.content.segmentCount || 0;
  if (!count) return;
  const target = clampNumber(index, 0, count - 1);

  clearGap();
  S.playToken += 1;
  const token = S.playToken;
  S.audio.pause();
  S.audioIndex = -1;
  setCursor(target, { scroll: true });
  hideTtsBannerIfTtsError();
  setPlayback('loading');

  try {
    const url = await getAudioUrl(target);
    if (token !== S.playToken) return;
    S.audio.src = url;
    S.audio.currentTime = 0;
    S.audio.playbackRate = clampNumber(Number(S.settings.rate) || 1, 0.5, 3);
    S.audio.volume = clampNumber(Number(S.settings.volume) ?? 1, 0, 1);
    S.audioIndex = target;
    await S.audio.play();
    if (token !== S.playToken) {
      S.audio.pause();
      return;
    }
    setPlayback('playing');
    saveNowDebounced();
    prefetch(target + 1);
    prefetch(target + 2);
  } catch (error) {
    if (token !== S.playToken) return;
    setPlayback('error');
    if (error.code === 'tts_unavailable' || error.code === 'tts_failed' || error.code === 'tts_empty') {
      showTtsBanner(error.message);
      refreshTtsStatus();
    } else if (error.name === 'NotAllowedError') {
      showToast('The browser blocked audio. Press play once more.', 5000);
    } else {
      showToast(error.message || 'Could not play this sentence.', 5000);
    }
  }
}

function pauseNarration() {
  const wasPlayingAudio = S.playback === 'playing' && S.audio && !S.audio.paused;
  clearGap();
  S.playToken += 1;
  if (S.audio && !S.audio.paused) S.audio.pause();
  if (!wasPlayingAudio) S.audioIndex = -1;
  setPlayback('paused');
  saveNowDebounced();
}

async function resumeNarration() {
  if (!S.content) return;
  if (S.audioIndex === S.cursor && S.audio?.getAttribute('src') && !S.audio.ended) {
    try {
      await S.audio.play();
      setPlayback('playing');
      return;
    } catch {
      // Fall through to a fresh sentence.
    }
  }
  playAt(S.cursor);
}

function togglePlay() {
  if (!S.current || S.current.status !== 'ready') return;
  if (S.playback === 'playing' || S.playback === 'loading') {
    pauseNarration();
  } else if (S.playback === 'paused') {
    resumeNarration();
  } else {
    if (S.playback === 'finished') setCursor(0, { scroll: true, save: false });
    playAt(S.playback === 'finished' ? 0 : S.cursor);
  }
}

function stopNarration({ moveToHome = false } = {}) {
  clearGap();
  S.playToken += 1;
  if (S.audio) {
    S.audio.pause();
    S.audio.removeAttribute('src');
    try {
      S.audio.load();
    } catch {
      // Ignore.
    }
  }
  S.audioIndex = -1;
  if (moveToHome) setPlayback('idle');
  else {
    setPlayback('stopped');
    saveNowDebounced(0);
  }
}

function clearGap() {
  if (S.gapTimer) {
    clearTimeout(S.gapTimer);
    S.gapTimer = null;
  }
}

function handleAudioEnded() {
  if (S.playback !== 'playing') return;
  S.audioIndex = -1;
  const count = S.content?.segmentCount || 0;
  const next = S.cursor + 1;

  if (next >= count) {
    saveNowDebounced(0);
    setPlayback('finished');
    return;
  }

  setCursor(next, { scroll: true });
  const currentMeta = S.segmentMeta[S.cursor - 1];
  const nextMeta = S.segmentMeta[next];
  let gap =
    currentMeta && nextMeta && currentMeta.chapterIndex === nextMeta.chapterIndex &&
    currentMeta.paragraphIndex === nextMeta.paragraphIndex
      ? Number(S.settings.sentenceGap ?? 160)
      : Number(S.settings.paragraphGap ?? 600);

  if (
    (currentMeta && /^h[1-6]$/.test(currentMeta.kind)) ||
    (nextMeta && /^h[1-6]$/.test(nextMeta.kind))
  ) {
    gap = Math.max(gap, Number(S.settings.paragraphGap ?? 600) + 150);
  }
  gap = Math.max(0, Math.round(gap / Math.max(1, Number(S.settings.rate) || 1)));

  if (gap > 0) {
    S.gapTimer = setTimeout(() => {
      S.gapTimer = null;
      if (S.playback === 'playing' || S.playback === 'loading') playAt(next);
    }, gap);
  } else {
    playAt(next);
  }
}

function skipSentence(delta) {
  if (!S.content) return;
  const target = clampNumber(S.cursor + delta, 0, (S.content.segmentCount || 1) - 1);
  if (S.playback === 'playing' || S.playback === 'loading') {
    playAt(target);
  } else {
    setCursor(target, { scroll: true });
    if (S.playback === 'finished') setPlayback('paused');
    saveNowDebounced();
  }
}

function currentChapterIndex() {
  return S.segmentMeta[S.cursor]?.chapterIndex ?? 0;
}

function firstSegmentOfChapter(chapterIndex) {
  return S.segmentMeta.findIndex((meta) => meta?.chapterIndex === chapterIndex);
}

function skipChapter(delta) {
  if (!S.chapters.length) return;
  const targetChapter = clampNumber(currentChapterIndex() + delta, 0, S.chapters.length - 1);
  const target = firstSegmentOfChapter(targetChapter);
  if (target < 0) return;
  if (S.playback === 'playing' || S.playback === 'loading') {
    playAt(target);
  } else {
    setCursor(target, { scroll: true });
    if (S.playback === 'finished') setPlayback('paused');
    saveNowDebounced();
  }
}

async function getAudioUrl(index) {
  const key = `${S.current?.id || 'none'}::${S.settings.voice}::${index}`;
  const cached = S.audioCache.get(key);
  if (cached) {
    S.audioCache.delete(key);
    S.audioCache.set(key, cached);
    if (cached.url) return cached.url;
    if (cached.promise) return cached.promise;
  }

  const entry = { promise: null, url: null };
  entry.promise = (async () => {
    const response = await fetch(
      `${API_BASE}/api/documents/${S.current.id}/audio/${index}?voice=${encodeURIComponent(S.settings.voice)}`
    );
    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      const error = new Error(payload?.error?.message || `Could not load audio (${response.status}).`);
      error.code = payload?.error?.code;
      error.status = response.status;
      throw error;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    if (S.audioCache.get(key) === entry) entry.url = url;
    else URL.revokeObjectURL(url);
    return url;
  })();

  S.audioCache.set(key, entry);
  trimAudioCache();
  try {
    return await entry.promise;
  } catch (error) {
    S.audioCache.delete(key);
    throw error;
  }
}

function prefetch(index) {
  if (!S.content || index < 0 || index >= (S.content.segmentCount || 0)) return;
  getAudioUrl(index).catch(() => {});
}

function trimAudioCache() {
  while (S.audioCache.size > 8) {
    const [key, entry] = S.audioCache.entries().next().value;
    if (entry.url) URL.revokeObjectURL(entry.url);
    S.audioCache.delete(key);
  }
}

function clearAudioCache() {
  for (const entry of S.audioCache.values()) {
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  S.audioCache.clear();
}

/* ------------------------------------------------------------------ */
/* Voice changes and previews                                          */
/* ------------------------------------------------------------------ */

async function changeVoice(voiceId, { restart = true } = {}) {
  if (!voiceId) return;
  const wasPlaying = S.playback === 'playing' || S.playback === 'loading';
  const wasPaused = S.playback === 'paused';
  S.playToken += 1;
  S.settings.voice = voiceId;
  if (S.current?.settings) S.current.settings.voice = voiceId;
  fillVoiceSelect();
  updateVoicePill();
  clearAudioCache();
  S.audio.pause();
  S.audio.removeAttribute('src');
  try {
    S.audio.load();
  } catch {
    // Ignore.
  }
  S.audioIndex = -1;
  updateVoicePill();
  saveNowDebounced(0);

  if (S.current && restart) {
    if (wasPlaying) {
      playAt(S.cursor);
      return;
    }
    if (wasPaused) {
      setPlayback('paused');
      return;
    }
  }
}

async function previewVoice(voiceId) {
  if (S.playback === 'playing' || S.playback === 'loading') {
    pauseNarration();
  }
  if (S.previewAudio) {
    S.previewAudio.pause();
    S.previewAudio = null;
  }
  if (S.previewUrl) {
    URL.revokeObjectURL(S.previewUrl);
    S.previewUrl = null;
  }

  try {
    const response = await fetch(`${API_BASE}/api/voices/${encodeURIComponent(voiceId)}/preview`);
    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (payload?.error?.code?.startsWith('tts_')) {
        showToast('The local voice server is offline. Start Kokoro-FastAPI first.', 5000);
      } else {
        showToast(payload?.error?.message || 'Voice preview failed.', 5000);
      }
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    S.previewUrl = url;
    const audio = new Audio(url);
    S.previewAudio = audio;
    audio.addEventListener('ended', () => {
      if (S.previewAudio === audio) S.previewAudio = null;
      if (S.previewUrl === url) {
        URL.revokeObjectURL(url);
        S.previewUrl = null;
      }
    });
    await audio.play();
  } catch (error) {
    showToast(error.message || 'Voice preview failed.', 5000);
  }
}

async function makeDefaultVoice(voiceId) {
  try {
    await api('/api/settings', { method: 'PATCH', json: { defaultVoice: voiceId } });
    S.defaultVoice = voiceId;
    showToast(`${voiceLabel(voiceId)} is now the default for new documents.`);
    openVoiceModal();
  } catch (error) {
    showToast(error.message, 5000);
  }
}

function voiceLabel(voiceId) {
  return (
    S.voices.find((voice) => voice.id === voiceId)?.name ||
    FALLBACK_VOICES.find((voice) => voice.id === voiceId)?.name ||
    voiceId ||
    'Local voice'
  );
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

function saveNowDebounced(delay = 600) {
  if (!S.current || S.current.status !== 'ready') return;
  if (S.saveTimer) clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(() => {
    S.saveTimer = null;
    saveNow();
  }, delay);
}

function saveNow({ keepalive = false } = {}) {
  if (!S.current || S.current.status !== 'ready') return;
  const meta = S.segmentMeta[S.cursor];
  const payload = {
    position: {
      segmentIndex: S.cursor,
      chapterIndex: meta?.chapterIndex ?? 0,
      paragraphIndex: meta?.paragraphIndex ?? 0
    },
    settings: {
      voice: S.settings.voice,
      rate: clampNumber(Number(S.settings.rate) || 1, 0.5, 3),
      volume: clampNumber(Number(S.settings.volume) ?? 1, 0, 1),
      sentenceGap: Math.round(Number(S.settings.sentenceGap) || 0),
      paragraphGap: Math.round(Number(S.settings.paragraphGap) || 0)
    }
  };

  if (S.current?.settings) Object.assign(S.current.settings, payload.settings);

  const request = fetch(`${API_BASE}/api/documents/${S.current.id}/state`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive
  }).catch(() => {});
  if (!keepalive) request.then(() => loadLibrary()).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* TTS banner                                                          */
/* ------------------------------------------------------------------ */

function showTtsBanner(message) {
  if (!els.banner) return;
  S.bannerKind = 'tts';
  els.banner.hidden = false;
  els.banner.textContent = '';
  const text = document.createElement('span');
  text.textContent =
    message && message.length < 200
      ? `${message} Start the local voice server, then retry.`
      : 'The local voice server is offline. Start Kokoro-FastAPI, then retry.';
  const code = document.createElement('code');
  code.textContent = KOKORO_COMMAND;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry voice';
  retry.addEventListener('click', async () => {
    await refreshTtsStatus();
    if (S.tts?.reachable) {
      hideBanner();
      showToast('Local voice server is back.');
    } else {
      showToast('Still offline. Check that Kokoro is running on 127.0.0.1:8880.', 5000);
    }
  });
  els.banner.append(text, code, retry);
}

function hideTtsBannerIfTtsError() {
  if (S.bannerKind === 'tts') hideBanner();
}

function hideBanner() {
  if (!els.banner) return;
  els.banner.hidden = true;
  els.banner.textContent = '';
  S.bannerKind = null;
}

/* ------------------------------------------------------------------ */
/* Polling                                                             */
/* ------------------------------------------------------------------ */

function pollDocument(id) {
  stopPolling();
  S.pollFailures = 0;
  S.pollTimer = setInterval(async () => {
    try {
      const payload = await api(`/api/documents/${id}`);
      if (S.current?.id !== id) return;
      S.pollFailures = 0;
      const doc = payload.document;
      S.current = doc;
      if (doc.status === 'ready') {
        stopPolling();
        S.content = doc.content;
        S.chapters = doc.content?.chapters || [];
        S.settings = { ...DEFAULTS, ...(doc.settings || {}) };
        S.cursor = clampNumber(doc.position?.segmentIndex || 0, 0, Math.max(0, doc.segmentCount - 1));
        setDocumentTitle(doc.title);
        renderReaderHeader();
        fillVoiceSelect();
        fillChapterSelect();
        applySettingsToControls();
        renderDocumentContent();
        setCursor(S.cursor, { scroll: true, save: false });
        setPlayback('idle');
        updatePlayer();
        renderLibrary();
        loadLibrary();
        showToast('Document ready.');
      } else if (doc.status === 'error') {
        stopPolling();
        renderReaderHeader();
        renderReaderError(doc.error || 'Extraction failed.');
        renderLibrary();
      }
    } catch {
      S.pollFailures += 1;
      if (S.pollFailures >= 6) {
        stopPolling();
        renderReaderError(
          'Lost contact with the local server while extracting. Start the server, then retry.'
        );
      }
    }
  }, 800);
}

function stopPolling() {
  if (S.pollTimer) {
    clearInterval(S.pollTimer);
    S.pollTimer = null;
  }
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

function openPasteModal() {
  openModal((modal) => {
    modal.append(
      modalHeader(
        'Paste text',
        'LISTNR will split it into sentences, keep the paragraph breaks, and read it locally.'
      )
    );
    const form = document.createElement('form');
    form.className = 'form-grid';

    const titleLabel = document.createElement('label');
    titleLabel.textContent = 'Title (optional)';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = 'Untitled text';
    titleLabel.append(titleInput);

    const authorLabel = document.createElement('label');
    authorLabel.textContent = 'Author (optional)';
    const authorInput = document.createElement('input');
    authorInput.type = 'text';
    authorLabel.append(authorInput);

    const textLabel = document.createElement('label');
    textLabel.textContent = 'Text';
    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Paste an article, notes, a chapter…';
    textarea.required = true;
    textLabel.append(textarea);

    const error = document.createElement('p');
    error.className = 'form-error';

    const actions = document.createElement('div');
    actions.className = 'form-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeModal);
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'primary-btn';
    submit.textContent = 'Add to library';
    actions.append(cancel, submit);

    form.append(titleLabel, authorLabel, textLabel, error, actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      const text = textarea.value;
      if (!text.trim()) {
        error.textContent = 'Paste some text first.';
        return;
      }
      submit.disabled = true;
      try {
        const payload = await api('/api/documents', {
          method: 'POST',
          json: {
            title: titleInput.value.trim() || undefined,
            author: authorInput.value.trim() || undefined,
            text
          }
        });
        closeModal();
        await loadLibrary();
        navigateToDocument(payload.document.id);
      } catch (requestError) {
        error.textContent = requestError.message;
        submit.disabled = false;
      }
    });

    modal.append(form);
    setTimeout(() => titleInput.focus(), 30);
  });
}

function openUrlModal() {
  openModal((modal) => {
    modal.append(
      modalHeader(
        'Import a URL',
        'LISTNR fetches only public http(s) pages. Loopback, private, and link-local addresses are blocked, including redirects.'
      )
    );
    const form = document.createElement('form');
    form.className = 'form-grid';
    const label = document.createElement('label');
    label.textContent = 'Public page URL';
    const input = document.createElement('input');
    input.type = 'url';
    input.placeholder = 'https://example.com/article';
    input.required = true;
    label.append(input);

    const error = document.createElement('p');
    error.className = 'form-error';

    const actions = document.createElement('div');
    actions.className = 'form-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeModal);
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'primary-btn';
    submit.textContent = 'Import page';
    actions.append(cancel, submit);

    form.append(label, error, actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.textContent = '';
      submit.disabled = true;
      try {
        const payload = await api('/api/documents/import/url', {
          method: 'POST',
          json: { url: input.value.trim() }
        });
        closeModal();
        await loadLibrary();
        navigateToDocument(payload.document.id);
      } catch (requestError) {
        error.textContent = requestError.message;
        submit.disabled = false;
      }
    });
    modal.append(form);
    setTimeout(() => input.focus(), 30);
  });
}

async function uploadFile(file) {
  if (!file) return;
  const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : '';
  const allowed = ['txt', 'md', 'markdown', 'html', 'htm', 'xhtml', 'pdf', 'epub', 'png', 'jpg', 'jpeg'];
  if (!allowed.includes(extension)) {
    showToast('Unsupported file type. Use TXT, MD, HTML, PDF, EPUB, PNG, JPG, or JPEG.', 5000);
    return;
  }
  if (file.size > 30 * 1024 * 1024) {
    showToast('That file is larger than the 30 MB limit.', 5000);
    return;
  }

  const form = new FormData();
  form.append('file', file);
  showToast(`Importing ${file.name}…`);
  try {
    const response = await fetch(`${API_BASE}/api/documents/import/file`, {
      method: 'POST',
      body: form
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    if (!response.ok) {
      throw new Error(payload?.error?.message || `Upload failed (${response.status}).`);
    }
    await loadLibrary();
    navigateToDocument(payload.document.id);
  } catch (error) {
    showToast(error.message, 5500);
  }
}

/* ------------------------------------------------------------------ */
/* Voice manager                                                       */
/* ------------------------------------------------------------------ */

function openVoiceModal() {
  const voices = S.voices.length ? S.voices : FALLBACK_VOICES;
  const top = TOP_VOICES.map((id) => voices.find((voice) => voice.id === id)).filter(Boolean);
  const topIds = new Set(top.map((voice) => voice.id));
  const rest = voices.filter((voice) => !topIds.has(voice.id));
  const currentVoice = S.settings.voice || S.current?.settings?.voice || S.defaultVoice;

  openModal((modal) => {
    modal.classList.add('wide');
    modal.append(
      modalHeader(
        'Choose a voice',
        'One shared Kokoro model powers every voice. Voice files are tiny, so switching or adding voices costs almost no disk space.'
      )
    );

    const intro = document.createElement('p');
    intro.className = 'voice-intro';
    intro.textContent = `Preview the top voices, then use one for this document or make it your default. ${
      S.tts?.reachable === false ? 'The local voice server is offline, so previews are unavailable.' : ''
    }`.trim();
    modal.append(intro);

    if (top.length) {
      const grid = document.createElement('div');
      grid.className = 'voice-grid';
      for (const voice of top) grid.append(voiceCard(voice, currentVoice));
      modal.append(grid);
    }

    const section = document.createElement('p');
    section.className = 'section-title';
    section.textContent = `All voices${voices.length ? ` · ${voices.length}` : ''}`;
    modal.append(section);

    if (rest.length) {
      const list = document.createElement('div');
      list.className = 'voice-list';
      for (const voice of rest) list.append(voiceRow(voice, currentVoice));
      modal.append(list);
    } else {
      const note = document.createElement('p');
      note.className = 'voice-note';
      note.textContent = 'Start the local voice server to see every Kokoro language and voice.';
      modal.append(note);
    }

    const setup = document.createElement('div');
    setup.className = 'setup-card';
    const setupTitle = document.createElement('h3');
    setupTitle.textContent = S.tts?.reachable === false ? 'Voice server offline' : 'Local Kokoro server';
    const setupText = document.createElement('p');
    setupText.textContent = S.tts?.reachable === false
      ? 'LISTNR uses your own Kokoro-FastAPI server, never a hosted voice API. Start it with:'
      : 'Listening on 127.0.0.1:8880. The model stays on this machine.';
    const command = document.createElement('pre');
    command.textContent = KOKORO_COMMAND;
    setup.append(setupTitle, setupText, command);
    modal.append(setup);

    const note = document.createElement('p');
    note.className = 'voice-note';
    note.textContent =
      'Default voice saves to SQLite and applies to new imports. Per-document voice, speed, volume, and pauses are saved with the document.';
    modal.append(note);
  });
}

function voiceCard(voice, currentVoice) {
  const card = document.createElement('div');
  card.className = 'voice-card';
  if (voice.id === S.defaultVoice) card.classList.add('is-default');
  const title = document.createElement('h3');
  title.textContent = voice.name;
  if (voice.id === S.defaultVoice) {
    const badge = document.createElement('span');
    badge.className = 'state-chip';
    badge.textContent = 'Default';
    badge.style.fontSize = '8px';
    title.append(badge);
  }
  const note = document.createElement('p');
  note.textContent = voice.note || voice.id;
  const actions = document.createElement('div');
  actions.className = 'voice-actions';

  const preview = document.createElement('button');
  preview.type = 'button';
  preview.textContent = 'Preview';
  preview.addEventListener('click', () => previewVoice(voice.id));

  const use = document.createElement('button');
  use.type = 'button';
  use.className = 'use';
  use.textContent = S.current ? 'Use here' : 'Make default';
  use.addEventListener('click', async () => {
    if (S.current) {
      await changeVoice(voice.id);
      closeModal();
      showToast(`${voice.name} is now reading this document.`);
    } else {
      await makeDefaultVoice(voice.id);
    }
  });

  const makeDefault = document.createElement('button');
  makeDefault.type = 'button';
  makeDefault.textContent = 'Default';
  makeDefault.addEventListener('click', () => makeDefaultVoice(voice.id));

  actions.append(preview, use);
  if (S.current) actions.append(makeDefault);
  card.append(title, note, actions);
  return card;
}

function voiceRow(voice, currentVoice) {
  const row = document.createElement('div');
  row.className = 'voice-row';
  if (voice.id === currentVoice) row.classList.add('is-current');
  const name = document.createElement('strong');
  name.textContent = voice.name;
  const note = document.createElement('span');
  note.textContent = `${voice.note || voice.id} · ${voice.id}`;

  const preview = document.createElement('button');
  preview.type = 'button';
  preview.textContent = 'Preview';
  preview.addEventListener('click', () => previewVoice(voice.id));

  const use = document.createElement('button');
  use.type = 'button';
  use.textContent = S.current ? 'Use' : 'Default';
  use.addEventListener('click', async () => {
    if (S.current) {
      await changeVoice(voice.id);
      closeModal();
      showToast(`${voice.name} is now reading this document.`);
    } else {
      await makeDefaultVoice(voice.id);
    }
  });

  row.append(name, note, preview, use);
  return row;
}

/* ------------------------------------------------------------------ */
/* Modals and toasts                                                   */
/* ------------------------------------------------------------------ */

function modalHeader(title, subtitle) {
  const header = document.createElement('div');
  header.className = 'modal-header';
  const copy = document.createElement('div');
  const heading = document.createElement('h2');
  heading.textContent = title;
  copy.append(heading);
  if (subtitle) {
    const sub = document.createElement('p');
    sub.className = 'sub';
    sub.textContent = subtitle;
    copy.append(sub);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'modal-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', closeModal);
  header.append(copy, close);
  return header;
}

function openModal(build) {
  els.modal.textContent = '';
  els.modal.className = 'modal';
  els['modal-backdrop'].hidden = false;
  build(els.modal);
  setTimeout(() => {
    const focusable =
      els.modal.querySelector('input, textarea, select') || els.modal.querySelector('button');
    focusable?.focus();
  }, 30);
}

function closeModal() {
  els['modal-backdrop'].hidden = true;
  els.modal.textContent = '';
  if (S.previewAudio) {
    S.previewAudio.pause();
    S.previewAudio = null;
  }
  if (S.previewUrl) {
    URL.revokeObjectURL(S.previewUrl);
    S.previewUrl = null;
  }
}

function confirmDelete(doc) {
  openModal((modal) => {
    modal.append(
      modalHeader(
        'Delete document?',
        'This removes the extracted text, reading position, uploaded file, and document row. Cached speech files are shared and may remain until pruned.'
      )
    );
    const card = document.createElement('p');
    card.className = 'error-message';
    card.textContent = doc.title;
    const actions = document.createElement('div');
    actions.className = 'form-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', closeModal);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'primary-btn';
    remove.textContent = 'Delete';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await api(`/api/documents/${doc.id}`, { method: 'DELETE' });
        closeModal();
        if (S.current?.id === doc.id) {
          S.current = null;
          location.hash = '#/';
        }
        await loadLibrary();
        showToast('Document deleted.');
      } catch (error) {
        showToast(error.message, 5000);
        remove.disabled = false;
      }
    });
    actions.append(cancel, remove);
    modal.append(card, actions);
  });
}

function showToast(message, duration = 3500) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  if (S.toastTimer) clearTimeout(S.toastTimer);
  S.toastTimer = setTimeout(() => {
    els.toast.hidden = true;
    S.toastTimer = null;
  }, duration);
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function bindEvents() {
  window.addEventListener('hashchange', routeFromHash);
  window.addEventListener('pagehide', () => {
    if (S.current) saveNow({ keepalive: true });
  });

  if (IS_PANEL) {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'session' && changes.listnrPendingDoc?.newValue?.id) {
          consumePendingDocument();
        }
      });
    } catch {
      // Storage is unavailable outside an extension context.
    }
  }

  els['retry-connection'].addEventListener('click', async () => {
    const online = await connectToServer();
    if (!online) return;
    await Promise.all([loadSettings(), loadVoices()]);
    await loadLibrary();
    refreshTtsStatus();
    const consumed = await consumePendingDocument();
    if (!consumed) routeFromHash();
  });

  els['server-pill'].addEventListener('click', async () => {
    const online = await connectToServer();
    if (online) {
      await loadLibrary();
      refreshTtsStatus();
    }
  });

  els['voice-pill'].addEventListener('click', openVoiceModal);
  els['voice-config'].addEventListener('click', openVoiceModal);
  els['manage-voices'].addEventListener('click', openVoiceModal);

  els['btn-paste'].addEventListener('click', openPasteModal);
  els['empty-paste'].addEventListener('click', openPasteModal);
  els['btn-url'].addEventListener('click', openUrlModal);
  els['empty-url'].addEventListener('click', openUrlModal);
  for (const button of [els['btn-upload'], els['empty-upload']]) {
    button.addEventListener('click', () => els['file-input'].click());
  }
  els['file-input'].addEventListener('change', () => {
    const file = els['file-input'].files?.[0];
    els['file-input'].value = '';
    if (file) uploadFile(file);
  });

  els.play.addEventListener('click', togglePlay);
  els.stop.addEventListener('click', () => stopNarration());
  els.prev.addEventListener('click', () => skipSentence(-1));
  els.next.addEventListener('click', () => skipSentence(1));
  els['prev-chapter'].addEventListener('click', () => skipChapter(-1));
  els['next-chapter'].addEventListener('click', () => skipChapter(1));

  els['voice-select'].addEventListener('change', () => changeVoice(els['voice-select'].value));
  els['chapter-select'].addEventListener('change', () => {
    const chapterIndex = Number(els['chapter-select'].value);
    const target = firstSegmentOfChapter(chapterIndex);
    if (target < 0) return;
    if (S.playback === 'playing' || S.playback === 'loading') playAt(target);
    else setCursor(target, { scroll: true });
  });

  els.rate.addEventListener('input', () => {
    const rate = clampNumber(Number(els.rate.value), 0.5, 3);
    S.settings.rate = rate;
    els['rate-value'].textContent = formatRate(rate);
    if (S.audio) S.audio.playbackRate = rate;
    updateProgress();
    saveNowDebounced(400);
  });

  els.volume.addEventListener('input', () => {
    const volume = clampNumber(Number(els.volume.value), 0, 1);
    S.settings.volume = volume;
    els['volume-value'].textContent = `${Math.round(volume * 100)}%`;
    if (S.audio) S.audio.volume = volume;
    saveNowDebounced(400);
  });

  els['sentence-gap'].addEventListener('input', () => {
    S.settings.sentenceGap = Number(els['sentence-gap'].value);
    els['sentence-gap-value'].textContent = `${S.settings.sentenceGap} ms`;
    saveNowDebounced(400);
  });

  els['paragraph-gap'].addEventListener('input', () => {
    S.settings.paragraphGap = Number(els['paragraph-gap'].value);
    els['paragraph-gap-value'].textContent = `${S.settings.paragraphGap} ms`;
    saveNowDebounced(400);
  });

  els.search.addEventListener('input', () => {
    if (S.searchTimer) clearTimeout(S.searchTimer);
    S.searchTimer = setTimeout(() => {
      S.searchTimer = null;
      loadLibrary();
    }, 240);
  });

  els['delete-doc'].addEventListener('click', () => {
    if (S.current) confirmDelete(S.current);
  });

  els['rail-open'].addEventListener('click', () => els.rail.classList.add('is-open'));
  els['rail-close'].addEventListener('click', closeRail);

  els['modal-backdrop'].addEventListener('click', (event) => {
    if (event.target === els['modal-backdrop']) closeModal();
  });

  document.addEventListener('keydown', handleKeydown);

  const dropzone = els.dropzone;
  for (const target of [dropzone, els['doc-scroll'], els['empty']]) {
    if (!target) continue;
    target.addEventListener('dragover', (event) => {
      event.preventDefault();
      els['drop-overlay'].hidden = false;
      dropzone?.classList.add('is-over');
    });
    target.addEventListener('dragleave', () => {
      els['drop-overlay'].hidden = true;
      dropzone?.classList.remove('is-over');
    });
    target.addEventListener('drop', (event) => {
      event.preventDefault();
      els['drop-overlay'].hidden = true;
      dropzone?.classList.remove('is-over');
      const file = event.dataTransfer?.files?.[0];
      if (file) uploadFile(file);
    });
  }
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => event.preventDefault());
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    if (!els['modal-backdrop'].hidden) {
      closeModal();
      return;
    }
    closeRail();
    return;
  }

  const target = event.target;
  if (target?.closest('input, select, textarea')) return;
  if (!els['modal-backdrop'].hidden) return;
  if (S.view !== 'reader') return;

  if (event.key === ' ' || event.code === 'Space') {
    event.preventDefault();
    togglePlay();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    skipSentence(1);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    skipSentence(-1);
  } else if (event.key === 'j' || event.key === 'J') {
    event.preventDefault();
    skipChapter(1);
  } else if (event.key === 'k' || event.key === 'K') {
    event.preventDefault();
    skipChapter(-1);
  }
}

function closeRail() {
  els.rail?.classList.remove('is-open');
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function normalizeForCompare(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

async function retryExtraction() {
  if (!S.current) return;
  try {
    await api(`/api/documents/${S.current.id}/retry`, { method: 'POST' });
    S.current.status = 'extracting';
    S.current.error = null;
    renderExtracting();
    pollDocument(S.current.id);
    showToast('Retrying extraction…');
  } catch (error) {
    showToast(error.message, 5000);
  }
}
