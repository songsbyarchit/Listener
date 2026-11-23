const APP_URL = chrome.runtime.getURL('ui/app.html');

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

chrome.action.onClicked.addListener(openApp);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') openApp();
});
