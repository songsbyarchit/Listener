# LISTNR

**Listener** — a small, local-first Speechify alternative for Chrome.

LISTNR turns any web page (or a selection) into audio in a side drawer with sentence-level highlighting, click-to-jump, adjustable speed, and *intentional* pauses between sentences and paragraphs. It runs two ways:

| Engine | What it uses | Cost | Setup |
| --- | --- | --- | --- |
| **Free browser** | Your computer's built-in voices (`speechSynthesis`) | **$0** | None |
| **Studio** | OpenAI's speech API | Roughly **$0.015/min**, billed to your own key | Paste an OpenAI key |

No account, no subscription, no analytics server. One reading session at a time.

> Status: `v0.1.0` — an unpacked developer build, not on the Chrome Web Store.

---

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (`Listener/`).
4. Pin LISTNR from the puzzle-piece menu.
5. Reload any tabs that were already open before installing.

For local `file://` pages, open the extension's **Details** and enable **Allow access to file URLs**.

## Use

- **Click the toolbar icon** (or press `Alt+Shift+P`) to start reading the page. Click again to pause/resume.
- **Click any sentence** in the drawer to jump there.
- **Select text → right-click → “Read selection with LISTNR”** to read only the selection.
- **Speed chip** opens a slider and presets (0.5×–3×). Speed changes apply mid-sentence; the voice picks up from the last word.
- **Settings (sliders icon)** controls pause lengths, browser voice, text size, theme, and the optional Studio engine.

### Shortcuts

| Action | Shortcut |
| --- | --- |
| Read / pause | `Alt+Shift+P` |
| Next sentence | `Alt+Shift+N` |
| Previous sentence | `Alt+Shift+B` |
| Close reader | `Alt+Shift+X` |
| Play/pause (reader focused) | `Space` |
| Skip sentence (reader focused) | `←` / `→` |
| Faster / slower | `+` / `−` |
| Close / dismiss panel | `Esc` |

Chrome lets you rebind these at `chrome://extensions/shortcuts`.

### What it reads

A lightweight readability pass picks the main article container, strips nav/ads/comments/cookie banners, and keeps headings, paragraphs, lists, quotes, captions, and code. If it cannot find structure, it falls back to the visible text. Pages are capped at 140,000 characters / 4,000 sentences per session.

---

## Cost: is an API cheaper than a subscription?

A useful unit is **1,000 words ≈ 6,000 characters ≈ 6.5 minutes** of speech at 155 wpm.

### Per 1,000-word chunk

| Option | Cost per chunk | Cost per minute | Notes |
| --- | --- | --- | --- |
| **LISTNR free browser voice** | **$0.00** | **$0.00** | System voices; quality varies by OS |
| OpenAI `tts-1` | ~$0.09 | ~$0.014 | 9 voices, fast, no style instructions |
| OpenAI `gpt-4o-mini-tts` | ~$0.10 | ~$0.015 | 13 voices, best OpenAI pacing; supports style instructions |
| OpenAI `tts-1-hd` | ~$0.18 | ~$0.030 | Higher-fidelity audio |
| ElevenLabs Flash v2.5 | ~$0.24 | ~$0.04 | Very natural, low latency |
| ElevenLabs Multilingual v2/v3 | ~$0.48 | ~$0.08 | Highest quality tier |
| **Speechify Premium** | — | — | **$139/year** (~$11.58/mo), premium voices, mobile apps, OCR |

Prices checked **23 November 2026** from third-party pricing trackers; verify on the providers' own pages before committing. OpenAI character rates: [$15/1M for `tts-1`, $30/1M for `tts-1-hd`](https://texttolab.com/blog/openai-tts-pricing); `gpt-4o-mini-tts` is token-billed and works out to [roughly $15.92/1M characters in a measured test](https://www.dograh.com/hub/blogs/openai-tts-pricing) (~[$20/1M under other token assumptions](https://costgoat.com/pricing/openai-tts)). ElevenLabs Flash v2.5 is [$0.04/1k characters](https://benchlm.ai/elevenlabs/pricing). Speechify Premium is [$139/year](https://costbench.com/software/ai-voice-tools/speechify/).

### Break-even against Speechify Premium ($139/year)

This is the daily listening time at which raw API spend equals the subscription:

| Engine | Break-even listening | Cheaper if you listen… |
| --- | --- | --- |
| OpenAI `tts-1` | ~27 min/day | less than ~27 min/day |
| OpenAI `gpt-4o-mini-tts` | ~27 min/day | less than ~27 min/day |
| OpenAI `tts-1-hd` | ~14 min/day | less than ~14 min/day |
| ElevenLabs Flash v2.5 | ~11 min/day | less than ~11 min/day |
| ElevenLabs Multilingual v2/v3 | ~5 min/day | less than ~5 min/day |
| **Browser voice** | **never** | always free |

So the honest answer: **for a casual listener, API credits are much cheaper than a membership; for a heavy listener, Speechify's flat annual fee wins on raw dollars.** At ~30 minutes a day, OpenAI's cheapest voices cost about the same as Speechify Premium. ElevenLabs-quality voices only make financial sense below ~10 minutes a day.

LISTNR's Studio engine defaults to `gpt-4o-mini-tts`; its settings show an in-session character count and estimated spend based on the rates above. The free engine has no marginal cost at all, so if it sounds acceptable to you, this whole calculation disappears.

**Caveats**

- Some sources report that OpenAI plans to retire `tts-1`, `tts-1-hd`, and `gpt-4o-mini-tts` from the API on **6 January 2027**. Check the current API docs/models list before relying on them long-term; the engine is provider-isolated so a newer speech model can be swapped in one place (`offscreen.js`).
- Speechify's price includes things this extension does not: mobile/desktop apps, OCR for scanned PDFs, audiobooks, and premium voice catalogs. LISTNR is a page reader, not a full platform.
- API usage is metered per character synthesized, including prefetched paragraphs you skip. LISTNR prefetches one paragraph ahead, so a fast skip can synthesize a little unused audio.
- You pay your own API bill; there is no markup, account, or server in the middle.

---

## How it works

```text
toolbar click / shortcut / context menu
                │
                ▼
        content.js  ── extract article · render drawer · highlight words
                │        (commands ↑, segments ↓, events ↑)
                ▼
        background.js  ── stateless router; remembers the active tab
                │
                ▼
        offscreen.js  ── audio engine (offscreen document)
                ├── free:   speechSynthesis, one sentence per utterance,
                │           exact configurable gaps between sentences/paragraphs
                └── studio: OpenAI /v1/audio/speech, paragraph-sized requests,
                            1-group prefetch, playbackRate speed, estimated
                            sentence timing for highlighting
```

- **Pauses** are real silence scheduled between utterances, not punctuation guesses. Defaults: 160 ms between sentences, 600 ms between paragraphs, plus extra around headings. Gaps shorten automatically at faster speeds.
- **Highlighting** uses word-boundary events from the browser voice. Studio audio has no word timestamps, so sentence highlighting is interpolated from character counts (approximate, but close).
- **Speed** restarts the current sentence at the new rate for browser voices; Studio changes `playbackRate` live without re-synthesizing.
- **Persistence**: preferences use `chrome.storage.sync`; the OpenAI key uses `chrome.storage.local` and never leaves the browser except in a direct request to `api.openai.com`.

## Privacy

- No analytics, telemetry, accounts, or LISTNR servers.
- With the free engine, text stays local (your OS's speech engine may use installed voices; behaviour depends on the voices Chrome exposes).
- With Studio, the text of each spoken paragraph, your chosen voice/model, and your API key are sent directly to `https://api.openai.com/v1/audio/speech`. Nothing passes through any other server.
- The key is stored unencrypted in Chrome's extension storage, which is normal for bring-your-own-key extensions but worth knowing on a shared machine.

## Known limits

- Chrome's PDF viewer, `chrome://` pages, and the Web Store cannot host content scripts. Download PDFs or use a PDF-to-HTML viewer.
- Pages behind a login, paywalls, or heavy client-side rendering may extract poorly — select the text and use “Read selection” instead.
- One active reading session at a time; starting in another tab stops the first.
- No OCR, no EPUB/PDF parsing, no mobile app, no cross-device position sync.
- Browser-voice quality depends on installed OS voices. On macOS, install Premium/Enhanced voices in **System Settings → Accessibility → Spoken Content** for a big upgrade.
- Some sites' voices emit no word-boundary events; highlighting then falls back to sentence-level.

## Roadmap ideas

- Local neural TTS (Kokoro/Piper via WASM) for ElevenLabs-adjacent quality at $0 marginal cost.
- PDF/EPUB ingestion.
- Word-level timestamps for Studio via a provider that exposes them (ElevenLabs, Google, Azure).
- Reader position sync across devices.
- Optional in-page highlighting (instead of the drawer).

## Development

No build step, no package manager, no dependencies. Edit a file and hit **Reload** on `chrome://extensions`.

```text
manifest.json     MV3 manifest
background.js     service worker: routing, context menus, commands, session lifecycle
offscreen.html    hidden audio-engine document
offscreen.js      speech queue, pause/gap scheduling, OpenAI TTS + prefetch
content.js        extraction, shadow-DOM reader UI, highlighting, controls
icons/            generated PNGs
tools/make-icons.py   dependency-free icon generator
```

Regenerate icons:

```bash
python3 -I tools/make-icons.py
```

Syntax-check the JavaScript (Node 18+):

```bash
node --check background.js && node --check offscreen.js && node --check content.js
```

## License

No license has been chosen yet. Treat it as all rights reserved until one is added.
