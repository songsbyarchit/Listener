const APP_URL = chrome.runtime.getURL('ui/app.html');
const SERVER_URL = 'http://127.0.0.1:8787';

if (chrome.sidePanel?.setOptions) {
  chrome.sidePanel.setOptions({ path: 'ui/panel.html', enabled: true }).catch(() => {});
}

async function openApp() {
  const existing = await chrome.tabs.query({ url: APP_URL });
  if (existing.length) {
    const tab = existing[0];
    await chrome.tabs.update(tab.id, { active: true });
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch {
      // The window may have just closed.
    }
    return;
  }
  await chrome.tabs.create({ url: APP_URL });
}

async function openReader(docId, tabId) {
  const url = `${APP_URL}#/doc/${docId}`;

  // Try Chrome's side panel first. Some Chrome builds only allow this from an
  // action/command gesture; if it is rejected, fall back to a compact window.
  if (chrome.sidePanel?.open) {
    try {
      await chrome.storage.session.set({
        listnrPendingDoc: { id: docId, ts: Date.now() }
      });
      await chrome.sidePanel.open({ tabId });
      return { mode: 'side-panel' };
    } catch {
      await chrome.storage.session.remove('listnrPendingDoc');
    }
  }

  try {
    const stored = await chrome.storage.session.get('listnrReaderWindowId');
    let windowId = stored.listnrReaderWindowId ?? null;

    if (windowId != null) {
      try {
        await chrome.windows.get(windowId);
        const [tab] = await chrome.tabs.query({ windowId });
        if (tab?.id != null) {
          await chrome.tabs.update(tab.id, { url, active: true });
          await chrome.windows.update(windowId, { focused: true });
          return { mode: 'window' };
        }
      } catch {
        windowId = null;
        await chrome.storage.session.remove('listnrReaderWindowId');
      }
    }

    const win = await chrome.windows.create({
      url,
      type: 'popup',
      width: 480,
      height: 900
    });
    await chrome.storage.session.set({ listnrReaderWindowId: win.id });
    return { mode: 'window' };
  } catch {
    await chrome.tabs.create({ url });
    return { mode: 'tab' };
  }
}

async function importPage(message, sender) {
  const page = message.page || {};
  let html = typeof page.html === 'string' ? page.html : '';
  let text = typeof page.text === 'string' ? page.text : '';

  if (html.length > 6_000_000) html = '';
  if (text.length > 1_500_000) text = text.slice(0, 1_500_000);
  if (!html.trim() && !text.trim()) {
    return { ok: false, error: 'This page has no readable text.' };
  }

  const url =
    typeof page.url === 'string'
      ? page.url.slice(0, 4096)
      : sender.tab?.url || '';
  const title =
    typeof page.title === 'string'
      ? page.title.slice(0, 500)
      : sender.tab?.title || 'Web page';

  let response;
  try {
    response = await fetch(`${SERVER_URL}/api/documents/import/page`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title, html, text }),
      signal: AbortSignal.timeout(60000)
    });
  } catch {
    return {
      ok: false,
      error:
        'The local LISTNR server is offline. Run docker compose up -d in ~/Downloads/Listener.'
    };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      error: payload?.error?.message || `Import failed (${response.status}).`
    };
  }

  const docId = payload?.document?.id;
  if (!docId) return { ok: false, error: 'The server did not return a document.' };

  if (message.inline === true) {
    return { ok: true, docId, document: payload.document };
  }

  const opened = await openReader(docId, sender.tab?.id);
  return { ok: true, docId, mode: opened.mode };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function fetchAudioForTab(message) {
  const docId = String(message.docId || '');
  const index = Number(message.index);
  const voice = String(message.voice || '');

  if (!/^[a-f0-9-]{8,}$/i.test(docId) || !Number.isInteger(index) || index < 0) {
    return { ok: false, error: 'Invalid audio request.' };
  }

  let response;
  try {
    response = await fetch(
      `${SERVER_URL}/api/documents/${encodeURIComponent(docId)}/audio/${index}?voice=${encodeURIComponent(voice)}`,
      { signal: AbortSignal.timeout(120000) }
    );
  } catch {
    return {
      ok: false,
      code: 'tts_unavailable',
      error: 'The local voice server is offline. Start Kokoro-FastAPI and try again.'
    };
  }

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return {
      ok: false,
      status: response.status,
      code: payload?.error?.code,
      error: payload?.error?.message || `Audio request failed (${response.status}).`
    };
  }

  const buffer = await response.arrayBuffer();
  return {
    ok: true,
    data: arrayBufferToBase64(buffer),
    contentType: response.headers.get('content-type') || 'audio/mpeg'
  };
}

async function fetchVoiceList() {
  try {
    const response = await fetch(`${SERVER_URL}/api/voices`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const payload = await response.json();
    return {
      ok: true,
      voices: payload.voices || [],
      defaultVoice: payload.defaultVoice || 'af_heart'
    };
  } catch {
    return { ok: false, error: 'The local LISTNR server is offline.' };
  }
}

async function savePageState(message) {
  const docId = String(message.docId || '');
  if (!/^[a-f0-9-]{8,}$/i.test(docId)) return { ok: false, error: 'Invalid document.' };
  try {
    const response = await fetch(
      `${SERVER_URL}/api/documents/${encodeURIComponent(docId)}/state`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          position: message.position,
          settings: message.settings
        }),
        signal: AbortSignal.timeout(10000)
      }
    );
    return { ok: response.ok };
  } catch {
    return { ok: false, error: 'Could not save reading position.' };
  }
}

async function readPageInTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'listnr:listen-page' });
    return;
  } catch {
    // The tab was loaded before the extension/content script; inject once.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['extension/page-reader.js']
    });
    await chrome.tabs.sendMessage(tabId, { type: 'listnr:listen-page' });
  } catch {
    // Restricted page (chrome://, Web Store, PDF viewer, etc.).
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'listnr:import-page' && sender.tab?.id != null) {
    importPage(message, sender)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({ ok: false, error: String(error?.message || error) })
      );
    return true;
  }

  if (message.type === 'listnr:get-audio' && sender.tab?.id != null) {
    fetchAudioForTab(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, error: String(error?.message || error) })
      );
    return true;
  }

  if (message.type === 'listnr:get-voices') {
    fetchVoiceList()
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, error: String(error?.message || error) })
      );
    return true;
  }

  if (message.type === 'listnr:save-page-state') {
    savePageState(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, error: String(error?.message || error) })
      );
    return true;
  }

  if (message.type === 'listnr:open-reader' && sender.tab?.id != null) {
    openReader(String(message.docId || ''), sender.tab.id)
      .then((opened) => sendResponse({ ok: true, mode: opened.mode }))
      .catch((error) =>
        sendResponse({ ok: false, error: String(error?.message || error) })
      );
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'read-page') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id != null) await readPageInTab(tab.id);
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const stored = await chrome.storage.session.get('listnrReaderWindowId');
  if (stored.listnrReaderWindowId === windowId) {
    await chrome.storage.session.remove('listnrReaderWindowId');
  }
});

chrome.action.onClicked.addListener(openApp);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') openApp();
});
