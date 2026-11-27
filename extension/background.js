const SERVER_URL = 'http://127.0.0.1:8787';

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
        'The local listnr server is offline. Run docker compose up -d in ~/Downloads/Listener.'
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

  // The in-page player keeps the document and reads it right there.
  return { ok: true, docId, document: payload.document };
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
      error: 'The voice service is unavailable. Check the listnr server configuration and try again.'
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
      provider: payload.provider || 'kokoro',
      voices: payload.voices || [],
      defaultVoice: payload.defaultVoice || ''
    };
  } catch {
    return { ok: false, error: 'The local listnr server is offline.' };
  }
}

async function fetchKernlAppearance() {
  try {
    const response = await fetch(`${SERVER_URL}/api/kernl/appearance`, {
      signal: AbortSignal.timeout(5000)
    });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, appearance: payload?.appearance || 'system' };
  } catch {
    return { ok: false, appearance: 'system' };
  }
}

async function saveKernlAppearance(value) {
  try {
    const response = await fetch(`${SERVER_URL}/api/kernl/appearance`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appearance: value }),
      signal: AbortSignal.timeout(5000)
    });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

// Clips: save the article or the selection to read or listen to later.
async function saveClip(message) {
  const clip = message.clip || {};
  try {
    const response = await fetch(`${SERVER_URL}/api/clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: clip.title,
        url: clip.url,
        site: clip.site,
        kind: clip.kind,
        text: clip.text
      }),
      signal: AbortSignal.timeout(10000)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, error: payload?.error?.message || 'Could not save the clip.' };
    return { ok: true, clip: payload.clip };
  } catch {
    return { ok: false, error: 'listnr is not running, so the clip was not saved. Start listnr and try again.' };
  }
}

async function listClips() {
  try {
    const response = await fetch(`${SERVER_URL}/api/clips`, { signal: AbortSignal.timeout(5000) });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, clips: payload?.clips || [] };
  } catch {
    return { ok: false, clips: [] };
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

async function readPageInTab(tabId, type = 'listnr:listen-page') {
  try {
    await chrome.tabs.sendMessage(tabId, { type });
    return { ok: true };
  } catch {
    // The tab was loaded before the extension/content script; inject once.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['extension/page-reader.js']
    });
    await chrome.tabs.sendMessage(tabId, { type });
    return { ok: true };
  } catch {
    // Restricted page (chrome://, Web Store, PDF viewer, etc.).
    return {
      ok: false,
      error: 'listnr cannot read this page. Open a normal http(s) page and try again.'
    };
  }
}

async function readActivePage() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id == null) return { ok: false, error: 'No active tab.' };
  return readPageInTab(tab.id);
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

  if (message.type === 'listnr:get-kernl-appearance') {
    fetchKernlAppearance().then(sendResponse).catch(() => sendResponse({ ok: false, appearance: 'system' }));
    return true;
  }

  if (message.type === 'listnr:set-kernl-appearance') {
    saveKernlAppearance(String(message.appearance || 'system'))
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
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

  if (message.type === 'listnr:save-clip') {
    saveClip(message).then(sendResponse);
    return true;
  }

  if (message.type === 'listnr:list-clips') {
    listClips().then(sendResponse);
    return true;
  }

  if (message.type === 'listnr:read-page') {
    readActivePage()
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, error: String(error?.message || error) })
      );
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'read-page' && command !== 'clip-page') return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id != null) await readPageInTab(tab.id, command === 'clip-page' ? 'listnr:clip-page' : 'listnr:listen-page');
});
