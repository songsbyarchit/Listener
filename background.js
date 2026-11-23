/* LISTNR background service worker.
 * A stateless router: content script <-> offscreen audio engine.
 * Session ownership survives service-worker restarts in chrome.storage.session.
 */

const OFFSCREEN_URL = 'offscreen.html';
let creating = null;
let serialQueue = Promise.resolve();

/* ------------------------------------------------------------------ */
/* Offscreen document                                                  */
/* ------------------------------------------------------------------ */

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (creating) {
    await creating;
    return;
  }
  creating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Speaks page text aloud and plays studio voice audio.'
    })
    .then(() => new Promise((resolve) => setTimeout(resolve, 100)))
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function sendToOffscreen(message) {
  await ensureOffscreen();
  const payload = { target: 'offscreen', ...message };
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await chrome.runtime.sendMessage(payload);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  throw lastError;
}

async function notifyOffscreen(message) {
  if (!(await chrome.offscreen.hasDocument())) return;
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', ...message });
  } catch {
    /* engine already gone */
  }
}

/* ------------------------------------------------------------------ */
/* Session helpers                                                     */
/* ------------------------------------------------------------------ */

function serial(task) {
  const next = serialQueue.then(task);
  serialQueue = next.catch(() => {});
  return next;
}

async function getActiveTabId() {
  const stored = await chrome.storage.session.get('activeTabId');
  return stored.activeTabId ?? null;
}

async function setActiveTabId(tabId) {
  if (tabId == null) await chrome.storage.session.remove('activeTabId');
  else await chrome.storage.session.set({ activeTabId: tabId });
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false;
  }
}

function startSession(tabId, message) {
  return serial(async () => {
    const previous = await getActiveTabId();
    if (previous != null && previous !== tabId) {
      sendToTab(previous, { type: 'listnr:stopped' });
    }
    await setActiveTabId(tabId);
    try {
      await sendToOffscreen({
        action: 'start',
        segments: message.segments,
        meta: message.meta
      });
    } catch (error) {
      await setActiveTabId(null);
      throw error;
    }
  });
}

function relayCommand(message) {
  return serial(async () => {
    const tabId = await getActiveTabId();
    if (tabId == null) return { ok: false, error: 'No active LISTNR session.' };
    return sendToOffscreen({
      action: 'cmd',
      cmd: message.cmd,
      payload: message.payload
    });
  });
}

function endSession() {
  return serial(async () => {
    await setActiveTabId(null);
    await notifyOffscreen({ action: 'cmd', cmd: 'stop' });
    scheduleOffscreenClose();
  });
}

let closeTimer = null;
function scheduleOffscreenClose() {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(async () => {
    closeTimer = null;
    try {
      if ((await getActiveTabId()) != null) return;
      if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
    } catch {
      /* already closed */
    }
  }, 30000);
}

/* ------------------------------------------------------------------ */
/* Engine -> content events                                            */
/* ------------------------------------------------------------------ */

async function forwardEngineEvent(event) {
  const tabId = await getActiveTabId();
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { type: 'listnr:event', event }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Messaging                                                           */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  // Addressed to the offscreen engine; its own listener handles it.
  if (message.target === 'offscreen') return;

  // Events emitted by the offscreen engine.
  if (message.source === 'offscreen') {
    forwardEngineEvent(message.event);
    return;
  }

  if (message.type === 'listnr:start' && sender.tab?.id != null) {
    startSession(sender.tab.id, message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'listnr:cmd') {
    relayCommand(message)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === 'listnr:stop') {
    endSession()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

/* ------------------------------------------------------------------ */
/* Toolbar button                                                      */
/* ------------------------------------------------------------------ */

function flashBadge(tabId) {
  chrome.action.setBadgeBackgroundColor({ color: '#dd552f' });
  chrome.action.setBadgeText({ tabId, text: '!' });
  setTimeout(() => chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {}), 2200);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (tab?.id == null) return;
  if (await sendToTab(tab.id, { type: 'listnr:toggle' })) return;

  // The tab was open before LISTNR was installed or reloaded.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    if (await sendToTab(tab.id, { type: 'listnr:toggle' })) return;
  } catch {
    /* restricted page (chrome://, Web Store, PDF viewer, ...) */
  }
  flashBadge(tab.id);
});

/* ------------------------------------------------------------------ */
/* Context menu + keyboard commands                                    */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'listnr-page',
      title: 'Read this page with LISTNR',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: 'listnr-selection',
      title: 'Read selection with LISTNR',
      contexts: ['selection']
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id == null) return;
  if (info.menuItemId === 'listnr-selection') {
    chrome.tabs
      .sendMessage(tab.id, {
        type: 'listnr:start-selection',
        selectionText: info.selectionText || ''
      })
      .catch(() => {});
  } else if (info.menuItemId === 'listnr-page') {
    chrome.tabs.sendMessage(tab.id, { type: 'listnr:start-page' }).catch(() => {});
  }
});

const COMMANDS = {
  toggle: 'listnr:toggle',
  next: 'listnr:next',
  prev: 'listnr:prev',
  close: 'listnr:close'
};

chrome.commands.onCommand.addListener(async (command) => {
  const type = COMMANDS[command];
  if (!type) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id == null) return;
  chrome.tabs.sendMessage(tab.id, { type }).catch(() => {});
});

/* ------------------------------------------------------------------ */
/* Stop speech when its tab goes away                                  */
/* ------------------------------------------------------------------ */

chrome.tabs.onRemoved.addListener((tabId) => {
  getActiveTabId().then((active) => {
    if (active === tabId) endSession();
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  getActiveTabId().then((active) => {
    if (active === tabId) endSession();
  });
});
