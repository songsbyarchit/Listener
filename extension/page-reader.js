(() => {
  'use strict';

  if (window.__LISTNR_PAGE_READER__) return;
  window.__LISTNR_PAGE_READER__ = true;

  if (window.top !== window) return;
  if (document.querySelector('meta[name="listnr-app"]')) return;
  if (sessionStorage.getItem('listnr:page-pill-hidden') === '1') return;

  const textLength = (document.body?.innerText || '').trim().length;
  if (textLength < 200) return;

  const DEFAULTS = {
    voice: 'af_heart',
    rate: 1,
    volume: 1,
    sentenceGap: 160,
    paragraphGap: 600,
    showPill: true
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
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>'
  };

  const STYLES = String.raw`
@font-face {
  font-family: "Instrument Sans";
  src: url("${chrome.runtime.getURL('fonts/InstrumentSans-Variable.ttf')}") format("truetype-variations");
  font-weight: 400 700;
  font-display: swap;
}
@font-face {
  font-family: "Instrument Serif";
  src: url("${chrome.runtime.getURL('fonts/InstrumentSerif-Regular.ttf')}") format("truetype");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "Instrument Serif";
  src: url("${chrome.runtime.getURL('fonts/InstrumentSerif-Italic.ttf')}") format("truetype");
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}

:host {
  all: initial;
  --lnr-bg: #0B0B0C;
  --lnr-tile: #1D1D1F;
  --lnr-raised: #141415;
  --lnr-ink: #F7F5F0;
  --lnr-muted: #A8A39A;
  --lnr-faint: #8A857C;
  --lnr-line: rgba(247, 245, 240, .13);
  --lnr-line-soft: rgba(247, 245, 240, .08);
  --lnr-hover: rgba(255, 255, 255, .08);
  --lnr-accent: #8BC34A;
  --lnr-accent-bright: #8BC34A;
  --lnr-on-accent: #141415;
  --lnr-accent-soft: rgba(139, 195, 74, .30);
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :host {
    --lnr-bg: #F2E8D7;
    --lnr-tile: #FFFDF8;
    --lnr-raised: #E8DCC9;
    --lnr-ink: #141415;
    --lnr-muted: #6E6A64;
    --lnr-faint: #6E6A64;
    --lnr-line: rgba(20, 20, 21, .14);
    --lnr-line-soft: rgba(20, 20, 21, .08);
    --lnr-hover: rgba(20, 20, 21, .06);
    --lnr-accent: #11574C;
    --lnr-accent-bright: #11574C;
    --lnr-on-accent: #FBE9CE;
    --lnr-accent-soft: rgba(17, 87, 76, .22);
    color-scheme: light;
  }
}

:host([data-theme="light"]) {
  --lnr-bg: #F2E8D7;
  --lnr-tile: #FFFDF8;
  --lnr-raised: #E8DCC9;
  --lnr-ink: #141415;
  --lnr-muted: #6E6A64;
  --lnr-faint: #6E6A64;
  --lnr-line: rgba(20, 20, 21, .14);
  --lnr-line-soft: rgba(20, 20, 21, .08);
  --lnr-hover: rgba(20, 20, 21, .06);
  --lnr-accent: #11574C;
  --lnr-accent-bright: #11574C;
  --lnr-on-accent: #FBE9CE;
  --lnr-accent-soft: rgba(17, 87, 76, .22);
  color-scheme: light;
}
:host([data-theme="dark"]) {
  --lnr-bg: #0B0B0C;
  --lnr-tile: #1D1D1F;
  --lnr-raised: #141415;
  --lnr-ink: #F7F5F0;
  --lnr-muted: #A8A39A;
  --lnr-faint: #8A857C;
  --lnr-line: rgba(247, 245, 240, .13);
  --lnr-line-soft: rgba(247, 245, 240, .08);
  --lnr-hover: rgba(255, 255, 255, .08);
  --lnr-accent: #8BC34A;
  --lnr-accent-bright: #8BC34A;
  --lnr-on-accent: #141415;
  --lnr-accent-soft: rgba(139, 195, 74, .28);
  color-scheme: dark;
}
* { box-sizing: border-box; }

.lnr-wrap {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 2147483646;
  pointer-events: none;
  font-family: "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  transition: padding .18s ease, left .18s ease, top .18s ease;
}
.lnr-wrap.is-dragging { transition: none; }
.lnr-wrap[data-dock="free"] { right: auto; bottom: auto; }

/* Positioning: the open player is placed freely in JS, the pill snaps to an edge */

/* Floating pill */
.lnr-pill[hidden] { display: none !important; }
.lnr-pill {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--lnr-line);
  border-radius: 999px;
  background: var(--lnr-bg);
  color: var(--lnr-ink);
  box-shadow: 0 8px 28px rgba(0,0,0,.32);
  overflow: hidden;
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.lnr-pill.is-dragging {
  cursor: grabbing;
  box-shadow: 0 12px 34px rgba(0,0,0,.42);
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
  font: 600 14px/1 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  letter-spacing: .01em;
  cursor: inherit;
}
.lnr-main:disabled { cursor: wait; opacity: .85; }
.lnr-wave { display: inline-flex; align-items: flex-end; gap: 2px; height: 13px; }
.lnr-wave i {
  display: block; width: 2px; height: 13px;
  border-radius: 1px; background: var(--lnr-accent);
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
  color: var(--lnr-faint);
  padding: 0 9px 0 2px;
  font: 400 17px/1 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  cursor: pointer; align-self: stretch;
}
.lnr-close:hover { color: var(--lnr-ink); }
.lnr-pill-toast {
  position: absolute;
  right: 0;
  bottom: calc(100% + 9px);
  width: max-content;
  max-width: min(340px, calc(100vw - 36px));
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--lnr-bg);
  color: var(--lnr-ink);
  box-shadow: 0 10px 32px rgba(0,0,0,.35);
  font: 500 13px/1.45 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  white-space: normal;
  pointer-events: none;
}
.lnr-pill-toast[hidden] { display: none; }

/* In-page player */
.lnr-panel {
  pointer-events: auto;
  position: relative;
  width: 440px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 24px);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--lnr-line);
  border-radius: 18px;
  background: var(--lnr-bg);
  color: var(--lnr-ink);
  box-shadow: 0 18px 60px rgba(0,0,0,.42);
  overflow: hidden;
  animation: lnr-rise .18s ease both;
}
.lnr-panel[hidden] { display: none; }
.lnr-panel.is-panel-dragging .lnr-head { cursor: grabbing; }
.lnr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 12px 9px 15px;
  border-bottom: 1px solid var(--lnr-line-soft);
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.lnr-brand {
  display: flex; align-items: center; gap: 8px;
  font: 700 14px/1 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  letter-spacing: -.01em;
  color: var(--lnr-ink);
}
.lnr-mark { width: 27px; height: 27px; display: block; flex: 0 0 27px; }
.lnr-head-actions { display: flex; gap: 2px; }
.lnr-icon {
  width: 28px; height: 28px;
  display: grid; place-items: center;
  border: 0; border-radius: 7px;
  background: transparent; color: var(--lnr-muted);
  cursor: pointer; padding: 0;
}
.lnr-icon:hover { background: var(--lnr-hover); color: var(--lnr-ink); }
.lnr-icon svg { width: 15px; height: 15px; }
.lnr-progress { height: 2px; background: var(--lnr-hover); flex: 0 0 auto; }
.lnr-progress span { display: block; height: 100%; width: 0%; background: var(--lnr-accent); transition: width .35s ease; }

.lnr-body {
  margin: 10px 10px 0;
  padding: 16px;
  border: 1px solid var(--lnr-line);
  border-radius: 16px;
  background: var(--lnr-tile);
  min-height: 0;
  overflow-y: auto;
  flex: 1 1 auto;
}
.lnr-title {
  margin: 0 0 10px;
  font-family: "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 18px;
  font-weight: 650;
  line-height: 1.25;
  letter-spacing: -.015em;
}
.lnr-sentence {
  font-family: "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 17px;
  line-height: 1.55;
  color: var(--lnr-ink);
  min-height: 1.55em;
}
/* Read-along: the sentence being read in ink with its current word lit,
   then the sentences after it in muted text, filling the box. */
.lnr-sentence .lnr-next { color: var(--lnr-muted); }
.lnr-sentence .is-word { color: var(--lnr-accent); font-weight: 650; }
.lnr-meta {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  margin-top: 8px;
  color: var(--lnr-muted);
  font: 500 11px/1.35 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  font-variant-numeric: tabular-nums;
}
.lnr-controls {
  display: flex; align-items: center; justify-content: center; gap: 4px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--lnr-line-soft);
}
.lnr-controls .lnr-icon { width: 32px; height: 32px; }
.lnr-play {
  width: 44px; height: 44px;
  margin: 0 3px;
  display: grid; place-items: center;
  border: 0; border-radius: 50%;
  background: var(--lnr-accent);
  color: var(--lnr-on-accent);
  cursor: pointer;
  box-shadow: 0 5px 18px rgba(200,70,35,.32);
  transition: transform .15s, background .15s;
}
.lnr-play:hover { transform: scale(1.045); background: #0B3F38; }
.lnr-play svg { width: 19px; height: 19px; }
.lnr-speed {
  height: 30px;
  margin-left: 4px;
  padding: 0 9px;
  border: 1px solid var(--lnr-line);
  border-radius: 999px;
  background: transparent;
  color: var(--lnr-ink);
  font: 650 13px/1 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.lnr-speed:hover { background: var(--lnr-hover); }
.lnr-play:disabled, .lnr-icon:disabled { opacity: .4; cursor: default; }

/* Settings popover inside the panel */
.lnr-settings {
  border-top: 1px solid var(--lnr-line-soft);
  background: var(--lnr-raised);
  padding: 12px 15px 14px;
  max-height: 46vh;
  overflow-y: auto;
  flex: 0 1 auto;
  min-height: 0;
}
.lnr-settings[hidden] { display: none; }
.lnr-settings label {
  display: block;
  margin: 0 0 9px;
  color: var(--lnr-muted);
  font: 600 11px/1.2 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  letter-spacing: .01em;
  text-transform: none;
}
.lnr-settings label b {
  float: right;
  color: var(--lnr-ink);
  font-weight: 650;
  letter-spacing: 0;
  text-transform: none;
  font-variant-numeric: tabular-nums;
}
.lnr-settings select {
  width: 100%;
  height: 30px;
  margin-top: 5px;
  border: 1px solid var(--lnr-line);
  border-radius: 7px;
  background: var(--lnr-bg);
  color: var(--lnr-ink);
  font: 500 13px/1 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
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
  height: 3px; border-radius: 2px; background: var(--lnr-line);
}
.lnr-settings input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 13px; height: 13px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--lnr-accent);
  border: 2px solid var(--lnr-raised);
}
.lnr-presets { display: flex; flex-wrap: wrap; gap: 5px; margin: -2px 0 12px; }
.lnr-presets button {
  border: 1px solid var(--lnr-line);
  border-radius: 999px;
  background: transparent;
  color: var(--lnr-muted);
  padding: 4px 7px;
  font: 600 11px/1 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  cursor: pointer;
}
.lnr-presets button.is-on { background: var(--lnr-ink); border-color: var(--lnr-ink); color: var(--lnr-bg); }
.lnr-follow {
  display: flex !important;
  align-items: center;
  gap: 7px;
  margin: 4px 0 0 !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
  font-size: 12px !important;
  color: var(--lnr-muted) !important;
  cursor: pointer;
}
.lnr-follow input { accent-color: var(--lnr-accent); }
.lnr-reset {
  margin: 12px 0 0;
  border: 1px solid var(--lnr-line);
  border-radius: 999px;
  background: transparent;
  color: var(--lnr-muted);
  padding: 6px 12px;
  font: 600 12px/1 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  cursor: pointer;
}
.lnr-reset:hover { background: var(--lnr-hover); color: var(--lnr-ink); }
.lnr-hint { margin: 9px 0 0; color: var(--lnr-faint); font: 500 12px/1.4 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif; }

/* Pin-position picker */
.lnr-dock {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin: 0 0 12px;
}
.lnr-dock button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: 6px 3px;
  border: 1px solid var(--lnr-line);
  border-radius: 8px;
  background: transparent;
  color: var(--lnr-muted);
  font: 600 11px/1 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
  letter-spacing: 0;
  text-transform: none;
  cursor: pointer;
}
.lnr-dock button:hover { background: var(--lnr-hover); color: var(--lnr-ink); }
.lnr-dock button.is-on {
  border-color: var(--lnr-ink);
  background: var(--lnr-hover);
  color: var(--lnr-ink);
}
.lnr-dock button i {
  position: relative;
  display: block;
  width: 28px;
  height: 18px;
  border: 1px solid var(--lnr-line);
  border-radius: 3px;
}
.lnr-dock button i::after {
  content: "";
  position: absolute;
  background: var(--lnr-accent);
  border-radius: 1.5px;
}
.lnr-dock button[data-dock-btn="right"] i::after { right: 1px; top: 1px; bottom: 1px; width: 9px; }
.lnr-dock button[data-dock-btn="left"] i::after { left: 1px; top: 1px; bottom: 1px; width: 9px; }
.lnr-dock button[data-dock-btn="bottom"] i::after { left: 1px; right: 1px; bottom: 1px; height: 6px; }

.lnr-panel-toast {
  margin: 0 15px 12px;
  padding: 8px 10px;
  border-radius: 7px;
  background: var(--lnr-accent-soft);
  color: var(--lnr-accent);
  font: 500 12px/1.4 "Instrument Sans", -apple-system, BlinkMacSystemFont, sans-serif;
}
.lnr-panel-toast[hidden] { display: none; }

/* Resize handles: sides change one axis, corners change both */
.lnr-resize { position: absolute; z-index: 3; touch-action: none; }
.lnr-resize[data-resize="n"] { top: 0; left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
.lnr-resize[data-resize="s"] { bottom: 0; left: 14px; right: 14px; height: 6px; cursor: ns-resize; }
.lnr-resize[data-resize="e"] { right: 0; top: 14px; bottom: 14px; width: 6px; cursor: ew-resize; }
.lnr-resize[data-resize="w"] { left: 0; top: 14px; bottom: 14px; width: 6px; cursor: ew-resize; }
.lnr-resize[data-resize="ne"] { top: 0; right: 0; width: 16px; height: 16px; cursor: nesw-resize; }
.lnr-resize[data-resize="nw"] { top: 0; left: 0; width: 16px; height: 16px; cursor: nwse-resize; }
.lnr-resize[data-resize="se"] { bottom: 0; right: 0; width: 16px; height: 16px; cursor: nwse-resize; }
.lnr-resize[data-resize="sw"] { bottom: 0; left: 0; width: 16px; height: 16px; cursor: nesw-resize; }

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
    provider: 'kokoro',
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
    follow: true,
    dock: 'bottom',
    dockOffset: 0.5,
    panelSize: null,
    panelPos: null,
    prefs: { ...DEFAULTS, follow: true },
    pillDrag: null,
    panelDrag: null,
    panelResize: null,
    suppressClick: false,
    highlightSheet: null
  };

  const DOCK_KEY = 'listnr:dock';
  const SIZE_KEY = 'listnr:panel-size';
  const POS_KEY = 'listnr:panel-pos';
  const PREF_KEY = 'listnr:prefs';
  const THEME_KEY = 'listnr:theme';
  const DOCK_EDGES = new Set(['left', 'bottom', 'right']);
  const LEGACY_PILL_POS_KEY = 'listnr:pill-position';
  const PILL_MARGIN = 12;
  const PANEL_MARGIN = 12;
  const PANEL_MIN_WIDTH = 280;
  const PANEL_MIN_HEIGHT = 220;

  let host = null;
  let shadow = null;
  let refs = {};
  let pillToastTimer = null;
  let panelToastTimer = null;
  let prefsTimer = null;

  init();

  function init() {
    ensureUI();
    loadDock();
    loadPrefs();
    loadTheme();
    setInterval(loadTheme, 15000);
  }

  function loadTheme() {
    try {
      chrome.storage.local.get(THEME_KEY).then((stored) => {
        applyTheme(stored?.[THEME_KEY] || 'system');
      }).catch(() => {});
      chrome.runtime.sendMessage({ type: 'listnr:get-kernl-appearance' })
        .then((result) => {
          if (result?.ok && result.appearance) applyTheme(result.appearance);
        })
        .catch(() => {});
    } catch {
      // Restricted pages keep the system theme.
    }
  }

  function applyTheme(value) {
    if (!host) return;
    if (value === 'light' || value === 'dark') host.dataset.theme = value;
    else delete host.dataset.theme;
  }

  // Playback settings live in chrome.storage.local so the toolbar popup and
  // every in-page player share one set of preferences.
  function normalizePrefs(value) {
    const source = value && typeof value === 'object' ? value : {};
    const number = (input, min, max, fallback) => {
      const parsed = Number(input);
      if (!Number.isFinite(parsed)) return fallback;
      return clamp(parsed, min, max);
    };
    return {
      voice: typeof source.voice === 'string' && source.voice ? source.voice : DEFAULTS.voice,
      rate: number(source.rate, 0.5, 3, DEFAULTS.rate),
      volume: number(source.volume, 0, 1, DEFAULTS.volume),
      sentenceGap: Math.round(number(source.sentenceGap, 0, 600, DEFAULTS.sentenceGap)),
      paragraphGap: Math.round(number(source.paragraphGap, 0, 1500, DEFAULTS.paragraphGap)),
      follow: source.follow !== false
    };
  }

  function loadPrefs() {
    try {
      chrome.storage.local
        .get(PREF_KEY)
        .then((stored) => {
          applyPrefs(normalizePrefs(stored?.[PREF_KEY]));
        })
        .catch(() => {});
    } catch {
      // Storage is unavailable on restricted pages; keep the defaults.
    }
  }

  function applyPrefs(next) {
    state.prefs = next;
    state.follow = next.follow;
    state.settings = {
      ...state.settings,
      voice: next.voice,
      rate: next.rate,
      volume: next.volume,
      sentenceGap: next.sentenceGap,
      paragraphGap: next.paragraphGap
    };

    if (state.audio) {
      state.audio.playbackRate = next.rate;
      state.audio.volume = next.volume;
    }
    if (refs.pill) {
      refs.pill.hidden = !next.showPill || state.panelOpen;
    }
    if (refs.speed) {
      fillVoiceSelect();
      renderSettings();
      refs.follow.checked = next.follow;
      updateUI();
      if (next.follow && state.doc) safeHighlight(state.cursor);
    }
  }

  function savePrefs(partial, delay = 200) {
    state.prefs = { ...state.prefs, ...partial };
    if (prefsTimer) clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => {
      prefsTimer = null;
      try {
        chrome.storage.local.set({ [PREF_KEY]: { ...state.prefs } }).catch(() => {});
      } catch {
        // Ignore restricted pages.
      }
    }, delay);
  }

  function settingsFromPrefs() {
    const { voice, rate, volume, sentenceGap, paragraphGap } = state.prefs;
    return { voice, rate, volume, sentenceGap, paragraphGap };
  }

  // A dock is an edge plus a fraction along it: 0..1 maps to top..bottom on
  // the side edges and left..right along the bottom. The pill keeps wherever
  // it was dropped instead of jumping to the middle of each side.
  function normalizeDock(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      return DOCK_EDGES.has(value) ? { edge: value, offset: 0.5 } : null;
    }
    if (typeof value === 'object' && DOCK_EDGES.has(value.edge) && Number.isFinite(value.offset)) {
      return { edge: value.edge, offset: clamp(value.offset, 0, 1) };
    }
    return null;
  }

  function nearestEdge(distances) {
    // The bottom reads best, so it wins any tie.
    let best = 'bottom';
    let bestDistance = distances.bottom;
    if (distances.left < bestDistance) {
      best = 'left';
      bestDistance = distances.left;
    }
    if (distances.right < bestDistance) best = 'right';
    return best;
  }

  function dockFromFractions(position) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
    const x = clamp(position.x, 0, 1);
    const y = clamp(position.y, 0, 1);
    const edge = nearestEdge({ left: x, right: 1 - x, bottom: 1 - y });
    return { edge, offset: edge === 'bottom' ? x : y };
  }

  function normalizeSize(value) {
    if (!value || typeof value !== 'object') return null;
    if (!Number.isFinite(value.width) || !Number.isFinite(value.height)) return null;
    return {
      width: Math.max(PANEL_MIN_WIDTH, value.width),
      height: Math.max(PANEL_MIN_HEIGHT, value.height)
    };
  }

  function normalizePanelPos(value) {
    if (!value || typeof value !== 'object') return null;
    if (!Number.isFinite(value.left) || !Number.isFinite(value.top)) return null;
    return { left: value.left, top: value.top };
  }

  function loadDock() {
    try {
      chrome.storage.local
        .get([DOCK_KEY, SIZE_KEY, POS_KEY, LEGACY_PILL_POS_KEY])
        .then((stored) => {
          let found = normalizeDock(stored?.[DOCK_KEY]);
          let migrated = false;
          if (!found) {
            found = dockFromFractions(stored?.[LEGACY_PILL_POS_KEY]);
            migrated = Boolean(found);
          }
          if (found) {
            state.dock = found.edge;
            state.dockOffset = found.offset;
          }

          const size = normalizeSize(stored?.[SIZE_KEY]);
          if (size) state.panelSize = size;

          // A floating spot only survives if it came with a size; otherwise the
          // player falls back to its docked layout.
          const pos = normalizePanelPos(stored?.[POS_KEY]);
          if (pos && state.panelSize) state.panelPos = pos;

          if (stored?.[LEGACY_PILL_POS_KEY]) {
            try {
              chrome.storage.local.remove(LEGACY_PILL_POS_KEY);
            } catch {
              // Ignore restricted pages.
            }
          }

          applyDock({ animatePill: false });
          if (migrated) persistDock();
        })
        .catch(() => {});
    } catch {
      // Storage can be unavailable on restricted pages; keep the default.
    }
  }

  function persistDock() {
    try {
      chrome.storage.local.set({
        [DOCK_KEY]: { edge: state.dock, offset: Math.round(state.dockOffset * 1000) / 1000 }
      });
    } catch {
      // Ignore restricted pages.
    }
  }

  function persistPanelSize() {
    if (!state.panelSize) return;
    try {
      chrome.storage.local.set({
        [SIZE_KEY]: {
          width: Math.round(state.panelSize.width),
          height: Math.round(state.panelSize.height)
        }
      });
    } catch {
      // Ignore restricted pages.
    }
  }

  function persistPanelPos() {
    try {
      if (state.panelPos) {
        chrome.storage.local.set({
          [POS_KEY]: {
            left: Math.round(state.panelPos.left),
            top: Math.round(state.panelPos.top)
          }
        });
      } else {
        chrome.storage.local.remove(POS_KEY);
      }
    } catch {
      // Ignore restricted pages.
    }
  }

  function setDock(value) {
    if (!DOCK_EDGES.has(value)) return;
    state.dock = value;
    state.dockOffset = 0.5;
    // Snapping to an edge gives up the floating spot.
    state.panelPos = null;
    applyDock();
    persistDock();
    persistPanelPos();
  }

  function applyPillPosition({ animate = true } = {}) {
    const wrap = refs.wrap;
    const pill = refs.pill;
    if (!wrap || !pill || state.panelOpen) return;

    const width = pill.offsetWidth;
    const height = pill.offsetHeight;
    if (!width || !height) return;

    if (!animate) {
      wrap.classList.add('is-dragging');
      requestAnimationFrame(() => wrap.classList.remove('is-dragging'));
    }

    wrap.dataset.dock = 'free';
    wrap.style.transition = '';
    const maxLeft = Math.max(PILL_MARGIN, window.innerWidth - width - PILL_MARGIN);
    const maxTop = Math.max(PILL_MARGIN, window.innerHeight - height - PILL_MARGIN);
    const offset = clamp(state.dockOffset, 0, 1);
    const alongX = clamp(offset * window.innerWidth - width / 2, PILL_MARGIN, maxLeft);
    const alongY = clamp(offset * window.innerHeight - height / 2, PILL_MARGIN, maxTop);

    const anchors = {
      left: { left: PILL_MARGIN, top: alongY },
      right: { left: maxLeft, top: alongY },
      bottom: { left: alongX, top: maxTop }
    };
    const anchor = anchors[state.dock] || anchors.bottom;

    wrap.style.left = `${Math.round(anchor.left)}px`;
    wrap.style.top = `${Math.round(anchor.top)}px`;
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
  }

  // Keep the floating player fully inside the viewport so its header stays
  // reachable after a drag or a window resize.
  function clampPanelPoint(left, top, width, height) {
    const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN);
    const maxTop = Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN);
    return {
      left: clamp(left, PANEL_MARGIN, maxLeft),
      top: clamp(top, PANEL_MARGIN, maxTop)
    };
  }

  function applyPanelLayout() {
    const wrap = refs.wrap;
    const panel = refs.panel;
    if (!wrap || !panel) return;

    // The wrapper spans the viewport and the panel is positioned inside it, so
    // the open player can sit anywhere on the page.
    wrap.dataset.dock = state.panelPos ? 'free' : state.dock;
    wrap.style.left = '0';
    wrap.style.top = '0';
    wrap.style.right = '0';
    wrap.style.bottom = '0';
    wrap.style.transition = 'none';
    wrap.style.justifyContent = '';

    panel.style.position = 'absolute';
    panel.style.marginLeft = '';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const offset = clamp(state.dockOffset, 0, 1);
    const maxW = Math.max(PANEL_MIN_WIDTH, viewportW - PANEL_MARGIN * 2);
    const maxH = Math.max(PANEL_MIN_HEIGHT, viewportH - PANEL_MARGIN * 2);

    if (!state.panelSize) {
      // Until the player is resized it keeps its natural layout: side panels
      // span the side, the bottom panel hugs the bottom at its content height.
      panel.style.height = '';
      const width = Math.min(state.dock === 'bottom' && !state.panelPos ? 760 : 380, maxW);
      panel.style.width = `${width}px`;

      if (state.panelPos) {
        const point = clampPanelPoint(state.panelPos.left, state.panelPos.top, width, panel.offsetHeight);
        panel.style.left = `${Math.round(point.left)}px`;
        panel.style.top = `${Math.round(point.top)}px`;
      } else if (state.dock === 'bottom') {
        panel.style.left = `${Math.round(
          clamp(offset * viewportW - width / 2, PANEL_MARGIN, Math.max(PANEL_MARGIN, viewportW - width - PANEL_MARGIN))
        )}px`;
        panel.style.top = 'auto';
        panel.style.bottom = `${PANEL_MARGIN}px`;
      } else {
        panel.style.top = `${PANEL_MARGIN}px`;
        panel.style.bottom = `${PANEL_MARGIN}px`;
        panel.style.left = state.dock === 'left' ? `${PANEL_MARGIN}px` : 'auto';
        panel.style.right = state.dock === 'right' ? `${PANEL_MARGIN}px` : 'auto';
      }
      return;
    }

    const width = clamp(state.panelSize.width, PANEL_MIN_WIDTH, maxW);
    const height = clamp(state.panelSize.height, PANEL_MIN_HEIGHT, maxH);
    panel.style.width = `${Math.round(width)}px`;
    panel.style.height = `${Math.round(height)}px`;

    // A dragged player floats wherever it was dropped; the dock only applies
    // until the first drag, or after one of the snap buttons is pressed.
    if (state.panelPos) {
      const point = clampPanelPoint(state.panelPos.left, state.panelPos.top, width, height);
      state.panelPos = point;
      panel.style.left = `${Math.round(point.left)}px`;
      panel.style.top = `${Math.round(point.top)}px`;
      return;
    }

    if (state.dock === 'bottom') {
      panel.style.left = `${Math.round(
        clamp(offset * viewportW - width / 2, PANEL_MARGIN, Math.max(PANEL_MARGIN, viewportW - width - PANEL_MARGIN))
      )}px`;
      panel.style.top = 'auto';
      panel.style.bottom = `${PANEL_MARGIN}px`;
    } else {
      panel.style.top = `${Math.round(
        clamp(offset * viewportH - height / 2, PANEL_MARGIN, Math.max(PANEL_MARGIN, viewportH - height - PANEL_MARGIN))
      )}px`;
      panel.style.left = state.dock === 'left' ? `${PANEL_MARGIN}px` : 'auto';
      panel.style.right = state.dock === 'right' ? `${PANEL_MARGIN}px` : 'auto';
    }
  }

  // Snap to the nearest side or bottom edge and remember where along it the
  // pill landed, so it stays put rather than drifting to the edge's middle.
  function snapForRect(rect) {
    const bottomGap = window.innerHeight - (rect.top + rect.height);
    const leftGap = rect.left;
    const rightGap = window.innerWidth - (rect.left + rect.width);
    const edge = nearestEdge({ left: leftGap, right: rightGap, bottom: bottomGap });

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const offset = edge === 'bottom' ? centerX / window.innerWidth : centerY / window.innerHeight;
    return { edge, offset: clamp(offset, 0, 1) };
  }

  function applyDock({ animatePill = true } = {}) {
    if (!refs.wrap) return;
    if (state.panelOpen) applyPanelLayout();
    else applyPillPosition({ animate: animatePill });

    for (const button of refs.dockButtons || []) {
      // A floating player is not pinned to any edge, so no snap button is on.
      const on = button.dataset.dockBtn === state.dock && !state.panelPos;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function onPillPointerDown(event) {
    if (event.button !== 0 || state.panelOpen) return;
    if (event.target.closest?.('.lnr-close')) return;
    const wrap = refs.wrap;
    if (!wrap) return;

    const rect = wrap.getBoundingClientRect();
    state.pillDrag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false
    };

    // Window listeners (rather than pointer capture) keep the pill draggable
    // without retargeting the click that opens the player. They only exist
    // while a press is in flight so normal page scrolling stays untouched.
    window.addEventListener('pointermove', onPillPointerMove, { passive: false });
    window.addEventListener('pointerup', onPillPointerUp, true);
    window.addEventListener('pointercancel', onPillPointerUp, true);
    window.addEventListener('blur', cancelPillDrag, true);
  }

  function detachDragListeners() {
    window.removeEventListener('pointermove', onPillPointerMove, { passive: false });
    window.removeEventListener('pointerup', onPillPointerUp, true);
    window.removeEventListener('pointercancel', onPillPointerUp, true);
    window.removeEventListener('blur', cancelPillDrag, true);
  }

  function onPillPointerMove(event) {
    const drag = state.pillDrag;
    if (!drag || drag.id !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;

    if (!drag.moved) {
      drag.moved = true;
      refs.pill.classList.add('is-dragging');
      refs.wrap?.classList.add('is-dragging');
    }

    const maxLeft = Math.max(PILL_MARGIN, window.innerWidth - drag.width - PILL_MARGIN);
    const maxTop = Math.max(PILL_MARGIN, window.innerHeight - drag.height - PILL_MARGIN);
    const left = clamp(drag.originX + dx, PILL_MARGIN, maxLeft);
    const top = clamp(drag.originY + dy, PILL_MARGIN, maxTop);

    const wrap = refs.wrap;
    if (!wrap) return;
    wrap.dataset.dock = 'free';
    wrap.style.left = `${Math.round(left)}px`;
    wrap.style.top = `${Math.round(top)}px`;
    wrap.style.right = 'auto';
    wrap.style.bottom = 'auto';
    event.preventDefault();
  }

  function finishPillDrag(drag) {
    refs.pill.classList.remove('is-dragging');
    refs.wrap?.classList.remove('is-dragging');
    detachDragListeners();
    if (!drag.moved) return;

    // Snap to the nearest side or bottom edge and let that choice decide
    // where the expanded player appears.
    const wrap = refs.wrap;
    if (wrap) {
      const snap = snapForRect(wrap.getBoundingClientRect());
      state.dock = snap.edge;
      state.dockOffset = snap.offset;
    }
    applyDock();
    persistDock();

    // The click event follows pointerup; swallow the one produced by a drag.
    state.suppressClick = true;
    setTimeout(() => {
      state.suppressClick = false;
    }, 0);
  }

  function onPillPointerUp(event) {
    const drag = state.pillDrag;
    if (!drag || drag.id !== event.pointerId) return;
    state.pillDrag = null;
    finishPillDrag(drag);
  }

  function cancelPillDrag() {
    const drag = state.pillDrag;
    if (!drag) return;
    state.pillDrag = null;
    finishPillDrag(drag);
  }

  function ensurePanelSize(rect) {
    if (!state.panelSize) {
      const r = rect || refs.panel?.getBoundingClientRect();
      if (!r) return null;
      state.panelSize = { width: r.width, height: r.height };
    }
    return state.panelSize;
  }

  function detachPanelDragListeners() {
    window.removeEventListener('pointermove', onPanelPointerMove, { passive: false });
    window.removeEventListener('pointerup', onPanelPointerUp, true);
    window.removeEventListener('pointercancel', onPanelPointerUp, true);
    window.removeEventListener('blur', cancelPanelDrag, true);
  }

  function detachPanelResizeListeners() {
    window.removeEventListener('pointermove', onPanelResizeMove, { passive: false });
    window.removeEventListener('pointerup', onPanelResizeUp, true);
    window.removeEventListener('pointercancel', onPanelResizeUp, true);
    window.removeEventListener('blur', cancelPanelResize, true);
  }

  // Drag the open player by its header. It floats wherever it is dropped; the
  // small pill is the thing that snaps to a page edge.
  function onPanelPointerDown(event) {
    if (event.button !== 0 || !state.panelOpen) return;
    if (event.target.closest?.('button')) return;
    const panel = refs.panel;
    if (!panel) return;

    const rect = panel.getBoundingClientRect();
    state.panelDrag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false
    };
    window.addEventListener('pointermove', onPanelPointerMove, { passive: false });
    window.addEventListener('pointerup', onPanelPointerUp, true);
    window.addEventListener('pointercancel', onPanelPointerUp, true);
    window.addEventListener('blur', cancelPanelDrag, true);
  }

  function onPanelPointerMove(event) {
    const drag = state.panelDrag;
    if (!drag || drag.id !== event.pointerId) return;
    const panel = refs.panel;
    if (!panel) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;

    if (!drag.moved) {
      drag.moved = true;
      ensurePanelSize({ width: drag.width, height: drag.height });
      panel.classList.add('is-panel-dragging');
    }

    const point = clampPanelPoint(drag.left + dx, drag.top + dy, drag.width, drag.height);

    panel.style.width = `${Math.round(drag.width)}px`;
    panel.style.height = `${Math.round(drag.height)}px`;
    panel.style.left = `${Math.round(point.left)}px`;
    panel.style.top = `${Math.round(point.top)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    event.preventDefault();
  }

  function finishPanelDrag(drag) {
    detachPanelDragListeners();
    refs.panel?.classList.remove('is-panel-dragging');
    if (!drag.moved || !refs.panel) return;

    const rect = refs.panel.getBoundingClientRect();
    state.panelSize = { width: rect.width, height: rect.height };
    state.panelPos = clampPanelPoint(rect.left, rect.top, rect.width, rect.height);
    applyDock();
    persistPanelSize();
    persistPanelPos();
  }

  function onPanelPointerUp(event) {
    const drag = state.panelDrag;
    if (!drag || drag.id !== event.pointerId) return;
    state.panelDrag = null;
    finishPanelDrag(drag);
  }

  function cancelPanelDrag() {
    const drag = state.panelDrag;
    if (!drag) return;
    state.panelDrag = null;
    finishPanelDrag(drag);
  }

  function onPanelResizeDown(event) {
    if (event.button !== 0) return;
    const dir = event.currentTarget?.dataset?.resize;
    if (!dir) return;
    event.preventDefault();
    event.stopPropagation();

    const panel = refs.panel;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    state.panelResize = {
      id: event.pointerId,
      dir,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false
    };
    window.addEventListener('pointermove', onPanelResizeMove, { passive: false });
    window.addEventListener('pointerup', onPanelResizeUp, true);
    window.addEventListener('pointercancel', onPanelResizeUp, true);
    window.addEventListener('blur', cancelPanelResize, true);
  }

  function onPanelResizeMove(event) {
    const resize = state.panelResize;
    if (!resize || resize.id !== event.pointerId) return;

    const dx = event.clientX - resize.startX;
    const dy = event.clientY - resize.startY;
    if (!resize.moved && Math.hypot(dx, dy) < 2) return;
    resize.moved = true;
    event.preventDefault();

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const maxW = Math.max(PANEL_MIN_WIDTH, viewportW - PANEL_MARGIN * 2);
    const maxH = Math.max(PANEL_MIN_HEIGHT, viewportH - PANEL_MARGIN * 2);
    const dir = resize.dir;
    const west = dir.includes('w');
    const east = dir.includes('e');
    const north = dir.includes('n');
    const south = dir.includes('s');
    if (!west && !east && !north && !south) return;

    let width = resize.width;
    let height = resize.height;

    if (west) width = clamp(resize.width - dx, PANEL_MIN_WIDTH, maxW);
    else if (east) width = clamp(resize.width + dx, PANEL_MIN_WIDTH, maxW);

    if (north) height = clamp(resize.height - dy, PANEL_MIN_HEIGHT, maxH);
    else if (south) height = clamp(resize.height + dy, PANEL_MIN_HEIGHT, maxH);

    state.panelSize = { width, height };

    // Pin the edge opposite the handle so the panel grows away from it.
    if (state.panelPos) {
      const left = west ? resize.left + resize.width - width : resize.left;
      const top = north ? resize.top + resize.height - height : resize.top;
      state.panelPos = clampPanelPoint(left, top, width, height);
    } else {
      const centerX = resize.left + (west ? resize.width - width / 2 : width / 2);
      const centerY = resize.top + (north ? resize.height - height / 2 : height / 2);
      if (state.dock === 'bottom') {
        state.dockOffset = clamp(centerX / viewportW, 0, 1);
      } else {
        state.dockOffset = clamp(centerY / viewportH, 0, 1);
      }
    }

    applyPanelLayout();
  }

  function finishPanelResize(resize) {
    detachPanelResizeListeners();
    if (!resize.moved) return;
    applyPanelLayout();
    persistPanelSize();
    persistDock();
    persistPanelPos();
  }

  function onPanelResizeUp(event) {
    const resize = state.panelResize;
    if (!resize || resize.id !== event.pointerId) return;
    state.panelResize = null;
    finishPanelResize(resize);
  }

  function cancelPanelResize() {
    const resize = state.panelResize;
    if (!resize) return;
    state.panelResize = null;
    finishPanelResize(resize);
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
        <div class="lnr-pill" role="group" aria-label="listnr" title="Drag to move · Click Listen to read this page">
          <button class="lnr-main" type="button" title="Listen to this page with listnr · drag the pill to move it">
            <span class="lnr-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            <span class="lnr-label">listen</span>
          </button>
          <button class="lnr-close" type="button" aria-label="Hide listnr on this page" title="Hide on this page">×</button>
          <div class="lnr-pill-toast" role="status" aria-live="polite" hidden></div>
        </div>

        <section class="lnr-panel" aria-label="listnr in-page player" hidden>
          <header class="lnr-head">
            <div class="lnr-brand">
              <img class="lnr-mark" src="${chrome.runtime.getURL('icons/logo.png')}" alt="" />
              <span>listnr</span>
            </div>
            <div class="lnr-head-actions">
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
            <button class="lnr-speed" type="button" title="Change speed">1×</button>
            <button class="lnr-icon lnr-settings-btn" type="button" title="Settings" aria-label="Settings">${ICON.gear}</button>
          </div>
          <div class="lnr-settings" hidden>
            <label>Snap player</label>
            <div class="lnr-dock" role="group" aria-label="Snap player to an edge">
              <button type="button" data-dock-btn="left" title="Left side" aria-pressed="false"><i aria-hidden="true"></i><span>Left</span></button>
              <button type="button" data-dock-btn="bottom" title="Bottom edge" aria-pressed="false"><i aria-hidden="true"></i><span>Bottom</span></button>
              <button type="button" data-dock-btn="right" title="Right side" aria-pressed="false"><i aria-hidden="true"></i><span>Right</span></button>
            </div>
            <label>Speed <b class="lnr-speed-value">1×</b><input class="lnr-speed-range" type="range" min="0.5" max="3" step="0.05" value="1"></label>
            <div class="lnr-presets"></div>
            <label>Voice<select class="lnr-voice"></select></label>
            <label>Volume <b class="lnr-volume-value">100%</b><input class="lnr-volume-range" type="range" min="0" max="1" step="0.05" value="1"></label>
            <label>Sentence pause <b class="lnr-sentence-gap-value">160 ms</b><input class="lnr-sentence-gap" type="range" min="0" max="600" step="20" value="160"></label>
            <label>Paragraph pause <b class="lnr-paragraph-gap-value">600 ms</b><input class="lnr-paragraph-gap" type="range" min="0" max="1500" step="50" value="600"></label>
            <label class="lnr-follow"><input class="lnr-follow-input" type="checkbox" ${state.follow ? 'checked' : ''}> Follow highlighted text</label>
            <button class="lnr-reset" type="button">Reset to defaults</button>
            <p class="lnr-hint">The page text is highlighted as it plays. Drag the player by its header to move it anywhere; drag the pill to snap it to a page edge. Drag the player's edges or corners to resize. Playback settings are shared with the listnr toolbar popup.</p>
          </div>
          <div class="lnr-panel-toast" role="status" aria-live="polite" hidden></div>
          <div class="lnr-resize" data-resize="n" aria-hidden="true"></div>
          <div class="lnr-resize" data-resize="s" aria-hidden="true"></div>
          <div class="lnr-resize" data-resize="e" aria-hidden="true"></div>
          <div class="lnr-resize" data-resize="w" aria-hidden="true"></div>
          <div class="lnr-resize" data-resize="ne" aria-hidden="true"></div>
          <div class="lnr-resize" data-resize="nw" aria-hidden="true"></div>
          <div class="lnr-resize" data-resize="se" aria-hidden="true"></div>
          <div class="lnr-resize" data-resize="sw" aria-hidden="true"></div>
        </section>
      </div>`;

    refs = {
      wrap: shadow.querySelector('.lnr-wrap'),
      pill: shadow.querySelector('.lnr-pill'),
      main: shadow.querySelector('.lnr-main'),
      label: shadow.querySelector('.lnr-label'),
      close: shadow.querySelector('.lnr-close'),
      pillToast: shadow.querySelector('.lnr-pill-toast'),
      panel: shadow.querySelector('.lnr-panel'),
      head: shadow.querySelector('.lnr-head'),
      resizers: [...shadow.querySelectorAll('.lnr-resize')],
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
      dockButtons: [...shadow.querySelectorAll('.lnr-dock button')],
      panelToast: shadow.querySelector('.lnr-panel-toast'),
      minimize: shadow.querySelector('.lnr-min'),
      reset: shadow.querySelector('.lnr-reset')
    };

    applyDock();
    bindEvents();
    state.audio = new Audio();
    state.audio.preload = 'auto';
    try {
      state.audio.preservesPitch = true;
    } catch {
      // Older engines.
    }
    state.audio.addEventListener('ended', onAudioEnded);
    state.audio.addEventListener('timeupdate', highlightSpokenWord);

    document.documentElement.append(host);
    applyPillPosition({ animate: false });
  }

  function bindEvents() {
    refs.main.addEventListener('click', (event) => {
      if (state.suppressClick) {
        state.suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (state.doc) showPanel();
      else startImport();
    });
    refs.pill.addEventListener('pointerdown', onPillPointerDown);
    refs.head.addEventListener('pointerdown', onPanelPointerDown);
    for (const handle of refs.resizers) {
      handle.addEventListener('pointerdown', onPanelResizeDown);
    }
    refs.close.addEventListener('click', closeExtension);
    refs.minimize.addEventListener('click', minimizePanel);
    refs.play.addEventListener('click', togglePlay);
    refs.prev.addEventListener('click', () => skip(-1));
    refs.next.addEventListener('click', () => skip(1));
    refs.stop.addEventListener('click', stopPlayback);
    refs.speed.addEventListener('click', cycleRate);
    refs.reset.addEventListener('click', resetDefaults);
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
      savePrefs({ rate });
    });

    refs.voice.addEventListener('change', () => changeVoice(refs.voice.value));

    refs.volumeRange.addEventListener('input', () => {
      const volume = clamp(Number(refs.volumeRange.value), 0, 1);
      state.settings.volume = volume;
      refs.volumeValue.textContent = `${Math.round(volume * 100)}%`;
      if (state.audio) state.audio.volume = volume;
      saveStateDebounced();
      savePrefs({ volume });
    });

    refs.sentenceGap.addEventListener('input', () => {
      state.settings.sentenceGap = Number(refs.sentenceGap.value);
      refs.sentenceGapValue.textContent = `${state.settings.sentenceGap} ms`;
      saveStateDebounced();
      savePrefs({ sentenceGap: state.settings.sentenceGap });
    });

    refs.paragraphGap.addEventListener('input', () => {
      state.settings.paragraphGap = Number(refs.paragraphGap.value);
      refs.paragraphGapValue.textContent = `${state.settings.paragraphGap} ms`;
      saveStateDebounced();
      savePrefs({ paragraphGap: state.settings.paragraphGap });
    });

    refs.follow.addEventListener('change', () => {
      state.follow = refs.follow.checked;
      savePrefs({ follow: state.follow });
      if (state.follow) safeHighlight(state.cursor);
    });

    for (const button of refs.dockButtons) {
      button.addEventListener('click', () => setDock(button.dataset.dockBtn));
    }

    window.addEventListener('resize', () => {
      if (state.panelOpen) applyPanelLayout();
      else applyPillPosition();
    });

    // The toolbar popup writes the same preferences; mirror them live.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[PREF_KEY]) applyPrefs(normalizePrefs(changes[PREF_KEY].newValue));
      if (changes[THEME_KEY]) applyTheme(changes[THEME_KEY].newValue || 'system');
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'listnr:listen-page') {
        // Option L opens the player and starts reading straight away; pressed
        // again while reading, it pauses.
        ensureUI();
        if (state.doc) {
          showPanel();
          togglePlay();
        } else {
          startImport({ play: true });
        }
      }
    });
  }

  async function startImport({ play = false } = {}) {
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
      showPillToast('listnr could not find readable text on this page.');
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
      if (play && state.playback !== 'playing' && state.playback !== 'loading') togglePlay();
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
    state.settings = {
      ...DEFAULTS,
      ...(doc.settings || {}),
      // The toolbar settings are the shared defaults for every page.
      ...settingsFromPrefs()
    };
    state.follow = state.prefs.follow;
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
    applyPanelLayout();
    updateUI();
    safeHighlight(state.cursor);
  }

  function minimizePanel() {
    if (!state.panelOpen) return;
    state.panelOpen = false;
    refs.panel.hidden = true;
    refs.pill.hidden = false;
    applyPillPosition({ animate: false });
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
        if (!result?.ok) return;
        if (result.provider) state.provider = result.provider;
        if (Array.isArray(result.voices)) {
          state.voices = result.voices;
          if (!state.voices.length && state.provider !== 'kokoro') {
            state.voices = [];
          }
        }
        fillVoiceSelect();
      })
      .catch(() => {});
  }

  function fillVoiceSelect() {
    if (!refs.voice) return;
    const current = state.settings.voice;
    refs.voice.textContent = '';
    const voices = state.voices.length
      ? state.voices
      : state.provider === 'kokoro'
        ? FALLBACK_VOICES
        : [];
    if (!voices.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Configure a voice on the listnr server';
      refs.voice.append(option);
      return;
    }
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

  // The speed button steps through the common speeds; the slider in settings
  // covers everything in between.
  const SPEED_STEPS = [1, 1.25, 1.5, 2, 0.8];
  function cycleRate() {
    const current = state.settings.rate;
    const index = SPEED_STEPS.findIndex((step) => Math.abs(step - current) < 0.001);
    setRate(SPEED_STEPS[(index + 1) % SPEED_STEPS.length]);
  }

  function resetDefaults() {
    const { showPill, ...playback } = DEFAULTS;
    if (playback.voice !== state.settings.voice) changeVoice(playback.voice);
    applyPrefs({ ...state.prefs, ...playback, follow: true });
    savePrefs({ ...playback, follow: true });
    saveStateDebounced();
    setDock('bottom');
  }

  function setRate(rate) {
    state.settings.rate = clamp(Number(rate) || 1, 0.5, 3);
    if (state.audio) state.audio.playbackRate = state.settings.rate;
    renderSpeed();
    updateUI();
    saveStateDebounced();
    savePrefs({ rate: state.settings.rate });
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
    savePrefs({ voice: voiceId });
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
          ? 'Voice service unavailable. Check the listnr server configuration, then press play again.'
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

  // Words are timed by their length plus the pause a voice takes after
  // punctuation, mapped onto the real playback position of the sentence.
  function wordWeights(words) {
    return words.map((word) => {
      let weight = word.length + 2;
      if (/[.!?]$/.test(word)) weight += 8;
      else if (/[,;:]$/.test(word)) weight += 4;
      return weight;
    });
  }

  function renderReadAlong() {
    const box = refs.sentence;
    if (!box) return;
    const current = state.segments[state.cursor];
    box.replaceChildren();
    state.readAlong = null;
    if (!current?.text) return;
    const words = current.text.split(/\s+/).filter(Boolean);
    const now = document.createElement('span');
    now.className = 'lnr-now';
    const spans = words.map((word, index) => {
      const span = document.createElement('span');
      span.textContent = word;
      now.append(span);
      if (index < words.length - 1) now.append(' ');
      return span;
    });
    box.append(now);
    // Fill the rest of the box with what comes next.
    const next = document.createElement('span');
    next.className = 'lnr-next';
    let characters = 0;
    for (let i = state.cursor + 1; i < state.segments.length && characters < 1200; i += 1) {
      const text = state.segments[i]?.text || '';
      next.append(' ' + text);
      characters += text.length;
    }
    if (characters) box.append(next);
    const weights = wordWeights(words);
    let running = 0;
    state.readAlong = { spans, ends: weights.map((w) => (running += w)), total: running, lit: -1, index: state.cursor };
    box.scrollTop = 0;
  }

  function highlightSpokenWord() {
    const along = state.readAlong;
    const audio = state.audio;
    if (!along || !audio || !audio.duration || !Number.isFinite(audio.duration)) return;
    const target = clamp(audio.currentTime / audio.duration, 0, 1) * along.total;
    let index = along.ends.findIndex((end) => end >= target);
    if (index < 0) index = along.spans.length - 1;
    if (index === along.lit) return;
    if (along.lit >= 0) along.spans[along.lit]?.classList.remove('is-word');
    along.spans[index]?.classList.add('is-word');
    along.lit = index;
  }

  function setCursor(index) {
    if (!state.segments.length) return;
    state.cursor = clamp(index, 0, state.segments.length - 1);
    renderReadAlong();
    refs.position.textContent = `Sentence ${state.cursor + 1} of ${state.segments.length}`;
    safeHighlight(state.cursor);
  }

  function updateUI() {
    if (!refs.play || !state.doc) return;

    const rate = Number(state.settings.rate) || 1;
    refs.title.textContent = state.doc.title || 'Web page';
    if (state.playback === 'loading' && !state.segments[state.cursor]?.text) {
      refs.sentence.textContent = 'Preparing audio…';
      state.readAlong = null;
    } else if (state.readAlong?.index !== state.cursor) {
      renderReadAlong();
    }
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
          '){background-color:rgba(17,87,76,.35);color:#FBE9CE;border-radius:2px;}'
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
