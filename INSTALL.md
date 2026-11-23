# Installing LISTNR

LISTNR has two moving parts:

1. **The Chrome extension** — the library and reader UI. It lives in this repo and talks only to `127.0.0.1`.
2. **The local server** — Express + SQLite + document parsers + the voice bridge. It talks to your own Kokoro-FastAPI server.

There are no accounts, API keys, hosted voices, analytics, or cloud storage.

---

## Which install should I use?

| Option | Best for | Download / disk | Voice server |
| --- | --- | --- | --- |
| **A. Docker Compose** | One command, no Node setup | Docker images (large, pulled once) + 82 MB model | Included |
| **B. Node + Kokoro Docker** | Development / smaller download | Node deps ~226 MB installed + 82 MB model | Separate Docker container |
| **C. GitHub Release zips** | Non-git users | Extension <1 MB + server source <1 MB + Node deps | You still need Kokoro |
| **D. Local web UI** | No extension needed | Same as A or B | Same |

The **extension itself is under 1 MB**. The “80 MB” people associate with local voices is the shared **Kokoro-82M model (82.05 MB, q8f16)**. Every voice is only **0.5 MB**; the four starter voices add about **2 MB**, not 50–80 MB. All 54 voices together are about 27 MB.

---

## A. Docker Compose (recommended)

Requirements: Docker Desktop, Chrome.

```bash
git clone https://github.com/songsbyarchit/Listener.git
cd Listener
docker compose up -d --build
```

Open **http://127.0.0.1:8787** for the local web UI, or load the extension:

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

Then use either:

- Web UI: **http://127.0.0.1:8787**
- Chrome extension: load this folder at `chrome://extensions` and click the icon

Optional: if you already run a Kokoro/OpenAI-compatible TTS server elsewhere, point LISTNR at it:

```bash
TTS_BASE_URL=http://127.0.0.1:8880/v1 npm start
```

No API key is required. The app sends sentence-sized text to that local endpoint and caches returned audio under `data/audio`.

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

## D. Local web UI

The server serves the same UI the extension uses:

```
http://127.0.0.1:8787
```

This is a useful fallback if you do not want to install an extension. The Chrome extension is still the primary interface: it opens the same UI in a proper extension tab and works with the local server through host permissions.

---

## Reading the page you're on

After loading or reloading the extension, **reload any tabs that were already open** once so the content script can attach.

On readable `http(s)` pages you will see a small **Listen** pill in the bottom-right corner:

- Click **Listen** to capture the current page DOM and open it in LISTNR. This works on pages behind a login because it does not re-fetch the URL.
- **Alt+Shift+L** (Option+Shift+L on macOS) does the same from the keyboard.
- LISTNR opens Chrome's side panel when the browser allows it, otherwise a compact reader window.
- The captured page is saved as a normal library document. The × hides the pill for that tab.
- Very short pages, `chrome://` pages, the Web Store, and Chrome's PDF viewer do not get a pill.

The toolbar icon still opens the full library/reader tab. The floating pill is for the page you are currently reading.

## Choosing voices

Open **Voice** (top right) or click the **Voice** row in the sidebar.

- **Starter cards:** Heart, Bella, Michael, Emma.
- **All voices:** every voice Kokoro exposes (language + description).
- **Preview:** synthesizes a short sample through your local server.
- **Use here:** changes this document’s voice immediately.
- **Default:** sets the voice used for new imports.
- **Browse:** opens the full voice list at any time.

All voices share the same model. There is no per-voice model download in LISTNR, so adding voices is effectively free in size (0.5 MB per `.bin` in the Kokoro installation).

Suggested starting points:

| Voice | Character |
| --- | --- |
| `af_heart` | Warm US female; the default |
| `af_bella` | Bright US female |
| `am_michael` | Calm US male |
| `bf_emma` | UK female |
| `bm_george` | UK male |

---

## Data, backup, and deletion

Default data directory: **`./data/`** (or `/data` in Docker).

| Path | Contents |
| --- | --- |
| `data/listnr.db` | Documents, extracted text, reading position, settings, audio-cache index |
| `data/uploads/` | Original imported files |
| `data/audio/` | Cached Kokoro speech, shared across documents by text+voice |
| `data/tessdata/` | Tesseract language cache |

**Backup:** stop the server, then copy the whole `data/` directory. SQLite runs in WAL mode; a live copy can be inconsistent, so stop first.

**Delete:** use the Delete button in the library (removes the row, extracted text, position, and original upload). Cached speech files are shared and may remain until pruned. To erase everything, stop the server and remove `data/`.

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
| `TTS_BASE_URL` | `http://127.0.0.1:8880/v1` | Local OpenAI-compatible Kokoro endpoint. |
| `TTS_MODEL` | `kokoro` | Model name sent to the local endpoint. |
| `TTS_VOICE` | `af_heart` | Default voice for new documents. |
| `TTS_FORMAT` | `mp3` | Requested audio format. |
| `TTS_TIMEOUT_MS` | `45000` | Per-sentence synthesis timeout. |
| `TTS_VOICES` | curated list | Comma-separated `id` or `id:Label` fallback voices. |
| `MAX_UPLOAD_MB` | `30` | Upload limit. |
| `MAX_URL_MB` | `8` | URL-import response limit. |
| `AUDIO_CACHE_MAX_MB` | `1024` | Speech-cache disk budget. |

The extension is hard-wired to `http://127.0.0.1:8787`; if you change `PORT`, use the web UI or update `ui/app.js`.

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
- Reload the extension page after starting the server.

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
- The only outbound HTTP requests are URL imports you explicitly request. Voice, text, and audio stay local.
