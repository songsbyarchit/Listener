# Installing LISTNR

LISTNR has two moving parts:

1. **The Chrome extension** — the toolbar popup for playback settings and the in-page player. It lives in this repo and talks only to `127.0.0.1`.
2. **The local server** — Express + SQLite + document parsers + the voice bridge. It talks to your own Kokoro-FastAPI server.

There are no accounts, analytics, or cloud storage. Local Kokoro is the default and needs no key. Hosted voices are optional and configured through the server environment in this version (there is no separate settings app).

---

## Which install should I use?

| Option | Best for | Download / disk | Voice server |
| --- | --- | --- | --- |
| **A. Docker Compose** | One command, no Node setup | Docker images (large, pulled once) + 82 MB model | Included |
| **B. Node + Kokoro Docker** | Development / smaller download | Node deps ~226 MB installed + 82 MB model | Separate Docker container |
| **C. GitHub Release zips** | Non-git users | Extension <1 MB + server source <1 MB + Node deps | You still need Kokoro |

The **extension itself is under 1 MB**. The “80 MB” people associate with local voices is the shared **Kokoro-82M model (82.05 MB, q8f16)**. Every voice is only **0.5 MB**; the four starter voices add about **2 MB**, not 50–80 MB. All 54 voices together are about 27 MB.

---

## A. Docker Compose (recommended)

Requirements: Docker Desktop, Chrome.

```bash
git clone https://github.com/songsbyarchit/Listener.git
cd Listener
docker compose up -d --build
```

Load the extension (there is no separate web page in this version):

1. `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this `Listener` folder
4. Pin LISTNR and click the toolbar icon

The Compose stack starts:

- `listnr` on `127.0.0.1:8787` (the host mapping is loopback-only)
- `kokoro` internally on `http://kokoro:8880/v1`

The first spoken sentence is slower while Kokoro loads the model. Data lives in `./data` on the host.

Stop with:

```bash
docker compose down
```

### Apple Silicon note

The Kokoro CPU image may be published for amd64 only. If the pull or run fails, uncomment this line in `docker-compose.yml`:

```yaml
# platform: linux/amd64
```

Docker will emulate it, which is slower. A native Kokoro install is faster if you have one.

---

## B. Node + Kokoro Docker

Requirements: Node.js **22 or newer**, Docker (for the voice server), Chrome.

```bash
cd Listener
npm ci
```

Terminal 1 — local voice server:

```bash
docker run --rm -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

Terminal 2 — LISTNR:

```bash
npm start
```

Then load this folder at `chrome://extensions` and click the LISTNR toolbar icon.

Optional: if you already run a Kokoro/OpenAI-compatible TTS server elsewhere, point LISTNR at it:

```bash
TTS_BASE_URL=http://127.0.0.1:8880/v1 npm start
```

No API key is required for a local endpoint. The app sends sentence-sized text to that endpoint and caches returned audio under `data/audio`. Hosted providers are covered in [Connecting a hosted voice](#connecting-a-hosted-voice-optional).

---

## C. GitHub Release zips

On the repository’s **Releases** page:

- `listnr-extension-<version>.zip` — unzip it anywhere and load the unzipped folder as an unpacked extension.
- `listnr-server-<version>.zip` — unzip, then:
  ```bash
  npm ci
  npm start
  ```
- `listnr-source-<version>.zip` — the whole repository without `node_modules` or data.
- `SHA256SUMS` — checksums for all archives.

The server archive still needs a Kokoro-FastAPI instance (Docker command above). The extension does not include a voice model.

Prebuilt server images may also be published from tagged releases:

```bash
docker login ghcr.io
docker run --rm -p 127.0.0.1:8787:8787 \
  -v "$PWD/data:/data" \
  -e TTS_BASE_URL=http://host.docker.internal:8880/v1 \
  ghcr.io/songsbyarchit/listnr:latest
```

The image is private while the repository is private; authenticate with a GitHub token that has `read:packages`.

---

## Reading the page you're on

After loading or reloading the extension, **reload any tabs that were already open** once so the content script can attach.

On readable `http(s)` pages you will see a small **Listen** pill, initially at the bottom middle:

- **Drag the pill** (grab the pill, not the ×). It snaps to the **left edge**, **right edge**, or **bottom edge**, and remembers that choice across pages and reloads.
- Click **Listen** to capture the current page DOM. It plays **inside the page** in a LISTNR panel — the page stays open and the current sentence is highlighted on the page. The player opens where you last left it; drag its header to move it anywhere on the page, and drag its edges or corners to resize it.
- **Alt+Shift+L** (Option+Shift+L on macOS) does the same from the keyboard, and the toolbar popup has a **Read this page** button.
- The panel has play/pause, previous/next sentence, stop, speed, voice, volume, and sentence/paragraph pauses.
- The **Snap player** control in the panel settings moves the player back to the **Left**, **Bottom**, or **Right** edge.
- **Minimize** keeps playback and highlighting running; the pill shows **Playing** and returns to its snapped edge.
- The captured page is saved server-side as a document, so its reading position and cached audio survive reloads. The pill's × hides LISTNR for that tab.
- “Follow highlighted text” scrolls the page when the current sentence would be off-screen or behind the panel; turn it off in the panel settings or the toolbar popup if you’d rather control scrolling yourself.
- Very short pages, `chrome://` pages, the Web Store, and Chrome's PDF viewer do not get a pill.

## Choosing voices

Open the LISTNR **toolbar popup** and pick a voice from the **Voice** menu. The same setting is available under the gear icon in the in-page player; the two stay in sync and apply to every page you listen to.

- The list comes from your local server (`/api/voices`).
- If the server is offline, the popup falls back to the built-in Kokoro starter voices.
- The voice is remembered in `chrome.storage.local`, so it survives reloads and applies to new pages.

All voices share the same model. There is no per-voice model download in LISTNR, so adding voices is effectively free in size (0.5 MB per `.bin` in the Kokoro installation).

Suggested starting points:

| Voice | Character |
| --- | --- |
| `af_heart` | Warm US female; the default |
| `af_bella` | Bright US female |
| `am_michael` | Calm US male |
| `bf_emma` | UK female |
| `bm_george` | UK male |

<!-- -->

## Connecting a hosted voice (optional)

This version has no separate settings app, so a hosted provider is configured through the server environment. Stop the server and start it with the provider’s values:

```bash
TTS_PROVIDER=elevenlabs \
TTS_API_KEY=your-key \
TTS_BASE_URL=https://api.elevenlabs.io \
TTS_MODEL=eleven_flash_v2_5 \
npm start
```

`TTS_PROVIDER` accepts `kokoro`, `elevenlabs`, `openai`, or `custom`. The popup’s voice menu then lists that provider’s voices.

Notes:

- The key is only sent to the provider origin it was configured for. Keep it out of shell history if that matters (`env` files or Docker secrets work too).
- With a hosted provider, the text you listen to is sent to that provider. For ElevenLabs, LISTNR sends the sentence plus the surrounding paragraph as `previous_text`/`next_text` for continuity, with `enable_logging=false` so the text is not retained in ElevenLabs history.
- Cache files under `data/audio/` are keyed by provider, voice, and text, so switching providers never serves the wrong audio.
- Back to free: restart with `TTS_PROVIDER=kokoro` and no key.
- Costs: roughly 56k characters ≈ 1 hour of audio. See the cost table in [README.md](README.md#use-a-hosted-voice-optional).

---

## Data, backup, and deletion

Default data directory: **`./data/`** (or `/data` in Docker).

| Path | Contents |
| --- | --- |
| `data/listnr.db` | Documents, extracted text, reading position, settings, voice-provider selection, **API key if you saved one**, audio-cache index |
| `data/uploads/` | Original imported files |
| `data/audio/` | Cached speech, shared across documents by provider+text+voice |
| `data/tessdata/` | Tesseract language cache |

**Backup:** stop the server, then copy the whole `data/` directory. SQLite runs in WAL mode; a live copy can be inconsistent, so stop first. **A backup of `data/` includes your TTS API key if one is saved** — store it accordingly.

**Delete:** there is no library window in this version, so remove documents by deleting their rows from `data/listnr.db` while the server is stopped (or erase everything by removing `data/`). Cached speech files are shared and may remain until pruned.

Audio cache limit: `AUDIO_CACHE_MAX_MB` (default 1024). It is pruned least-recently-used on writes.

Override the data location:

```bash
LISTNR_DATA_DIR=/path/to/listnr-data npm start
```

---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Server bind address. Compose sets `0.0.0.0` inside the container and publishes only loopback on the host. |
| `PORT` | `8787` | Local server port. The extension expects 8787. |
| `LISTNR_DATA_DIR` | `./data` | SQLite, uploads, audio cache, OCR cache. |
| `TTS_PROVIDER` | `kokoro` | `kokoro`, `elevenlabs`, `openai`, or `custom`. |
| `TTS_BASE_URL` | `http://127.0.0.1:8880/v1` | OpenAI-compatible endpoint (ignored for ElevenLabs unless overridden). |
| `TTS_MODEL` | `kokoro` | Model name sent to the endpoint (`gpt-4o-mini-tts`, `eleven_flash_v2_5`, …). |
| `TTS_VOICE` | `af_heart` | Default voice for new documents. |
| `TTS_API_KEY` | *(none)* | Optional key for a hosted provider. |
| `TTS_FORMAT` | `mp3` | Requested audio format. |
| `TTS_TIMEOUT_MS` | `45000` | Per-sentence synthesis timeout. |
| `TTS_VOICES` | curated list | Comma-separated `id` or `id:Label` fallback voices. |
| `MAX_UPLOAD_MB` | `30` | Upload limit. |
| `MAX_URL_MB` | `8` | URL-import response limit. |
| `AUDIO_CACHE_MAX_MB` | `1024` | Speech-cache disk budget. |

The extension is hard-wired to `http://127.0.0.1:8787`; if you change `PORT`, update `SERVER_URL` in `extension/background.js` and `ui/popup.js`.

---

## Tests

```bash
npm ci
npm test
```

The suite covers every parser (HTML, Markdown, plain text, PDF, EPUB, and real Tesseract OCR on a PNG fixture), normalization, reading-position persistence, private-network URL blocking and redirects, voice preview/defaults, upload rejection, and an E2E import → audio → saved-position → restart/resume flow.

Individual test files:

```bash
node --test tests/parsers.test.js
node --test tests/ssrf.test.js
node --test tests/position.test.js
node --test tests/e2e.test.js
```

---

## Troubleshooting

**“Voice server offline”**
```bash
curl http://127.0.0.1:8880/v1/voices
docker run --rm -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```
The first request may take 10–60 seconds on CPU while the model loads. LISTNR prefetches the next sentence to reduce gaps.

**“Local server offline” in the extension**
- Is `npm start` or `docker compose up` running?
- Does `curl http://127.0.0.1:8787/api/health` work?
- Reload the extension after starting the server.

**Chrome extension does nothing**
- Load the repository folder (with `manifest.json` at the root), not `ui/`.
- The extension can only reach localhost; that is intentional.

**The Listen pill is missing**
- Reload the extension at `chrome://extensions`, then reload the page once.
- Very short pages do not show it. `chrome://` pages, the Web Store, and Chrome's PDF viewer cannot run content scripts.
- If you closed it with ×, reopen the tab or reload; the hide flag is per tab/session.

**PDF has no text**
Scanned PDFs contain images, not text. Export the pages as PNG/JPEG and import those for OCR, or use a PDF with an OCR text layer.

**OCR is slow the first time**
Tesseract loads local language data (`data/tessdata`). Subsequent images reuse it.

**Apple Silicon / Kokoro**
Try the native Kokoro-FastAPI setup, or enable the `platform: linux/amd64` line in Compose and expect slower synthesis.

**URL import refuses a site**
Private, loopback, link-local, and local hostnames are blocked on purpose, including redirect targets. Only public `http(s)` pages are fetched.

---

## Security model

- Server binds `127.0.0.1` unless the container sets `HOST=0.0.0.0`; Compose publishes only `127.0.0.1:8787` on the host.
- No authentication by design (single-user local tool). Do not expose the port publicly.
- URL imports validate every redirect, resolve DNS, block private ranges, and pin the connection to the validated address to reduce DNS-rebinding risk.
- Uploaded files get generated UUID names; original names are sanitized for display only.
- By default the only outbound HTTP requests are URL imports you explicitly request; voice, text, and audio stay local.
- If you connect a hosted voice provider, speech requests go to that provider and carry only the sentence being read (plus paragraph context for ElevenLabs). Your library, uploads, and positions are never sent.
- A saved API key lives in `data/listnr.db` at `0600`, is never returned by the API, and is attached only to requests sent to the origin it was saved for. Changing the provider or base URL deletes it. Backups of `data/` include it.
- Changing the voice service does not require exposing the server; the browser still talks only to `127.0.0.1`.
