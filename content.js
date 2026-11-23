/* LISTNR content script — page extraction, reader drawer, highlight, controls. */

(() => {
  'use strict';

  if (window.__LISTNR_READER__) return;
  window.__LISTNR_READER__ = true;

  const DEFAULTS = {
    engine: 'free',
    rate: 1,
    voiceURI: '',
    sentenceGap: 160,
    paragraphGap: 600,
    fontSize: 19,
    theme: 'paper',
    studioModel: 'gpt-4o-mini-tts',
    studioVoice: 'coral'
  };

  const SPEEDS = [0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const STUDIO_VOICES = [
    'coral', 'alloy', 'ash', 'ballad', 'echo', 'fable',
    'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'
  ];
  const MAX_CHARS = 140000;
  const MAX_SEGMENTS = 4000;

  const ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8.5 5.2c0-.8.9-1.3 1.6-.9l9 6.8c.6.4.6 1.4 0 1.8l-9 6.8c-.7.4-1.6-.1-1.6-.9V5.2Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.3" y="4.4" width="4.2" height="15.2" rx="1.5"/><rect x="13.5" y="4.4" width="4.2" height="15.2" rx="1.5"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5.4" y="5.2" width="2.6" height="13.6" rx="1.3"/><path d="M19 6.4c0-.9-1-1.4-1.7-.8l-8.1 6.4c-.5.4-.5 1.2 0 1.6l8.1 6.4c.7.6 1.7.1 1.7-.8V6.4Z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="16" y="5.2" width="2.6" height="13.6" rx="1.3"/><path d="M5 6.4c0-.9 1-1.4 1.7-.8l8.1 6.4c.5.4.5 1.2 0 1.6l-8.1 6.4c-.7.6-1.7.1-1.7-.8V6.4Z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7.5h7.5M18.5 7.5H20M4 16.5h2M10.5 16.5H20"/><circle cx="15" cy="7.5" r="2.6"/><circle cx="7.6" cy="16.5" r="2.6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>'
  };

  const CSS = String.raw`
:host { all: initial; }
* { box-sizing: border-box; }

.lnr-scrim {
  position: fixed; inset: 0;
  background: rgba(28, 21, 12, .26);
  -webkit-backdrop-filter: blur(1.5px);
  backdrop-filter: blur(1.5px);
  pointer-events: auto;
  animation: lnr-fade .24s ease both;
}

.lnr-reader {
  --paper: #f7f2e8;
  --paper-2: #fffdf8;
  --paper-3: #ece4d6;
  --ink: #211e19;
  --ink-2: #4e473d;
  --muted: #7f7669;
  --rule: #e1d7c7;
  --accent: #dd552f;
  --accent-2: #bd3f1c;
  --accent-soft: #f8ded2;
  --accent-wash: rgba(221, 85, 47, .10);
  --good: #2f7d5b;
  --shadow: -16px 0 60px rgba(48, 34, 17, .22);
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
  --serif: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Charter, Georgia, serif;
  --read-size: 19px;

  position: fixed; top: 0; right: 0; bottom: 0;
  width: min(510px, 100vw);
  display: flex; flex-direction: column;
  background: var(--paper);
  color: var(--ink);
  border-left: 1px solid rgba(80, 60, 30, .12);
  box-shadow: var(--shadow);
  font-family: var(--sans);
  pointer-events: auto;
  z-index: 1;
  animation: lnr-slide .28s cubic-bezier(.2, .8, .2, 1) both;
}
.lnr-reader:focus { outline: none; }
.lnr-reader[data-theme="night"] {
  --paper: #161512;
  --paper-2: #1f1d18;
  --paper-3: #2b2721;
  --ink: #efe9dd;
  --ink-2: #c8c0b1;
  --muted: #92897a;
  --rule: #343029;
  --accent: #f2784f;
  --accent-2: #ffa07e;
  --accent-soft: #3a261e;
  --accent-wash: rgba(242, 120, 79, .13);
  --good: #6fbf98;
  --shadow: -16px 0 70px rgba(0, 0, 0, .55);
  border-left-color: rgba(255, 255, 255, .06);
}
.lnr-reader.lnr-leaving { animation: lnr-slide-out .2s ease both; }

.lnr-progress {
  position: absolute; top: 0; left: 0; right: 0; height: 3px;
  z-index: 4; pointer-events: none;
}
.lnr-progress span {
  display: block; height: 100%; width: 0%;
  background: var(--accent);
  border-radius: 0 2px 2px 0;
  transition: width .4s ease;
}

.lnr-head {
  position: relative;
  flex: 0 0 auto;
  padding: 18px 22px 0;
  background: linear-gradient(to bottom, var(--paper-2), var(--paper));
  border-bottom: 1px solid var(--rule);
}
.lnr-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }

.lnr-brand {
  display: flex; align-items: center; gap: 8px;
  font: 700 10.5px/1 var(--sans);
  letter-spacing: .22em;
  color: var(--ink);
  text-transform: uppercase;
}
.lnr-eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 13px; }
.lnr-eq i {
  display: block; width: 2px; height: 13px; border-radius: 1px;
  background: var(--accent);
  transform: scaleY(.38);
  transform-origin: bottom center;
}
.lnr-reader.is-playing .lnr-eq i { animation: lnr-eq .9s ease-in-out infinite; }
.lnr-reader.is-playing .lnr-eq i:nth-child(2) { animation-delay: .15s; }
.lnr-reader.is-playing .lnr-eq i:nth-child(3) { animation-delay: .32s; }
.lnr-reader.is-playing .lnr-eq i:nth-child(4) { animation-delay: .47s; }

.lnr-title {
  font-family: var(--serif);
  font-weight: 600;
  font-size: 27px;
  line-height: 1.16;
  letter-spacing: -.012em;
  margin: 14px 0 6px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.lnr-meta {
  color: var(--muted);
  font-size: 10.5px;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.lnr-controls {
  display: flex; align-items: center; gap: 8px;
  padding: 15px 0 14px;
}
.lnr-ibtn {
  width: 36px; height: 36px; flex: 0 0 auto;
  display: grid; place-items: center;
  border: 1px solid var(--rule);
  border-radius: 50%;
  background: var(--paper-2);
  color: var(--ink-2);
  cursor: pointer;
  padding: 0;
  transition: background .16s, color .16s, transform .16s;
}
.lnr-ibtn:hover { background: var(--paper-3); color: var(--ink); transform: translateY(-1px); }
.lnr-ibtn svg { width: 17px; height: 17px; }
.lnr-x { border-color: transparent; background: transparent; color: var(--muted); width: 32px; height: 32px; }
.lnr-x:hover { background: var(--paper-3); }
.lnr-x svg { width: 16px; height: 16px; }

.lnr-play {
  width: 52px; height: 52px; flex: 0 0 auto;
  margin: 0 2px;
  display: grid; place-items: center;
  border: 0; border-radius: 50%;
  background: var(--accent);
  color: #fff8f0;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(200, 70, 35, .32);
  transition: transform .16s, background .16s;
}
.lnr-play:hover { transform: scale(1.045); background: var(--accent-2); }
.lnr-play:active { transform: scale(.97); }
.lnr-play svg { width: 22px; height: 22px; }

.lnr-speed {
  height: 36px; flex: 0 0 auto;
  padding: 0 13px;
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: var(--paper-2);
  color: var(--ink);
  font: 600 12.5px/1 var(--sans);
  font-variant-numeric: tabular-nums;
  letter-spacing: .02em;
  cursor: pointer;
  transition: background .16s;
}
.lnr-speed:hover { background: var(--paper-3); }
.lnr-gear { margin-left: auto; }

.lnr-pop {
  position: absolute;
  top: calc(100% - 4px);
  right: 20px;
  z-index: 8;
  width: 300px;
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-2);
  padding: 14px;
  box-shadow: 0 16px 44px rgba(45, 30, 12, .18);
  animation: lnr-pop .18s ease both;
}
.lnr-pop[hidden] { display: none; }
.lnr-settings-pop {
  left: 16px; right: 16px; width: auto;
  max-height: min(70vh, 580px);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.lnr-pop section + section { margin-top: 16px; padding-top: 14px; border-top: 1px dashed var(--rule); }
.lnr-pop-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  margin-bottom: 10px;
  font: 700 10.5px/1 var(--sans);
  letter-spacing: .13em;
  text-transform: uppercase;
  color: var(--muted);
}
.lnr-pop-head b {
  font-size: 14px;
  letter-spacing: 0;
  text-transform: none;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.lnr-label {
  display: block;
  margin: 0 0 7px;
  font: 700 10.5px/1.2 var(--sans);
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--muted);
}
.lnr-slider-label {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  margin: 10px 0 4px;
  font: 500 11.5px/1.3 var(--sans);
  color: var(--ink-2);
}
.lnr-slider-label b { color: var(--ink); font-variant-numeric: tabular-nums; font-weight: 600; }
.lnr-hint {
  margin: 8px 0 0;
  font: 400 10.5px/1.45 var(--sans);
  color: var(--muted);
}

.lnr-range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 22px;
  margin: 0;
  background: transparent;
  cursor: pointer;
}
.lnr-range::-webkit-slider-runnable-track {
  height: 4px; border-radius: 2px; background: var(--paper-3);
}
.lnr-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 15px; height: 15px;
  margin-top: -5.5px;
  border-radius: 50%;
  background: var(--accent);
  border: 2px solid var(--paper-2);
  box-shadow: 0 1px 4px rgba(0, 0, 0, .22);
  cursor: pointer;
}

.lnr-presets { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 2px; }
.lnr-presets button {
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-2);
  padding: 5px 9px;
  font: 600 11px/1 var(--sans);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.lnr-presets button:hover { border-color: var(--accent); color: var(--ink); }
.lnr-presets button.is-on { background: var(--ink); border-color: var(--ink); color: var(--paper-2); }

.lnr-seg {
  display: flex; gap: 3px;
  background: var(--paper-3);
  padding: 3px;
  border-radius: 9px;
}
.lnr-seg button {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 5px;
  border: 0; border-radius: 7px;
  background: transparent;
  color: var(--ink-2);
  padding: 8px 6px;
  font: 600 11.5px/1 var(--sans);
  cursor: pointer;
}
.lnr-seg button.is-on {
  background: var(--paper-2);
  color: var(--ink);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .08);
}
.lnr-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
.lnr-theme { margin-top: 10px; }

.lnr-select, .lnr-input {
  width: 100%;
  height: 34px;
  border: 1px solid var(--rule);
  border-radius: 8px;
  background: var(--paper-2);
  color: var(--ink);
  font: 500 12px/1 var(--sans);
  padding: 0 9px;
  outline: none;
}
.lnr-select:focus, .lnr-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-wash);
}
.lnr-keyrow { display: flex; gap: 6px; }
.lnr-keyrow .lnr-input { flex: 1; min-width: 0; }
.lnr-btn {
  border: 1px solid var(--ink);
  border-radius: 8px;
  background: var(--ink);
  color: var(--paper-2);
  padding: 0 12px;
  font: 600 11.5px/1 var(--sans);
  cursor: pointer;
}
.lnr-btn:hover { opacity: .88; }
.lnr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }

.lnr-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--rule) transparent;
  padding: 22px 26px 40px 30px;
}
.lnr-scroll::-webkit-scrollbar { width: 10px; }
.lnr-scroll::-webkit-scrollbar-thumb {
  background: var(--rule); border-radius: 6px; border: 3px solid var(--paper);
}

.lnr-article {
  font-family: var(--serif);
  font-size: var(--read-size);
  line-height: 1.72;
  color: var(--ink);
  letter-spacing: .002em;
  direction: inherit;
}
.lnr-block { margin: 0 0 1.02em; }
.lnr-article h1, .lnr-article h2, .lnr-article h3,
.lnr-article h4, .lnr-article h5, .lnr-article h6 {
  font-family: var(--sans);
  font-weight: 650;
  line-height: 1.26;
  letter-spacing: -.015em;
  margin: 1.5em 0 .55em;
}
.lnr-article h1 { font-size: 1.42em; }
.lnr-article h2 { font-size: 1.26em; }
.lnr-article h3 { font-size: 1.14em; }
.lnr-article h4, .lnr-article h5, .lnr-article h6 { font-size: 1.02em; }
.lnr-article > :first-child { margin-top: 0; }
.lnr-block[data-kind="quote"] {
  border-left: 3px solid var(--accent);
  padding-left: 14px;
  color: var(--ink-2);
  font-style: italic;
}
.lnr-block[data-kind="code"] {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .8em;
  line-height: 1.55;
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: 8px;
  padding: 10px 12px;
  white-space: pre-wrap;
}
.lnr-block[data-kind="li"] { position: relative; padding-left: 1.05em; }
.lnr-block[data-kind="li"]::before {
  content: "";
  position: absolute; left: .22em; top: .74em;
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--accent);
}
.lnr-block[data-kind="caption"] {
  font-family: var(--sans);
  font-size: .8em;
  line-height: 1.5;
  color: var(--muted);
}

.lnr-s {
  cursor: pointer;
  border-radius: 4px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  transition: background-color .24s ease, color .24s ease;
}
.lnr-s:hover { background: rgba(120, 100, 70, .09); }
.lnr-s.lnr-active {
  background: var(--accent-soft);
  box-shadow: 0 0 0 1px var(--accent-soft);
}
.lnr-word {
  background: var(--accent);
  color: #fff8f0;
  border-radius: 3px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

.lnr-foot {
  flex: 0 0 auto;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  border-top: 1px solid var(--rule);
  background: var(--paper-2);
  padding: 11px 22px;
  color: var(--muted);
  font: 500 11px/1.3 var(--sans);
  font-variant-numeric: tabular-nums;
}
.lnr-engine { display: flex; align-items: center; gap: 7px; text-align: right; }
.lnr-engine::before {
  content: "";
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--good);
  box-shadow: 0 0 0 3px rgba(47, 125, 91, .12);
}
.lnr-reader[data-engine="studio"] .lnr-engine::before {
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-wash);
}

.lnr-toast {
  position: absolute;
  left: 20px; right: 20px; bottom: 60px;
  z-index: 12;
  border-radius: 10px;
  background: var(--ink);
  color: var(--paper-2);
  padding: 11px 14px;
  font: 500 12px/1.45 var(--sans);
  box-shadow: 0 12px 34px rgba(0, 0, 0, .26);
  animation: lnr-rise .2s ease both;
  pointer-events: none;
}
.lnr-toast[hidden] { display: none; }

.lnr-page-toast {
  background: #211e19;
  color: #fff8f0;
  border-radius: 10px;
  padding: 11px 16px;
  font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  box-shadow: 0 10px 34px rgba(0, 0, 0, .32);
  white-space: nowrap;
}

button:focus-visible, select:focus-visible, input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

@keyframes lnr-slide {
  from { transform: translateX(28px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes lnr-slide-out {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(30px); opacity: 0; }
}
@keyframes lnr-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes lnr-pop {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes lnr-rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes lnr-eq {
  0%, 100% { transform: scaleY(.36); }
  50% { transform: scaleY(1); }
}

@media (max-width: 560px) {
  .lnr-reader { width: 100vw; border-left: 0; }
  .lnr-scrim { display: none; }
  .lnr-head { padding: 16px 18px 0; }
  .lnr-scroll { padding: 18px 20px 34px; }
  .lnr-title { font-size: 24px; }
  .lnr-settings-pop { left: 10px; right: 10px; }
  .lnr-speed-pop { right: 10px; width: 280px; }
}

@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
}
`;

  const HTML = `
<div class="lnr-scrim" data-el="scrim"></div>
<aside class="lnr-reader" data-el="reader" tabindex="-1" role="dialog" aria-label="LISTNR reader">
  <div class="lnr-progress"><span data-el="progressBar"></span></div>
  <header class="lnr-head">
    <div class="lnr-top">
      <div class="lnr-brand">
        <span class="lnr-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span>LISTNR</span>
      </div>
      <button class="lnr-ibtn lnr-x" data-el="close" type="button" aria-label="Close reader">${ICON.close}</button>
    </div>
    <h1 class="lnr-title" data-el="title"></h1>
    <div class="lnr-meta" data-el="meta"></div>
    <div class="lnr-controls">
      <button class="lnr-ibtn" data-el="prev" type="button" aria-label="Previous sentence">${ICON.prev}</button>
      <button class="lnr-play" data-el="play" type="button" aria-label="Play">${ICON.play}</button>
      <button class="lnr-ibtn" data-el="next" type="button" aria-label="Next sentence">${ICON.next}</button>
      <button class="lnr-speed" data-el="speedChip" type="button" aria-label="Reading speed">1×</button>
      <button class="lnr-ibtn lnr-gear" data-el="settingsBtn" type="button" aria-label="Reader settings">${ICON.settings}</button>
    </div>

    <div class="lnr-pop lnr-speed-pop" data-el="speedPop" hidden>
      <div class="lnr-pop-head"><span>Speed</span><b data-el="speedValue">1×</b></div>
      <input class="lnr-range" data-el="speedRange" type="range" min="0.5" max="3" step="0.05" value="1" aria-label="Reading speed">
      <div class="lnr-presets" data-el="speedPresets"></div>
      <p class="lnr-hint">Space to play or pause · ← → skips a sentence</p>
    </div>

    <div class="lnr-pop lnr-settings-pop" data-el="settingsPop" hidden>
      <section>
        <span class="lnr-label">Voice engine</span>
        <div class="lnr-seg" data-el="engineSeg">
          <button type="button" data-engine="free">Free browser</button>
          <button type="button" data-engine="studio">Studio <span class="lnr-dot"></span></button>
        </div>
        <p class="lnr-hint" data-el="engineHint">Free uses your computer’s built-in voices and costs nothing.</p>
      </section>

      <section data-el="freeSection">
        <label class="lnr-label" for="lnr-voice">Browser voice</label>
        <select class="lnr-select" data-el="voiceSelect" id="lnr-voice"></select>
        <p class="lnr-hint">macOS “Premium” or “Enhanced” voices sound best. Add them in System Settings → Accessibility → Spoken Content.</p>
      </section>

      <section data-el="studioSection">
        <div class="lnr-pop-head"><span>Studio voice (optional)</span></div>
        <label class="lnr-label" for="lnr-key">OpenAI API key</label>
        <div class="lnr-keyrow">
          <input class="lnr-input" data-el="keyInput" id="lnr-key" type="password" placeholder="sk-…" autocomplete="off" spellcheck="false">
          <button class="lnr-btn" data-el="keySave" type="button">Save</button>
        </div>
        <p class="lnr-hint" data-el="keyHint">Stored in this browser only. Sent only to api.openai.com.</p>
        <div class="lnr-grid">
          <div>
            <label class="lnr-label" for="lnr-model">Model</label>
            <select class="lnr-select" data-el="modelSelect" id="lnr-model">
              <option value="gpt-4o-mini-tts">gpt-4o-mini-tts</option>
              <option value="tts-1-hd">tts-1-hd</option>
              <option value="tts-1">tts-1</option>
            </select>
          </div>
          <div>
            <label class="lnr-label" for="lnr-svoice">Studio voice</label>
            <select class="lnr-select" data-el="studioVoice" id="lnr-svoice"></select>
          </div>
        </div>
        <p class="lnr-hint" data-el="usageLine">Studio audio: nothing yet this session.</p>
      </section>

      <section>
        <div class="lnr-pop-head"><span>Pauses</span></div>
        <label class="lnr-slider-label">Between sentences <b data-el="sentenceGapValue"></b></label>
        <input class="lnr-range" data-el="sentenceGap" type="range" min="0" max="600" step="20" value="160">
        <label class="lnr-slider-label">Between paragraphs <b data-el="paragraphGapValue"></b></label>
        <input class="lnr-range" data-el="paragraphGap" type="range" min="0" max="1500" step="50" value="600">
        <p class="lnr-hint">Pauses shorten automatically at faster speeds.</p>
      </section>

      <section>
        <div class="lnr-pop-head"><span>Reading</span></div>
        <label class="lnr-slider-label">Text size <b data-el="fontSizeValue"></b></label>
        <input class="lnr-range" data-el="fontSize" type="range" min="16" max="24" step="1" value="19">
        <div class="lnr-seg lnr-theme" data-el="themeSeg">
          <button type="button" data-theme="paper">Paper</button>
          <button type="button" data-theme="night">Night</button>
        </div>
      </section>
    </div>
  </header>

  <div class="lnr-scroll" data-el="scroll">
    <article class="lnr-article" data-el="article" dir="auto"></article>
  </div>

  <footer class="lnr-foot">
    <div data-el="footLeft">—</div>
    <div class="lnr-engine" data-el="footRight">Free browser voice</div>
  </footer>

  <div class="lnr-toast" data-el="toast" hidden></div>
</aside>`;

  const S = {
    open: false,
    starting: false,
    host: null,
    root: null,
    els: {},
    settings: { ...DEFAULTS },
    openaiKey: '',
    doc: null,
    segments: [],
    totalChars: 0,
    spans: new Map(),
    index: -1,
    playing: false,
    finished: false,
    activeSpan: null,
    wordSpan: null,
    wordIndex: null,
    wordStart: -1,
    wordEnd: -1,
    usage: { chars: 0, cost: 0 },
    toastTimer: null,
    voiceTimer: null
  };

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  chrome.storage.sync
    .get(DEFAULTS)
    .then((stored) => {
      S.settings = { ...DEFAULTS, ...stored };
      if (S.open) applySettings();
    })
    .catch(() => {});

  chrome.storage.local
    .get('openaiKey')
    .then((stored) => {
      S.openaiKey = stored.openaiKey || '';
      if (S.open) syncKeyUI();
    })
    .catch(() => {});

  try {
    speechSynthesis.addEventListener('voiceschanged', () => {
      if (S.open) fillVoices();
    });
  } catch {
    /* voices API unavailable */
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message.type !== 'string' || !message.type.startsWith('listnr:')) return;
    switch (message.type) {
      case 'listnr:toggle':
        toggleReader();
        break;
      case 'listnr:start-page':
        startReading('page');
        break;
      case 'listnr:start-selection':
        startReading('selection', message.selectionText);
        break;
      case 'listnr:next':
        if (S.open) sendCmd('next');
        break;
      case 'listnr:prev':
        if (S.open) sendCmd('prev');
        break;
      case 'listnr:close':
        closeReader();
        break;
      case 'listnr:stopped':
        closeReader({ silent: true, immediate: true });
        break;
      case 'listnr:event':
        onEngineEvent(message.event);
        break;
      default:
        break;
    }
  });

  window.addEventListener('pagehide', () => {
    if (S.open) chrome.runtime.sendMessage({ type: 'listnr:stop' }).catch(() => {});
  });

  /* ------------------------------------------------------------------ */
  /* Start / stop                                                        */
  /* ------------------------------------------------------------------ */

  function toggleReader() {
    if (!S.open) {
      startReading('page');
      return;
    }
    togglePlayback();
  }

  async function startReading(mode, selectionText) {
    if (S.starting) return;
    S.starting = true;
    try {
      if (S.open) teardown({ sendStop: true, animate: false });

      let extracted = null;
      try {
        extracted = mode === 'selection' ? extractSelection(selectionText) : extractPage();
      } catch (error) {
        console.warn('[LISTNR] Could not extract this page:', error);
      }

      if (!extracted || !extracted.segments.length) {
        pageToast('LISTNR couldn’t find readable text on this page.');
        return;
      }

      S.doc = extracted;
      S.segments = extracted.segments;
      S.totalChars = extracted.textLength;
      S.spans = new Map();
      S.index = -1;
      S.playing = true;
      S.finished = false;
      S.usage = { chars: 0, cost: 0 };
      S.activeSpan = null;
      S.wordSpan = null;
      S.wordIndex = null;
      S.wordStart = -1;
      S.wordEnd = -1;

      buildReader(extracted);
      if (extracted.truncated) {
        showToast('This page is very long — LISTNR is reading the first part.', 5000);
      }

      try {
        const result = await chrome.runtime.sendMessage({
          type: 'listnr:start',
          segments: extracted.segments.map((segment) => ({
            i: segment.i,
            p: segment.p,
            text: segment.text,
            kind: segment.kind
          })),
          meta: {
            title: extracted.title,
            url: location.href,
            totalChars: extracted.textLength
          }
        });
        if (result && result.ok === false) throw new Error(result.error || 'engine error');
      } catch (error) {
        S.playing = false;
        updatePlayButton();
        showToast('Couldn’t start the LISTNR engine. Reload the page and try again.', 6000);
        console.warn('[LISTNR] Engine start failed:', error);
      }
    } finally {
      S.starting = false;
    }
  }

  function closeReader(options = {}) {
    if (!S.open) return;
    teardown({ sendStop: !options.silent, animate: !options.immediate });
  }

  function teardown({ sendStop = true, animate = true } = {}) {
    S.open = false;
    hidePops();
    if (sendStop) chrome.runtime.sendMessage({ type: 'listnr:stop' }).catch(() => {});

    const host = S.host;
    S.host = null;
    S.root = null;
    S.els = {};
    S.doc = null;
    S.segments = [];
    S.totalChars = 0;
    S.spans = new Map();
    S.index = -1;
    S.playing = false;
    S.finished = false;
    S.activeSpan = null;
    S.wordSpan = null;
    S.wordIndex = null;
    S.wordStart = -1;
    S.wordEnd = -1;
    if (S.toastTimer) {
      clearTimeout(S.toastTimer);
      S.toastTimer = null;
    }

    if (!host) return;
    if (animate) {
      const reader = host.shadowRoot?.querySelector('.lnr-reader');
      if (reader) reader.classList.add('lnr-leaving');
      setTimeout(() => host.remove(), 210);
    } else {
      host.remove();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Reader UI                                                           */
  /* ------------------------------------------------------------------ */

  function buildReader(extracted) {
    const host = document.createElement('div');
    host.id = 'listnr-root';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });

    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      root.append(style);
    }

    root.innerHTML = HTML;

    const els = {};
    root.querySelectorAll('[data-el]').forEach((el) => {
      els[el.dataset.el] = el;
    });
    S.els = els;

    document.documentElement.append(host);
    S.host = host;
    S.root = root;
    S.open = true;

    els.title.textContent = extracted.title || 'Untitled page';
    const words = Math.max(1, Math.round(extracted.textLength / 5.9));
    const site = location.hostname ? location.hostname.replace(/^www\./, '') : 'Local page';
    els.meta.textContent = `${site} · ${words.toLocaleString()} words`;

    renderArticle(extracted);
    bindEvents();
    applySettings();
    updatePlayButton();
    updateFooter();
    setProgress(0);

    setTimeout(() => {
      if (S.open) els.reader.focus({ preventScroll: true });
    }, 30);
  }

  function renderArticle(extracted) {
    const fragment = document.createDocumentFragment();

    extracted.paragraphs.forEach((paragraph) => {
      const kind = paragraph.kind;
      const tag = /^h[1-6]$/.test(kind)
        ? kind
        : kind === 'code'
          ? 'pre'
          : kind === 'quote'
            ? 'blockquote'
            : 'p';
      const block = document.createElement(tag);
      block.className = 'lnr-block';
      block.dataset.kind = kind;

      paragraph.sentences.forEach((sentence, position) => {
        if (position > 0) block.append(' ');
        const span = document.createElement('span');
        span.className = 'lnr-s';
        span.dataset.i = String(sentence.index);
        span.textContent = sentence.text;
        span.title = 'Read from here';
        span.addEventListener('click', () => jumpTo(sentence.index));
        block.append(span);
        S.spans.set(sentence.index, span);
      });

      fragment.append(block);
    });

    S.els.article.append(fragment);
  }

  function bindEvents() {
    const els = S.els;

    els.close.addEventListener('click', () => closeReader());
    els.scrim.addEventListener('click', () => closeReader());
    els.play.addEventListener('click', togglePlayback);
    els.prev.addEventListener('click', () => sendCmd('prev'));
    els.next.addEventListener('click', () => sendCmd('next'));

    els.speedChip.addEventListener('click', () => togglePop('speed'));
    els.settingsBtn.addEventListener('click', () => togglePop('settings'));

    els.speedRange.addEventListener('input', () => {
      const rate = Number(els.speedRange.value);
      S.settings.rate = rate;
      renderRate(rate, { moveSlider: false });
      updateFooter();
    });
    els.speedRange.addEventListener('change', () => setRate(Number(els.speedRange.value)));

    SPEEDS.forEach((speed) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.speed = String(speed);
      button.textContent = formatRate(speed);
      button.addEventListener('click', () => setRate(speed));
      els.speedPresets.append(button);
    });

    els.engineSeg.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => selectEngine(button.dataset.engine));
    });

    els.voiceSelect.addEventListener('change', () => setVoice(els.voiceSelect.value));

    els.modelSelect.addEventListener('change', () => {
      S.settings.studioModel = els.modelSelect.value;
      saveSettings({ studioModel: S.settings.studioModel });
      sendCmd('reloadSettings');
    });

    els.studioVoice.addEventListener('change', () => {
      S.settings.studioVoice = els.studioVoice.value;
      saveSettings({ studioVoice: S.settings.studioVoice });
      sendCmd('reloadSettings');
    });

    els.keySave.addEventListener('click', saveKeyFromInput);
    els.keyInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveKeyFromInput();
      }
    });

    els.sentenceGap.addEventListener('input', () => {
      S.settings.sentenceGap = Number(els.sentenceGap.value);
      els.sentenceGapValue.textContent = `${S.settings.sentenceGap} ms`;
    });
    els.sentenceGap.addEventListener('change', () => {
      saveSettings({ sentenceGap: Number(els.sentenceGap.value) });
    });

    els.paragraphGap.addEventListener('input', () => {
      S.settings.paragraphGap = Number(els.paragraphGap.value);
      els.paragraphGapValue.textContent = `${S.settings.paragraphGap} ms`;
    });
    els.paragraphGap.addEventListener('change', () => {
      saveSettings({ paragraphGap: Number(els.paragraphGap.value) });
    });

    els.fontSize.addEventListener('input', () => {
      S.settings.fontSize = Number(els.fontSize.value);
      els.reader.style.setProperty('--read-size', `${S.settings.fontSize}px`);
      els.fontSizeValue.textContent = `${S.settings.fontSize}px`;
    });
    els.fontSize.addEventListener('change', () => {
      saveSettings({ fontSize: Number(els.fontSize.value) });
    });

    els.themeSeg.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => selectTheme(button.dataset.theme));
    });

    els.scroll.addEventListener('pointerdown', hidePops);

    S.root.addEventListener('keydown', handleReaderKeydown);
  }

  function handleReaderKeydown(event) {
    const target = event.target;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (event.key === 'Escape') {
        hidePops();
        target.blur();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      if (!S.els.speedPop.hidden || !S.els.settingsPop.hidden) hidePops();
      else closeReader();
    } else if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      sendCmd('next');
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      sendCmd('prev');
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setRate(S.settings.rate + 0.1);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      setRate(S.settings.rate - 0.1);
    }
  }

  function applySettings() {
    const els = S.els;
    if (!els.reader) return;

    els.reader.dataset.theme = S.settings.theme === 'night' ? 'night' : 'paper';
    els.reader.dataset.engine = S.settings.engine === 'studio' ? 'studio' : 'free';
    els.reader.style.setProperty('--read-size', `${S.settings.fontSize}px`);

    renderRate(S.settings.rate);
    els.sentenceGap.value = String(S.settings.sentenceGap);
    els.sentenceGapValue.textContent = `${S.settings.sentenceGap} ms`;
    els.paragraphGap.value = String(S.settings.paragraphGap);
    els.paragraphGapValue.textContent = `${S.settings.paragraphGap} ms`;
    els.fontSize.value = String(S.settings.fontSize);
    els.fontSizeValue.textContent = `${S.settings.fontSize}px`;
    els.modelSelect.value = S.settings.studioModel;

    fillStudioVoices();
    fillVoices();
    syncThemeUI();
    syncEngineUI();
    syncKeyUI();
    syncUsage();
  }

  function fillStudioVoices() {
    const select = S.els.studioVoice;
    if (!select) return;
    if (!select.options.length) {
      STUDIO_VOICES.forEach((voice) => {
        const option = document.createElement('option');
        option.value = voice;
        option.textContent = voice.charAt(0).toUpperCase() + voice.slice(1);
        select.append(option);
      });
    }
    select.value = S.settings.studioVoice;
  }

  function fillVoices() {
    const select = S.els.voiceSelect;
    if (!select) return;

    let voices = [];
    try {
      voices = speechSynthesis.getVoices() || [];
    } catch {
      voices = [];
    }

    if (!voices.length) {
      if (!S.voiceTimer) {
        S.voiceTimer = setTimeout(() => {
          S.voiceTimer = null;
          if (S.open) fillVoices();
        }, 600);
      }
      return;
    }

    const previous = S.settings.voiceURI;
    select.textContent = '';

    const auto = document.createElement('option');
    auto.value = '';
    auto.textContent = 'System default';
    select.append(auto);

    voices
      .slice()
      .sort((a, b) => (a.lang || '').localeCompare(b.lang || '') || (a.name || '').localeCompare(b.name || ''))
      .forEach((voice) => {
        const option = document.createElement('option');
        option.value = voice.voiceURI || voice.name;
        option.textContent = `${voice.name} — ${voice.lang}${voice.localService ? '' : ' · network'}`;
        select.append(option);
      });

    select.value = previous;
    if (select.value !== previous) select.value = '';
  }

  function syncEngineUI() {
    const els = S.els;
    if (!els.reader) return;
    const studio = S.settings.engine === 'studio';
    els.reader.dataset.engine = studio ? 'studio' : 'free';
    els.engineSeg.querySelectorAll('button').forEach((button) => {
      button.classList.toggle('is-on', button.dataset.engine === S.settings.engine);
    });
    els.freeSection.hidden = studio;
    els.engineHint.textContent = studio
      ? 'Studio sends this text to OpenAI and bills your API key.'
      : 'Free uses your computer’s built-in voices and costs nothing.';
    els.footRight.textContent = studio ? 'Studio voice · OpenAI' : 'Free browser voice';
  }

  function syncThemeUI() {
    if (!S.els.themeSeg) return;
    S.els.themeSeg.querySelectorAll('button').forEach((button) => {
      button.classList.toggle('is-on', button.dataset.theme === S.settings.theme);
    });
  }

  function syncKeyUI() {
    if (!S.els.keyInput) return;
    S.els.keyInput.value = S.openaiKey;
    S.els.keyHint.textContent = S.openaiKey
      ? 'Saved in this browser only. Clear the field and save to remove it.'
      : 'Stored in this browser only. Sent only to api.openai.com.';
  }

  function syncUsage() {
    if (!S.els.usageLine) return;
    const chars = S.usage.chars || 0;
    if (!chars) {
      S.els.usageLine.textContent = 'Studio audio: nothing yet this session.';
      return;
    }
    const cost = S.usage.cost || 0;
    S.els.usageLine.textContent = `Studio audio: ${chars.toLocaleString()} characters · ≈ $${cost.toFixed(3)} (estimate).`;
  }

  function renderRate(rate, { moveSlider = true } = {}) {
    const label = formatRate(rate);
    if (S.els.speedChip) S.els.speedChip.textContent = label;
    if (S.els.speedValue) S.els.speedValue.textContent = label;
    if (S.els.speedRange && moveSlider) S.els.speedRange.value = String(rate);
    if (S.els.speedPresets) {
      S.els.speedPresets.querySelectorAll('button').forEach((button) => {
        button.classList.toggle('is-on', Math.abs(Number(button.dataset.speed) - rate) < 0.001);
      });
    }
  }

  function setRate(value) {
    const rate = Math.min(3, Math.max(0.5, Math.round(Number(value) * 100) / 100));
    S.settings.rate = rate;
    renderRate(rate);
    saveSettings({ rate });
    sendCmd('setRate', { rate });
    updateFooter();
  }

  function setVoice(uri) {
    S.settings.voiceURI = uri || '';
    saveSettings({ voiceURI: S.settings.voiceURI });
    sendCmd('setVoice', { voiceURI: S.settings.voiceURI });
  }

  function selectEngine(engine) {
    const next = engine === 'studio' ? 'studio' : 'free';
    if (next === 'studio' && !S.openaiKey) {
      showToast('Add an OpenAI API key first.', 4000);
      if (S.els.keyInput) S.els.keyInput.focus();
      return;
    }
    if (S.settings.engine === next) {
      syncEngineUI();
      return;
    }
    S.settings.engine = next;
    saveSettings({ engine: next });
    syncEngineUI();
    sendCmd('setEngine', { engine: next });
  }

  function selectTheme(theme) {
    S.settings.theme = theme === 'night' ? 'night' : 'paper';
    S.els.reader.dataset.theme = S.settings.theme;
    saveSettings({ theme: S.settings.theme });
    syncThemeUI();
  }

  async function saveKeyFromInput() {
    const value = S.els.keyInput.value.trim();
    if (value && value.length < 20) {
      showToast('That doesn’t look like an API key.', 4000);
      return;
    }
    try {
      if (value) await chrome.storage.local.set({ openaiKey: value });
      else await chrome.storage.local.remove('openaiKey');
      S.openaiKey = value;
      syncKeyUI();
      sendCmd('reloadSettings');
      showToast(value ? 'Key saved locally.' : 'Key removed.');
      if (!value && S.settings.engine === 'studio') selectEngine('free');
    } catch {
      showToast('Couldn’t save the key in this browser.', 4000);
    }
  }

  function togglePop(which) {
    const speedOpen = which === 'speed' && S.els.speedPop.hidden;
    const settingsOpen = which === 'settings' && S.els.settingsPop.hidden;
    S.els.speedPop.hidden = !speedOpen;
    S.els.settingsPop.hidden = !settingsOpen;
    if (settingsOpen) {
      fillVoices();
      fillStudioVoices();
    }
  }

  function hidePops() {
    if (!S.els.speedPop) return;
    S.els.speedPop.hidden = true;
    S.els.settingsPop.hidden = true;
  }

  function updatePlayButton() {
    if (!S.els.play) return;
    S.els.play.innerHTML = S.playing ? ICON.pause : ICON.play;
    S.els.play.setAttribute(
      'aria-label',
      S.finished ? 'Play from start' : S.playing ? 'Pause' : 'Play'
    );
    if (S.els.reader) S.els.reader.classList.toggle('is-playing', S.playing);
  }

  function togglePlayback() {
    if (!S.open) return;
    if (S.finished) {
      S.finished = false;
      S.playing = true;
      updatePlayButton();
      sendCmd('play');
      return;
    }
    S.playing = !S.playing;
    updatePlayButton();
    sendCmd(S.playing ? 'resume' : 'pause');
  }

  function sendCmd(cmd, payload) {
    if (!S.open) return;
    chrome.runtime
      .sendMessage({ type: 'listnr:cmd', cmd, payload })
      .catch(() => {});
  }

  function saveSettings(patch) {
    S.settings = { ...S.settings, ...patch };
    chrome.storage.sync.set(patch).catch(() => {});
  }

  function showToast(message, duration = 4000) {
    const toast = S.els.toast;
    if (!toast || !message) return;
    toast.textContent = message;
    toast.hidden = false;
    if (S.toastTimer) clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(() => {
      toast.hidden = true;
      S.toastTimer = null;
    }, duration);
  }

  function pageToast(message) {
    const host = document.createElement('div');
    host.style.cssText =
      'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      root.append(style);
    }
    const toast = document.createElement('div');
    toast.className = 'lnr-page-toast';
    toast.textContent = message;
    root.append(toast);
    document.documentElement.append(host);
    setTimeout(() => host.remove(), 3600);
  }

  /* ------------------------------------------------------------------ */
  /* Playback events                                                     */
  /* ------------------------------------------------------------------ */

  function onEngineEvent(event) {
    if (!event || !S.open) return;

    switch (event.kind) {
      case 'state':
        S.playing = event.state === 'playing';
        updatePlayButton();
        break;

      case 'segment':
        S.finished = false;
        setActiveSegment(event.index, event.charOffset || 0);
        break;

      case 'boundary':
        if (event.index === S.index) {
          highlightWord(
            (event.baseOffset || 0) + (event.charIndex || 0),
            event.charLength || 0
          );
        }
        break;

      case 'finished':
        S.playing = false;
        S.finished = true;
        updatePlayButton();
        setProgress(1);
        if (S.els.footLeft) S.els.footLeft.textContent = 'Finished';
        break;

      case 'error':
        showToast(event.message || 'Playback error.', 6000);
        break;

      case 'notice':
        if (event.message) showToast(event.message, 5000);
        break;

      case 'usage':
        S.usage = { chars: event.chars || 0, cost: event.cost || 0 };
        syncUsage();
        break;

      case 'engine':
        S.settings.engine = event.engine === 'studio' ? 'studio' : 'free';
        syncEngineUI();
        break;

      case 'settings':
      case 'session':
        if (event.settings) {
          S.settings = { ...S.settings, ...event.settings };
          applySettings();
        }
        break;

      default:
        break;
    }
  }

  function setActiveSegment(index, _charOffset = 0) {
    if (index < 0 || index >= S.segments.length) return;

    if (index !== S.index) {
      clearWordHighlight();
      if (S.activeSpan) S.activeSpan.classList.remove('lnr-active');
      S.index = index;
      const span = S.spans.get(index);
      if (span) {
        span.classList.add('lnr-active');
        S.activeSpan = span;
        scrollToSpan(span);
      } else {
        S.activeSpan = null;
      }
    }

    const start = S.segments[index].startChar || 0;
    setProgress(S.totalChars ? start / S.totalChars : 0);
    updateFooter();
  }

  function clearWordHighlight() {
    if (S.wordSpan && S.wordIndex != null && S.segments[S.wordIndex]) {
      S.wordSpan.textContent = S.segments[S.wordIndex].text;
    }
    S.wordSpan = null;
    S.wordIndex = null;
    S.wordStart = -1;
    S.wordEnd = -1;
  }

  function highlightWord(start, length) {
    const index = S.index;
    if (index < 0) return;
    const segment = S.segments[index];
    const span = S.spans.get(index);
    if (!segment || !span) return;

    const text = segment.text;
    if (start < 0 || start >= text.length) return;

    const end = Math.min(text.length, start + Math.max(1, length || 1));
    if (start === S.wordStart && end === S.wordEnd) return;

    S.wordStart = start;
    S.wordEnd = end;
    S.wordIndex = index;
    S.wordSpan = span;

    span.textContent = '';
    if (start > 0) span.append(text.slice(0, start));
    const word = document.createElement('span');
    word.className = 'lnr-word';
    word.textContent = text.slice(start, end);
    span.append(word);
    if (end < text.length) span.append(text.slice(end));
  }

  function scrollToSpan(span) {
    const scroller = S.els.scroll;
    if (!scroller || !span) return;
    const rect = span.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (rect.top < view.top + 36 || rect.bottom > view.bottom - 48) {
      span.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function jumpTo(index) {
    if (!S.open) return;
    setActiveSegment(index, 0);
    sendCmd('seek', { index });
  }

  function setProgress(fraction) {
    if (!S.els.progressBar) return;
    const value = Math.max(0, Math.min(1, Number(fraction) || 0));
    S.els.progressBar.style.width = `${value * 100}%`;
  }

  function updateFooter() {
    const foot = S.els.footLeft;
    if (!foot) return;
    if (S.finished) {
      foot.textContent = 'Finished';
      return;
    }
    if (!S.segments.length) {
      foot.textContent = '—';
      return;
    }
    const index = Math.max(0, S.index);
    const start = S.segments[index]?.startChar || 0;
    const percent = S.totalChars ? Math.min(100, Math.round((start / S.totalChars) * 100)) : 0;
    foot.textContent = `${percent}% · ${formatDuration(estimateRemaining(index))} left`;
  }

  function estimateRemaining(index) {
    const start = S.segments[index]?.startChar || 0;
    const remainingChars = Math.max(0, S.totalChars - start);
    const rate = Math.max(0.5, S.settings.rate);
    const speechSeconds = remainingChars / (14.5 * rate);
    const remainingSegments = Math.max(0, S.segments.length - index);
    const gapSeconds =
      (remainingSegments * S.settings.sentenceGap +
        Math.ceil(remainingSegments / 6) * S.settings.paragraphGap) /
      1000;
    return speechSeconds + gapSeconds / Math.max(1, rate);
  }

  /* ------------------------------------------------------------------ */
  /* Extraction                                                          */
  /* ------------------------------------------------------------------ */

  const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption';
  const REMOVE_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe',
    'video', 'audio', 'object', 'embed', 'form', 'button', 'input',
    'select', 'textarea', 'nav', 'aside',
    '[aria-hidden="true"]', '[hidden]',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]'
  ].join(',');
  const JUNK_SIGNATURE = /(^|[\s_-])(nav|navbar|menu|footer|sidebar|aside|comment|comments|share|social|related|promo|advert|advertisement|ads?|cookie|cookies|banner|subscribe|newsletter|breadcrumb|pagination|modal|popup|toolbar|masthead|paywall|login|signup|search)([\s_-]|$)/i;
  const BOILERPLATE = /^(advertisement|sponsored|subscribe( now)?|sign in|log in|share( this)?|menu|skip to (content|main content)|accept( all)? cookies?|cookie settings|read more|related( articles)?|comments?|loading(…|\.\.\.)?)$/i;

  let sentenceSegmenter = null;
  try {
    sentenceSegmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  } catch {
    sentenceSegmenter = null;
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/[​-‍﻿]/g, '')
      .replace(/ /g, ' ')
      .replace(/[ \t\r\f\v]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function rawBlockText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
    return cleanText(clone.textContent || '');
  }

  function kindOf(el) {
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return tag;
    if (tag === 'li') return 'li';
    if (tag === 'blockquote') return 'quote';
    if (tag === 'pre') return 'code';
    if (tag === 'figcaption') return 'caption';
    return 'p';
  }

  function cleanClone(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll(REMOVE_SELECTOR).forEach((node) => node.remove());
    clone.querySelectorAll('[class],[id]').forEach((node) => {
      const signature = `${node.getAttribute('class') || ''} ${node.id || ''}`;
      if (!JUNK_SIGNATURE.test(signature)) return;
      if (node.querySelectorAll('p').length >= 2) return;
      if ((node.textContent || '').length > 2000) return;
      node.remove();
    });
    return clone;
  }

  function blocksFrom(root) {
    const blocks = [];
    const seen = new Set();

    root.querySelectorAll(BLOCK_SELECTOR).forEach((el) => {
      if (el.querySelector(BLOCK_SELECTOR)) return;
      if (el.closest('[aria-hidden="true"],[hidden]')) return;

      const text = rawBlockText(el);
      if (!text || text.length < 2 || BOILERPLATE.test(text)) return;

      const kind = kindOf(el);
      if (
        text.length < 18 &&
        kind === 'p' &&
        !el.closest('li') &&
        !/[.!?…:;”"’]$/.test(text)
      ) {
        return;
      }

      const key = text.slice(0, 180).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      blocks.push({ kind, text });
    });

    return blocks;
  }

  function pickRoot() {
    const candidates = new Set([document.body]);
    const selector =
      'article,main,[role="main"],[itemprop="articleBody"],.post-content,.entry-content,.article-body,.article__body,#article,#content,.content,.post,.story';
    document.querySelectorAll(selector).forEach((el) => candidates.add(el));

    let best = document.body;
    let bestScore = -1;

    candidates.forEach((el) => {
      if (!el || !el.isConnected) return;
      const textLength = (el.textContent || '').length;
      if (textLength < 250) return;

      const paragraphs = el.querySelectorAll('p').length;
      let linkLength = 0;
      el.querySelectorAll('a').forEach((link) => {
        linkLength += (link.textContent || '').length;
      });
      const linkDensity = Math.min(0.95, linkLength / Math.max(1, textLength));

      let score = textLength * (1 - linkDensity * 1.6) + paragraphs * 180;
      if (el.tagName === 'ARTICLE') score *= 1.25;
      if (el.tagName === 'MAIN' || el.getAttribute('role') === 'main') score *= 1.12;
      if (el === document.body) score *= 0.85;
      if (paragraphs < 2) score *= 0.6;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    });

    return best || document.body;
  }

  function pickTitle(blocks) {
    const heading = blocks.find(
      (block) => /^h[1-2]$/.test(block.kind) && block.text.length >= 3 && block.text.length <= 180
    );
    if (heading) return heading.text;

    const meta = document
      .querySelector('meta[property="og:title"]')
      ?.getAttribute('content');
    if (meta) return cleanText(meta);

    return cleanText(document.title || '') || 'Untitled page';
  }

  function paragraphsFromPlainText(value) {
    const text = String(value || '');
    if (!text.trim()) return [];

    const lines = text.split(/\n+/).map(cleanText).filter(Boolean);
    if (lines.length <= 1) return [{ kind: 'p', text: cleanText(text) }];

    const paragraphs = [];
    let buffer = '';
    for (const line of lines) {
      if (buffer && buffer.length + line.length > 500) {
        paragraphs.push({ kind: 'p', text: buffer });
        buffer = '';
      }
      buffer = buffer ? `${buffer} ${line}` : line;
    }
    if (buffer) paragraphs.push({ kind: 'p', text: buffer });
    return paragraphs;
  }

  function extractPage() {
    const root = pickRoot();
    let blocks = blocksFrom(cleanClone(root));
    let blockChars = blocks.reduce((sum, block) => sum + block.text.length, 0);

    if (blockChars < 400) {
      const fallback = blocksFrom(cleanClone(document.body));
      const fallbackChars = fallback.reduce((sum, block) => sum + block.text.length, 0);
      if (fallbackChars > blockChars) {
        blocks = fallback;
        blockChars = fallbackChars;
      }
    }

    if (!blocks.length) {
      blocks = paragraphsFromPlainText(document.body?.innerText || document.body?.textContent || '');
    }

    const title = pickTitle(blocks);
    blocks = trimLeadingChrome(blocks, title);

    const parsed = groupSentences(blocks);
    if (!parsed.segments.length) return null;

    return { title, ...parsed };
  }

  function normalizeTitle(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  function isByline(block) {
    if (block.kind !== 'p' || block.text.length > 140) return false;
    return (
      /^(by|written by|words by|posted by|published|updated|last updated)\b/i.test(block.text) ||
      /\b\d+\s*min(?:ute)?s?\s+read\b/i.test(block.text)
    );
  }

  function trimLeadingChrome(blocks, title) {
    const cleaned = blocks.slice();
    if (
      cleaned.length &&
      /^h[1-3]$/.test(cleaned[0].kind) &&
      normalizeTitle(cleaned[0].text) === normalizeTitle(title)
    ) {
      cleaned.shift();
    }
    while (cleaned.length && isByline(cleaned[0])) cleaned.shift();
    return cleaned.length ? cleaned : blocks;
  }

  function extractSelection(selectionText) {
    let blocks = [];
    const selection = window.getSelection();

    if (selection && selection.rangeCount && !selection.isCollapsed) {
      try {
        const container = document.createElement('div');
        container.appendChild(selection.getRangeAt(0).cloneContents());
        blocks = blocksFrom(container);
      } catch {
        blocks = [];
      }
    }

    if (!blocks.length) {
      const raw =
        String(selectionText || '').trim() || (window.getSelection()?.toString() || '');
      blocks = paragraphsFromPlainText(raw);
    }

    const parsed = groupSentences(blocks);
    if (!parsed.segments.length) return null;

    return { title: 'Selected text', ...parsed };
  }

  function splitSentences(value) {
    const text = cleanText(value);
    if (!text) return [];

    let pieces;
    if (sentenceSegmenter) {
      pieces = Array.from(sentenceSegmenter.segment(text), (entry) => entry.segment.trim());
    } else {
      pieces = (text.match(/[^.!?…]+[.!?…]+["'”’)\]]*|[^.!?…]+$/g) || [text]).map((piece) =>
        piece.trim()
      );
    }

    const merged = [];
    for (const piece of pieces) {
      if (!piece) continue;
      if (merged.length && piece.length < 3) merged[merged.length - 1] += ` ${piece}`;
      else merged.push(piece);
    }

    const final = [];
    for (const piece of merged) {
      if (piece.length <= 700) {
        final.push(piece);
        continue;
      }
      let rest = piece;
      while (rest.length > 700) {
        let cut = rest.lastIndexOf(' ', 600);
        if (cut < 200) cut = 600;
        final.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) final.push(rest);
    }

    return final.filter(Boolean);
  }

  function groupSentences(blocks) {
    const paragraphs = [];
    const segments = [];
    let charCount = 0;
    let paragraphIndex = 0;
    let truncated = false;

    outer: for (const block of blocks) {
      const sentences = splitSentences(block.text);
      if (!sentences.length) continue;

      const paragraph = { kind: block.kind, sentences: [] };
      for (const sentenceText of sentences) {
        if (segments.length >= MAX_SEGMENTS || charCount + sentenceText.length > MAX_CHARS) {
          truncated = true;
          break outer;
        }
        const segment = {
          i: segments.length,
          p: paragraphIndex,
          kind: block.kind,
          text: sentenceText,
          startChar: charCount
        };
        segments.push(segment);
        paragraph.sentences.push({ index: segment.i, text: sentenceText });
        charCount += sentenceText.length + 1;
      }

      if (paragraph.sentences.length) {
        paragraphs.push(paragraph);
        paragraphIndex += 1;
      }
    }

    return { paragraphs, segments, textLength: charCount, truncated };
  }

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function formatRate(rate) {
    return `${Number(rate).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}×`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0 sec';
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`;
    if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return `${hours} hr ${minutes} min`;
  }
})();
