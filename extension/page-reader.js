(() => {
  'use strict';

  if (window.__LISTNR_PAGE_READER__) return;
  window.__LISTNR_PAGE_READER__ = true;

  if (window.top !== window) return;
  if (document.querySelector('meta[name="listnr-app"]')) return;
  if (sessionStorage.getItem('listnr:page-pill-hidden') === '1') return;

  const textLength = (document.body?.innerText || '').trim().length;
  if (textLength < 350) return;

  const DEFAULTS = {
    voice: 'af_heart',
    rate: 1,
    volume: 1,
    sentenceGap: 160,
    paragraphGap: 600
  };

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

  const HIGHLIGHT_NAME = 'listnr-current-sentence';
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME',
    'VIDEO', 'AUDIO', 'OBJECT', 'EMBED', 'FORM', 'BUTTON', 'INPUT',
    'SELECT', 'TEXTAREA', 'LINK', 'META'
  ]);

  const ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.5 5.2c0-.8.9-1.3 1.6-.9l9 6.8c.6.4.6 1.4 0 1.8l-9 6.8c-.7.4-1.6-.1-1.6-.9V5.2Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.3" y="4.4" width="4.2" height="15.2" rx="1.5"/><rect x="13.5" y="4.4" width="4.2" height="15.2" rx="1.5"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7.5h7.5M18.5 7.5H20M4 16.5h2M10.5 16.5H20"/><circle cx="15" cy="7.5" r="2.6"/><circle cx="7.6" cy="16.5" r="2.6"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>'
  };

  const STYLES = String.raw`
:host { all: initial; }
* { box-sizing: border-box; }

.lnr-wrap {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 2147483646;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}

/* Floating pill */
.lnr-pill[hidden] { display: none !important; }
.lnr-pill {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 2px;
  border: 1px solid rgba(255,255,255,.13);
  border-radius: 999px;
  background: #211e19;
  color: #fff8ef;
  box-shadow: 0 8px 28px rgba(0,0,0,.32);
  overflow: hidden;
}
.lnr-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 4px 0 13px;
  border: 0;
  background: transparent;
  color: inherit;
  font: 600 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  letter-spacing: .01em;
  cursor: pointer;
}
.lnr-main:disabled { cursor: wait; opacity: .85; }
.lnr-wave { display: inline-flex; align-items: flex-end; gap: 2px; height: 13px; }
.lnr-wave i {
  display: block; width: 2px; height: 13px;
  border-radius: 1px; background: #dd552f;
  transform: scaleY(.4); transform-origin: bottom center;
}
.lnr-pill:hover .lnr-wave i,
.lnr-pill.is-loading .lnr-wave i,
.lnr-pill.is-playing .lnr-wave i { animation: lnr-eq .9s ease-in-out infinite; }
.lnr-pill .lnr-wave i:nth-child(2) { animation-delay: .12s; }
.lnr-pill .lnr-wave i:nth-child(3) { animation-delay: .25s; }
.lnr-pill .lnr-wave i:nth-child(4) { animation-delay: .38s; }
.lnr-close {
  border: 0; background: transparent;
  color: rgba(255,255,255,.45);
  padding: 0 9px 0 2px;
  font: 400 17px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  cursor: pointer; align-self: stretch;
}
.lnr-close:hover { color: #fff8ef; }
.lnr-pill-toast {
  position: absolute;
  right: 0;
  bottom: calc(100% + 9px);
  width: max-content;
  max-width: min(340px, calc(100vw - 36px));
  padding: 10px 12px;
  border-radius: 9px;
  background: #211e19;
  color: #fff8ef;
  box-shadow: 0 10px 32px rgba(0,0,0,.35);
  font: 500 11.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  white-space: normal;
  pointer-events: none;
}
.lnr-pill-toast[hidden] { display: none; }

/* In-page player */
.lnr-panel {
  pointer-events: auto;
  width: 380px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 36px);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 16px;
  background: #211e19;
  color: #f4eee4;
  box-shadow: 0 18px 60px rgba(0,0,0,.42);
  overflow: hidden;
  animation: lnr-rise .18s ease both;
}
.lnr-panel[hidden] { display: none; }
.lnr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 12px 9px 15px;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.lnr-brand {
  display: flex; align-items: center; gap: 7px;
  font: 750 9.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  letter-spacing: .2em; text-transform: uppercase;
  color: #fff8ef;
}
.lnr-brand .lnr-wave { height: 11px; }
.lnr-brand .lnr-wave i { height: 11px; }
.lnr-head-actions { display: flex; gap: 2px; }
.lnr-icon {
  width: 28px; height: 28px;
  display: grid; place-items: center;
  border: 0; border-radius: 7px;
  background: transparent; color: rgba(255,255,255,.55);
  cursor: pointer; padding: 0;
}
.lnr-icon:hover { background: rgba(255,255,255,.08); color: #fff8ef; }
.lnr-icon svg { width: 15px; height: 15px; }
.lnr-progress { height: 2px; background: rgba(255,255,255,.08); flex: 0 0 auto; }
.lnr-progress span { display: block; height: 100%; width: 0%; background: #dd552f; transition: width .35s ease; }

.lnr-body { padding: 12px 15px 13px; min-height: 0; overflow-y: auto; }
.lnr-title {
  margin: 0 0 9px;
  font-family: "Iowan Old Style", "Palatino Linotype", Charter, Georgia, serif;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -.01em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.lnr-sentence {
  font-family: "Iowan Old Style", "Palatino Linotype", Charter, Georgia, serif;
  font-size: 15px;
  line-height: 1.5;
  color: #f4eee4;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 1.5em;
}
.lnr-meta {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  margin-top: 8px;
  color: #9b9285;
  font: 500 10px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
}
.lnr-controls {
  display: flex; align-items: center; justify-content: center; gap: 4px;
  padding: 10px 12px 12px;
  border-top: 1px solid rgba(255,255,255,.08);
}
.lnr-controls .lnr-icon { width: 32px; height: 32px; }
.lnr-play {
  width: 44px; height: 44px;
  margin: 0 3px;
  display: grid; place-items: center;
  border: 0; border-radius: 50%;
  background: #dd552f;
  color: #fff8ef;
  cursor: pointer;
  box-shadow: 0 5px 18px rgba(200,70,35,.32);
  transition: transform .15s, background .15s;
}
.lnr-play:hover { transform: scale(1.045); background: #bd3f1c; }
.lnr-play svg { width: 19px; height: 19px; }
.lnr-speed {
  height: 30px;
  margin-left: 4px;
  padding: 0 9px;
  border: 1px solid rgba(255,255,255,.13);
  border-radius: 999px;
  background: transparent;
  color: #f4eee4;
  font: 650 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.lnr-speed:hover { background: rgba(255,255,255,.08); }
.lnr-play:disabled, .lnr-icon:disabled { opacity: .4; cursor: default; }

/* Settings popover inside the panel */
.lnr-settings {
  border-top: 1px solid rgba(255,255,255,.08);
  background: #2a2621;
  padding: 12px 15px 14px;
  max-height: 46vh;
  overflow-y: auto;
}
.lnr-settings[hidden] { display: none; }
.lnr-settings label {
  display: block;
  margin: 0 0 9px;
  color: #a69b8c;
  font: 600 9.5px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.lnr-settings label b {
  float: right;
  color: #f4eee4;
  font-weight: 650;
  letter-spacing: 0;
  text-transform: none;
  font-variant-numeric: tabular-nums;
}
.lnr-settings select {
  width: 100%;
  height: 30px;
  margin-top: 5px;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 7px;
  background: #211e19;
  color: #f4eee4;
  font: 500 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  padding: 0 8px;
  outline: none;
}
.lnr-settings input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 20px;
  margin-top: 3px;
  background: transparent;
  cursor: pointer;
}
.lnr-settings input[type="range"]::-webkit-slider-runnable-track {
  height: 3px; border-radius: 2px; background: rgba(255,255,255,.14);
}
.lnr-settings input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 13px; height: 13px;
  margin-top: -5px;
  border-radius: 50%;
  background: #dd552f;
  border: 2px solid #2a2621;
}
.lnr-presets { display: flex; flex-wrap: wrap; gap: 5px; margin: -2px 0 12px; }
.lnr-presets button {
  border: 1px solid rgba(255,255,255,.13);
  border-radius: 999px;
  background: transparent;
  color: #b9afa1;
  padding: 4px 7px;
  font: 600 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  cursor: pointer;
}
.lnr-presets button.is-on { background: #f4eee4; border-color: #f4eee4; color: #211e19; }
.lnr-follow {
  display: flex !important;
  align-items: center;
  gap: 7px;
  margin: 4px 0 0 !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
  font-size: 10.5px !important;
  color: #a69b8c !important;
  cursor: pointer;
}
.lnr-follow input { accent-color: #dd552f; }
.lnr-hint { margin: 9px 0 0; color: #81776a; font: 500 9.5px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }

.lnr-panel-toast {
  margin: 0 15px 12px;
  padding: 8px 10px;
  border-radius: 7px;
  background: rgba(221,85,47,.15);
  color: #ffb59f;
  font: 500 10.5px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
.lnr-panel-toast[hidden] { display: none; }

@keyframes lnr-eq { 0%,100% { transform: scaleY(.35); } 50% { transform: scaleY(1); } }
@keyframes lnr-rise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: translateY(0); } }

@media (max-width: 440px) {
  .lnr-wrap { right: 10px; bottom: 10px; }
  .lnr-panel { width: calc(100vw - 20px); max-height: calc(100vh - 20px); }
}
@media print { .lnr-wrap { display: none !important; } }
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
`;

  const state = {
    doc: null,
    segments: [],
    cursor: 0,
    settings: { ...DEFAULTS },
    voices: FALLBACK_VOICES.slice(),
    playback: 'idle',
    audio: null,
    audioIndex: -1,
    cache: new Map(),
    token: 0,
    gapTimer: null,
    saveTimer: null,
    importing: false,
    panelOpen: false,
    pageIndex: null,
    searchFrom: 0,
    follow: sessionStorage.getItem('listnr:follow') !== '0',
    highlightSheet: null
  };

  let host = null;
  let shadow = null;
  let refs = {};
  let pillToastTimer = null;
  let panelToastTimer = null;

  init();

  function init() {
    ensureUI();
  }

  function ensureUI() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'listnr-page-reader-host';
    host.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
    shadow = host.attachShadow({ mode: 'open' });

    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = STYLES;
      shadow.append(style);
    }

    shadow.innerHTML = `
      <div class="lnr-wrap">
        <div class="lnr-pill" role="group" aria-label="LISTNR">
          <button class="lnr-main" type="button" title="Listen to this page with LISTNR">
            <span class="lnr-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            <span class="lnr-label">Listen</span>
          </button>
          <button class="lnr-close" type="button" aria-label="Hide LISTNR on this page" title="Hide on this page">×</button>
          <div class="lnr-pill-toast" role="status" aria-live="polite" hidden></div>
        </div>

        <section class="lnr-panel" aria-label="LISTNR in-page player" hidden>
          <header class="lnr-head">
            <div class="lnr-brand">
              <span class="lnr-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
              <span>LISTNR</span>
            </div>
            <div class="lnr-head-actions">
              <button class="lnr-icon lnr-full" type="button" title="Open full LISTNR reader" aria-label="Open full LISTNR reader">${ICON.expand}</button>
              <button class="lnr-icon lnr-min" type="button" title="Minimize player" aria-label="Minimize player">${ICON.minus}</button>
            </div>
          </header>
          <div class="lnr-progress"><span></span></div>
          <div class="lnr-body">
            <h2 class="lnr-title"></h2>
            <div class="lnr-sentence"></div>
            <div class="lnr-meta">
              <span class="lnr-position"></span>
              <span class="lnr-time"></span>
            </div>
          </div>
          <div class="lnr-controls">
            <button class="lnr-icon lnr-prev" type="button" title="Previous sentence" aria-label="Previous sentence">${ICON.prev}</button>
            <button class="lnr-play" type="button" title="Play" aria-label="Play">${ICON.play}</button>
            <button class="lnr-icon lnr-next" type="button" title="Next sentence" aria-label="Next sentence">${ICON.next}</button>
            <button class="lnr-icon lnr-stop" type="button" title="Stop" aria-label="Stop">${ICON.stop}</button>
            <button class="lnr-speed" type="button" title="Playback settings">1×</button>
            <button class="lnr-icon lnr-settings-btn" type="button" title="Settings" aria-label="Settings">${ICON.gear}</button>
          </div>
          <div class="lnr-settings" hidden>
            <label>Speed <b class="lnr-speed-value">1×</b><input class="lnr-speed-range" type="range" min="0.5" max="3" step="0.05" value="1"></label>
            <div class="lnr-presets"></div>
            <label>Voice<select class="lnr-voice"></select></label>
            <label>Volume <b class="lnr-volume-value">100%</b><input class="lnr-volume-range" type="range" min="0" max="1" step="0.05" value="1"></label>
            <label>Sentence pause <b class="lnr-sentence-gap-value">160 ms</b><input class="lnr-sentence-gap" type="range" min="0" max="600" step="20" value="160"></label>
            <label>Paragraph pause <b class="lnr-paragraph-gap-value">600 ms</b><input class="lnr-paragraph-gap" type="range" min="0" max="1500" step="50" value="600"></label>
            <label class="lnr-follow"><input class="lnr-follow-input" type="checkbox" ${state.follow ? 'checked' : ''}> Follow highlighted text</label>
            <p class="lnr-hint">The page text is highlighted as it plays. Use the expand icon for the full reader and library.</p>
          </div>
          <div class="lnr-panel-toast" role="status" aria-live="polite" hidden></div>
        </section>
      </div>`;

    refs = {
      pill: shadow.querySelector('.lnr-pill'),
      main: shadow.querySelector('.lnr-main'),
      label: shadow.querySelector('.lnr-label'),
      close: shadow.querySelector('.lnr-close'),
      pillToast: shadow.querySelector('.lnr-pill-toast'),
      panel: shadow.querySelector('.lnr-panel'),
      brandWave: shadow.querySelector('.lnr-brand .lnr-wave'),
      title: shadow.querySelector('.lnr-title'),
      sentence: shadow.querySelector('.lnr-sentence'),
      position: shadow.querySelector('.lnr-position'),
      time: shadow.querySelector('.lnr-time'),
      progress: shadow.querySelector('.lnr-progress span'),
      play: shadow.querySelector('.lnr-play'),
      prev: shadow.querySelector('.lnr-prev'),
      next: shadow.querySelector('.lnr-next'),
      stop: shadow.querySelector('.lnr-stop'),
      speed: shadow.querySelector('.lnr-speed'),
      settingsBtn: shadow.querySelector('.lnr-settings-btn'),
      settings: shadow.querySelector('.lnr-settings'),
      speedRange: shadow.querySelector('.lnr-speed-range'),
      speedValue: shadow.querySelector('.lnr-speed-value'),
      presets: shadow.querySelector('.lnr-presets'),
      voice: shadow.querySelector('.lnr-voice'),
      volumeRange: shadow.querySelector('.lnr-volume-range'),
      volumeValue: shadow.querySelector('.lnr-volume-value'),
      sentenceGap: shadow.querySelector('.lnr-sentence-gap'),
      sentenceGapValue: shadow.querySelector('.lnr-sentence-gap-value'),
      paragraphGap: shadow.querySelector('.lnr-paragraph-gap'),
      paragraphGapValue: shadow.querySelector('.lnr-paragraph-gap-value'),
      follow: shadow.querySelector('.lnr-follow-input'),
      panelToast: shadow.querySelector('.lnr-panel-toast'),
      full: shadow.querySelector('.lnr-full'),
      minimize: shadow.querySelector('.lnr-min')
    };

    bindEvents();
    state.audio = new Audio();
    state.audio.preload = 'auto';
    try {
      state.audio.preservesPitch = true;
    } catch {
      // Older engines.
    }
    state.audio.addEventListener('ended', onAudioEnded);

    document.documentElement.append(host);
  }

  function bindEvents() {
    refs.main.addEventListener('click', () => {
      if (state.doc) showPanel();
      else startImport();
    });
    refs.close.addEventListener('click', closeExtension);
    refs.minimize.addEventListener('click', minimizePanel);
    refs.full.addEventListener('click', openFullReader);
    refs.play.addEventListener('click', togglePlay);
    refs.prev.addEventListener('click', () => skip(-1));
    refs.next.addEventListener('click', () => skip(1));
    refs.stop.addEventListener('click', stopPlayback);
    refs.speed.addEventListener('click', toggleSettings);
    refs.settingsBtn.addEventListener('click', toggleSettings);

    for (const speed of [0.8, 1, 1.25, 1.5, 2, 2.5, 3]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.speed = String(speed);
      button.textContent = formatRate(speed);
      button.addEventListener('click', () => setRate(speed));
      refs.presets.append(button);
    }

    refs.speedRange.addEventListener('input', () => {
      const rate = clamp(Number(refs.speedRange.value), 0.5, 3);
      state.settings.rate = rate;
      if (state.audio) state.audio.playbackRate = rate;
      renderSpeed();
      updateUI();
      saveStateDebounced();
    });

    refs.voice.addEventListener('change', () => changeVoice(refs.voice.value));

    refs.volumeRange.addEventListener('input', () => {
      const volume = clamp(Number(refs.volumeRange.value), 0, 1);
      state.settings.volume = volume;
      refs.volumeValue.textContent = `${Math.round(volume * 100)}%`;
      if (state.audio) state.audio.volume = volume;
      saveStateDebounced();
    });

    refs.sentenceGap.addEventListener('input', () => {
      state.settings.sentenceGap = Number(refs.sentenceGap.value);
      refs.sentenceGapValue.textContent = `${state.settings.sentenceGap} ms`;
      saveStateDebounced();
    });

    refs.paragraphGap.addEventListener('input', () => {
      state.settings.paragraphGap = Number(refs.paragraphGap.value);
      refs.paragraphGapValue.textContent = `${state.settings.paragraphGap} ms`;
      saveStateDebounced();
    });

    refs.follow.addEventListener('change', () => {
      state.follow = refs.follow.checked;
      sessionStorage.setItem('listnr:follow', state.follow ? '1' : '0');
      if (state.follow) safeHighlight(state.cursor);
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'listnr:listen-page') {
        ensureUI();
        if (state.doc) showPanel();
        else startImport();
      }
    });
  }

  async function startImport() {
    if (state.importing) return;
    if (state.doc) {
      showPanel();
      return;
    }

    state.importing = true;
    setPillLoading(true);
    const page = collectPage();
    if (!page.html && !page.text.trim()) {
      state.importing = false;
      setPillLoading(false);
      showPillToast('LISTNR could not find readable text on this page.');
      return;
    }

    try {
      const result = await sendMessage({
        type: 'listnr:import-page',
        inline: true,
        page: {
          title: document.title || 'Web page',
          url: location.href,
          html: page.html,
          text: page.text
        }
      });

      if (!result?.ok) throw new Error(result?.error || 'Could not import this page.');
      if (!result.document?.content) throw new Error('The page was imported but had no content.');

      setupDocument(result.document);
      state.importing = false;
      setPillLoading(false);
      showPanel();
      loadVoices();
    } catch (error) {
      state.importing = false;
      setPillLoading(false);
      showPillToast(String(error?.message || error), 6500);
    } finally {
      state.importing = false;
      if (state.doc) updateUI();
    }
  }

  function setupDocument(doc) {
    state.doc = doc;
    state.segments = [];
    state.cursor = 0;
    state.searchFrom = 0;
    state.pageIndex = null;
    state.playback = 'idle';
    state.settings = { ...DEFAULTS, ...(doc.settings || {}) };
    state.audioIndex = -1;
    state.token += 1;
    clearGap();
    clearHighlight();

    const chapters = doc.content?.chapters || [];
    chapters.forEach((chapter, chapterIndex) => {
      chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
        paragraph.sentences.forEach((sentence) => {
          state.segments[sentence.i] = {
            i: sentence.i,
            text: sentence.text,
            chapterIndex,
            paragraphIndex,
            kind: paragraph.kind
          };
        });
      });
    });

    if (!state.segments.length) {
      throw new Error('The page had no readable sentences.');
    }
    state.segments = state.segments.filter(Boolean);
    state.segments.sort((a, b) => a.i - b.i);

    const position =
      Number.isInteger(doc.position?.segmentIndex) && doc.position.segmentIndex >= 0
        ? doc.position.segmentIndex
        : 0;
    state.cursor = clamp(position, 0, state.segments.length - 1);

    refs.title.textContent = doc.title || 'Web page';
    fillVoiceSelect();
    renderSettings();
    setCursor(state.cursor);
    updateUI();
  }

  function showPanel() {
    if (!state.doc) return;
    ensureUI();
    state.panelOpen = true;
    refs.pill.hidden = true;
    refs.panel.hidden = false;
    updateUI();
    safeHighlight(state.cursor);
  }

  function minimizePanel() {
    if (!state.panelOpen) return;
    state.panelOpen = false;
    refs.panel.hidden = true;
    refs.pill.hidden = false;
    updatePillLabel();
    updateUI();
  }

  function closeExtension() {
    stopPlayback({ save: false });
    clearHighlight();
    sessionStorage.setItem('listnr:page-pill-hidden', '1');
    if (host) host.remove();
    host = null;
    shadow = null;
    refs = {};
  }

  async function openFullReader() {
    if (!state.doc) return;
    saveStateNow();
    stopPlayback({ save: false });
    clearHighlight();
    state.panelOpen = false;
    refs.panel.hidden = true;
    refs.pill.hidden = false;
    updatePillLabel();
    const result = await sendMessage({
      type: 'listnr:open-reader',
      docId: state.doc.id
    });
    if (!result?.ok) showPillToast(result?.error || 'Could not open the full reader.');
  }

  function setPillLoading(loading) {
    if (!refs.main) return;
    refs.main.disabled = loading;
    refs.label.textContent = loading ? 'Preparing…' : state.doc ? 'Open' : 'Listen';
    refs.pill.classList.toggle('is-loading', loading);
    if (!loading) updatePillLabel();
  }

  function updatePillLabel() {
    if (!refs.label || state.panelOpen) return;
    if (!state.doc) {
      refs.label.textContent = state.importing ? 'Preparing…' : 'Listen';
      return;
    }
    refs.label.textContent =
      state.playback === 'playing' || state.playback === 'loading'
        ? state.playback === 'loading'
          ? 'Preparing…'
          : 'Playing'
        : state.playback === 'paused'
          ? 'Paused'
          : 'Open';
    refs.pill.classList.toggle(
      'is-playing',
      state.playback === 'playing' || state.playback === 'loading'
    );
  }

  function toggleSettings() {
    const open = refs.settings.hidden;
    refs.settings.hidden = !open;
    updateUI();
  }

  function loadVoices() {
    sendMessage({ type: 'listnr:get-voices' })
      .then((result) => {
        if (result?.ok && Array.isArray(result.voices) && result.voices.length) {
          state.voices = result.voices;
          fillVoiceSelect();
        }
      })
      .catch(() => {});
  }

  function fillVoiceSelect() {
    if (!refs.voice) return;
    const current = state.settings.voice;
    refs.voice.textContent = '';
    const voices = state.voices.length ? state.voices : FALLBACK_VOICES;
    for (const voice of voices) {
      const option = document.createElement('option');
      option.value = voice.id;
      option.textContent = `${voice.name} — ${voice.note || voice.id}`;
      refs.voice.append(option);
    }
    if (current && !voices.some((voice) => voice.id === current)) {
      const option = document.createElement('option');
      option.value = current;
      option.textContent = current;
      refs.voice.append(option);
    }
    refs.voice.value = current;
  }

  function renderSettings() {
    renderSpeed();
    refs.voice.value = state.settings.voice;
    refs.volumeRange.value = String(state.settings.volume);
    refs.volumeValue.textContent = `${Math.round(state.settings.volume * 100)}%`;
    refs.sentenceGap.value = String(state.settings.sentenceGap);
    refs.sentenceGapValue.textContent = `${state.settings.sentenceGap} ms`;
    refs.paragraphGap.value = String(state.settings.paragraphGap);
    refs.paragraphGapValue.textContent = `${state.settings.paragraphGap} ms`;
  }

  function renderSpeed() {
    const rate = Number(state.settings.rate) || 1;
    refs.speed.textContent = formatRate(rate);
    refs.speedValue.textContent = formatRate(rate);
    refs.speedRange.value = String(rate);
    refs.presets.querySelectorAll('button').forEach((button) => {
      button.classList.toggle('is-on', Math.abs(Number(button.dataset.speed) - rate) < 0.001);
    });
  }

  function setRate(rate) {
    state.settings.rate = clamp(Number(rate) || 1, 0.5, 3);
    if (state.audio) state.audio.playbackRate = state.settings.rate;
    renderSpeed();
    updateUI();
    saveStateDebounced();
  }

  async function changeVoice(voiceId) {
    if (!voiceId || voiceId === state.settings.voice) {
      refs.voice.value = state.settings.voice;
      return;
    }
    const wasPlaying = state.playback === 'playing' || state.playback === 'loading';
    state.token += 1;
    clearGap();
    state.audio.pause();
    state.audio.removeAttribute('src');
    try {
      state.audio.load();
    } catch {
      // Ignore.
    }
    state.audioIndex = -1;
    clearAudioCache();
    state.settings.voice = voiceId;
    refs.voice.value = voiceId;
    saveStateDebounced(0);
    if (wasPlaying) {
      playAt(state.cursor);
    } else {
      updatePillLabel();
      updateUI();
    }
  }

  function togglePlay() {
    if (!state.doc) {
      startImport();
      return;
    }
    if (state.playback === 'playing' || state.playback === 'loading') {
      pausePlayback();
    } else if (state.playback === 'paused') {
      resumePlayback();
    } else {
      if (state.playback === 'finished') setCursor(0);
      playAt(state.cursor);
    }
  }

  async function playAt(index) {
    if (!state.doc || !state.segments.length) return;
    const target = clamp(index, 0, state.segments.length - 1);

    clearGap();
    state.token += 1;
    const token = state.token;
    state.audio.pause();
    state.audioIndex = -1;
    setCursor(target);
    state.playback = 'loading';
    updateUI();

    try {
      const url = await getAudioUrl(target);
      if (token !== state.token) return;
      state.audio.src = url;
      state.audio.currentTime = 0;
      state.audio.playbackRate = clamp(Number(state.settings.rate) || 1, 0.5, 3);
      state.audio.volume = clamp(Number(state.settings.volume) ?? 1, 0, 1);
      state.audioIndex = target;
      await state.audio.play();
      if (token !== state.token) {
        state.audio.pause();
        return;
      }
      state.playback = 'playing';
      updateUI();
      saveStateDebounced(0);
      prefetch(target + 1);
      prefetch(target + 2);
    } catch (error) {
      if (token !== state.token) return;
      state.playback = 'error';
      updateUI();
      showPanelToast(
        error.code === 'tts_unavailable'
          ? 'Local voice server offline. Start Kokoro-FastAPI, then press play again.'
          : error.message || 'Could not load this sentence.',
        8000
      );
    }
  }

  function pausePlayback() {
    const wasPlayingAudio = state.playback === 'playing' && !state.audio.paused;
    clearGap();
    state.token += 1;
    if (!state.audio.paused) state.audio.pause();
    if (!wasPlayingAudio) state.audioIndex = -1;
    state.playback = 'paused';
    updateUI();
    updatePillLabel();
    saveStateDebounced(0);
  }

  async function resumePlayback() {
    if (state.audioIndex === state.cursor && state.audio.getAttribute('src') && !state.audio.ended) {
      try {
        await state.audio.play();
        state.playback = 'playing';
        updateUI();
        return;
      } catch {
        // Fall through to a fresh sentence.
      }
    }
    playAt(state.cursor);
  }

  function stopPlayback({ save = true } = {}) {
    clearGap();
    state.token += 1;
    state.audio.pause();
    state.audio.removeAttribute('src');
    try {
      state.audio.load();
    } catch {
      // Ignore.
    }
    state.audioIndex = -1;
    state.playback = 'stopped';
    clearHighlight();
    updateUI();
    updatePillLabel();
    if (save) saveStateDebounced(0);
  }

  function onAudioEnded() {
    if (state.playback !== 'playing') return;
    state.audioIndex = -1;
    const next = state.cursor + 1;
    if (next >= state.segments.length) {
      state.playback = 'finished';
      updateUI();
      updatePillLabel();
      saveStateDebounced(0);
      return;
    }

    const previous = state.segments[state.cursor];
    const upcoming = state.segments[next];
    let gap =
      previous && upcoming && previous.chapterIndex === upcoming.chapterIndex &&
      previous.paragraphIndex === upcoming.paragraphIndex
        ? Number(state.settings.sentenceGap)
        : Number(state.settings.paragraphGap);

    if (
      (previous && /^h[1-6]$/.test(previous.kind)) ||
      (upcoming && /^h[1-6]$/.test(upcoming.kind))
    ) {
      gap = Math.max(gap, Number(state.settings.paragraphGap) + 150);
    }
    gap = Math.max(0, Math.round(gap / Math.max(1, Number(state.settings.rate) || 1)));

    setCursor(next);
    state.playback = 'playing';
    updateUI();
    updatePillLabel();

    if (gap > 0) {
      state.gapTimer = setTimeout(() => {
        state.gapTimer = null;
        if (state.playback === 'playing') playAt(next);
      }, gap);
    } else {
      playAt(next);
    }
  }

  function skip(delta) {
    if (!state.doc) return;
    const target = clamp(state.cursor + delta, 0, state.segments.length - 1);
    if (state.playback === 'playing' || state.playback === 'loading') {
      playAt(target);
    } else {
      setCursor(target);
      if (state.playback === 'finished') state.playback = 'paused';
      updateUI();
      updatePillLabel();
      saveStateDebounced();
    }
  }

  function setCursor(index) {
    if (!state.segments.length) return;
    state.cursor = clamp(index, 0, state.segments.length - 1);
    const segment = state.segments[state.cursor];
    refs.sentence.textContent = segment?.text || '';
    refs.position.textContent = `Sentence ${state.cursor + 1} of ${state.segments.length}`;
    safeHighlight(state.cursor);
  }

  function updateUI() {
    if (!refs.play || !state.doc) return;

    const rate = Number(state.settings.rate) || 1;
    refs.title.textContent = state.doc.title || 'Web page';
    refs.sentence.textContent =
      state.playback === 'loading' && !state.segments[state.cursor]?.text
        ? 'Preparing audio…'
        : state.segments[state.cursor]?.text || '';
    refs.position.textContent = `Sentence ${state.cursor + 1} of ${state.segments.length}`;

    const count = state.segments.length || 1;
    const fraction =
      state.playback === 'finished' ? 1 : clamp(state.cursor / count, 0, 1);
    refs.progress.style.width = `${fraction * 100}%`;

    const remainingWords = Math.max(0, (state.doc.wordCount || 0) * (1 - fraction));
    const minutes = Math.max(0, Math.round(remainingWords / 155 / rate));
    refs.time.textContent =
      state.playback === 'loading'
        ? 'Preparing audio…'
        : state.playback === 'finished'
          ? 'Finished'
          : minutes
            ? `~${minutes} min left`
            : '';

    refs.play.innerHTML =
      state.playback === 'playing' || state.playback === 'loading'
        ? ICON.pause
        : ICON.play;
    refs.play.setAttribute(
      'aria-label',
      state.playback === 'playing' || state.playback === 'loading' ? 'Pause' : 'Play'
    );
    refs.play.disabled = state.importing;
    refs.pill.classList.toggle(
      'is-playing',
      state.playback === 'playing' || state.playback === 'loading'
    );
    refs.panel.classList.toggle('is-playing', state.playback === 'playing');
    updatePillLabel();
  }

  async function getAudioUrl(index) {
    const key = `${state.doc.id}::${state.settings.voice}::${index}`;
    const cached = state.cache.get(key);
    if (cached) {
      state.cache.delete(key);
      state.cache.set(key, cached);
      if (cached.url) return cached.url;
      return cached.promise;
    }

    const entry = { promise: null, url: null };
    entry.promise = (async () => {
      const response = await sendMessage({
        type: 'listnr:get-audio',
        docId: state.doc.id,
        index,
        voice: state.settings.voice
      });
      if (!response?.ok) {
        const error = new Error(response?.error || 'Could not load audio.');
        error.code = response?.code;
        throw error;
      }
      const binary = atob(response.data || '');
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: response.contentType || 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      if (state.cache.get(key) === entry) entry.url = url;
      else URL.revokeObjectURL(url);
      return url;
    })();

    state.cache.set(key, entry);
    trimCache();
    try {
      return await entry.promise;
    } catch (error) {
      state.cache.delete(key);
      throw error;
    }
  }

  function prefetch(index) {
    if (!state.doc || index < 0 || index >= state.segments.length) return;
    getAudioUrl(index).catch(() => {});
  }

  function trimCache() {
    while (state.cache.size > 6) {
      const [key, entry] = state.cache.entries().next().value;
      if (entry.url) URL.revokeObjectURL(entry.url);
      state.cache.delete(key);
    }
  }

  function clearAudioCache() {
    for (const entry of state.cache.values()) {
      if (entry.url) URL.revokeObjectURL(entry.url);
    }
    state.cache.clear();
  }

  function clearGap() {
    if (state.gapTimer) {
      clearTimeout(state.gapTimer);
      state.gapTimer = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Page highlight                                                     */
  /* ------------------------------------------------------------------ */

  function ensureHighlightStyle() {
    if (state.highlightSheet) return;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(
        '::highlight(' +
          HIGHLIGHT_NAME +
          '){background-color:#f4d3c2;color:#241f19;border-radius:2px;}'
      );
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      state.highlightSheet = sheet;
    } catch {
      state.highlightSheet = null;
    }
  }

  function clearHighlight() {
    try {
      window.CSS?.highlights?.delete(HIGHLIGHT_NAME);
    } catch {
      // Ignore.
    }
  }

  function buildPageIndex() {
    if (state.pageIndex) return state.pageIndex;

    const nodes = [];
    const offsets = [];
    let text = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('#listnr-page-reader-host')) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[hidden], [aria-hidden="true"]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    let lastWasSpace = true;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue;
      for (let i = 0; i < value.length; i += 1) {
        const char = value[i];
        if (/[​-‍﻿­]/.test(char)) continue;
        if (/\s/.test(char) || char === ' ') {
          if (lastWasSpace) continue;
          text += ' ';
          nodes.push(node);
          offsets.push(i);
          lastWasSpace = true;
        } else {
          text += char;
          nodes.push(node);
          offsets.push(i);
          lastWasSpace = false;
        }
        if (text.length >= 400000) break;
      }
      if (text.length >= 400000) break;
    }

    state.pageIndex = { text, nodes, offsets };
    return state.pageIndex;
  }

  function normalizeForSearch(value) {
    return String(value || '')
      .replace(/[​-‍﻿­]/g, '')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function safeHighlight(index) {
    try {
      highlightSentence(index);
    } catch {
      // Highlighting must never block playback or the panel.
    }
  }

  function highlightSentence(index) {
    if (!state.doc) return;
    const segment = state.segments[index];
    if (!segment) return;
    if (!window.CSS?.highlights || typeof window.Highlight !== 'function') return;

    const needle = normalizeForSearch(segment.text);
    if (!needle) return;

    const page = buildPageIndex();
    let position = page.text.indexOf(needle, state.searchFrom);
    if (position < 0) position = page.text.indexOf(needle);
    if (position < 0) return;

    const end = position + needle.length;
    if (end <= position) return;
    const startNode = page.nodes[position];
    const endNode = page.nodes[end - 1];
    if (!startNode || !endNode) return;

    const startOffset = page.offsets[position];
    const endOffset = Math.min(endNode.nodeValue.length, page.offsets[end - 1] + 1);
    const range = document.createRange();
    try {
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
    } catch {
      return;
    }

    ensureHighlightStyle();
    try {
      const highlight = new window.Highlight(range);
      window.CSS.highlights.set(HIGHLIGHT_NAME, highlight);
    } catch {
      return;
    }

    state.searchFrom = end;

    if (state.follow) {
      try {
        const rect = range.getBoundingClientRect();
        const panelRect = state.panelOpen ? refs.panel.getBoundingClientRect() : null;
        const offscreen = rect.top < 8 || rect.bottom > window.innerHeight - 8;
        const behindPanel =
          panelRect &&
          !(
            rect.right < panelRect.left - 8 ||
            rect.left > panelRect.right + 8 ||
            rect.bottom < panelRect.top - 8 ||
            rect.top > panelRect.bottom + 8
          );

        if (offscreen || behindPanel) {
          range.startContainer.parentElement?.scrollIntoView({
            block: 'center',
            behavior: 'smooth'
          });
        }
      } catch {
        // Ignore geometry errors.
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Capture and state saving                                           */
  /* ------------------------------------------------------------------ */

  function collectPage() {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('#listnr-page-reader-host').forEach((node) => node.remove());
    clone
      .querySelectorAll(
        'script,style,noscript,template,svg,canvas,iframe,video,audio,object,embed,form,button,input,select,textarea,link'
      )
      .forEach((node) => node.remove());

    const html = `<!doctype html>${clone.outerHTML}`;
    if (html.length > 5_000_000) {
      return {
        html: '',
        text: String(document.body?.innerText || '').slice(0, 1_500_000)
      };
    }
    return { html, text: '' };
  }

  function saveStateDebounced(delay = 500) {
    if (!state.doc) return;
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      state.saveTimer = null;
      saveStateNow();
    }, delay);
  }

  function saveStateNow() {
    if (!state.doc) return;
    const segment = state.segments[state.cursor];
    const payload = {
      type: 'listnr:save-page-state',
      docId: state.doc.id,
      position: {
        segmentIndex: state.cursor,
        chapterIndex: segment?.chapterIndex || 0,
        paragraphIndex: segment?.paragraphIndex || 0
      },
      settings: {
        voice: state.settings.voice,
        rate: clamp(Number(state.settings.rate) || 1, 0.5, 3),
        volume: clamp(Number(state.settings.volume) ?? 1, 0, 1),
        sentenceGap: Math.round(Number(state.settings.sentenceGap) || 0),
        paragraphGap: Math.round(Number(state.settings.paragraphGap) || 0)
      }
    };

    try {
      chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
    } catch {
      // The extension context may be gone.
    }
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response);
          }
        });
      } catch (error) {
        resolve({ ok: false, error: String(error?.message || error) });
      }
    });
  }

  function showPillToast(message, duration = 5000) {
    if (!refs.pillToast) return;
    refs.pillToast.textContent = message;
    refs.pillToast.hidden = false;
    if (pillToastTimer) clearTimeout(pillToastTimer);
    pillToastTimer = setTimeout(() => {
      if (refs.pillToast) refs.pillToast.hidden = true;
      pillToastTimer = null;
    }, duration);
  }

  function showPanelToast(message, duration = 5000) {
    if (!refs.panelToast) return;
    refs.panelToast.textContent = message;
    refs.panelToast.hidden = false;
    if (panelToastTimer) clearTimeout(panelToastTimer);
    panelToastTimer = setTimeout(() => {
      if (refs.panelToast) refs.panelToast.hidden = true;
      panelToastTimer = null;
    }, duration);
  }

  function formatRate(rate) {
    return `${Number(rate).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}×`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value) || 0));
  }

  window.addEventListener('pagehide', () => {
    if (state.doc) saveStateNow();
  });

  ensureUI();
})();
