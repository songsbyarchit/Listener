(() => {
  'use strict';

  if (window.__LISTNR_PAGE_READER__) return;
  window.__LISTNR_PAGE_READER__ = true;

  if (window.top !== window) return;
  if (document.querySelector('meta[name="listnr-app"]')) return;
  if (sessionStorage.getItem('listnr:page-pill-hidden') === '1') return;

  const textLength = (document.body?.innerText || '').trim().length;
  if (textLength < 350) return;

  let host = null;
  let shadow = null;
  let mainButton = null;
  let label = null;
  let toast = null;
  let importing = false;
  let toastTimer = null;

  const CSS = `
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
.lnr-main:disabled { cursor: wait; opacity: .8; }
.lnr-wave {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 13px;
}
.lnr-wave i {
  display: block;
  width: 2px;
  height: 13px;
  border-radius: 1px;
  background: #dd552f;
  transform: scaleY(.4);
  transform-origin: bottom center;
}
.lnr-pill:hover .lnr-wave i {
  animation: lnr-pill-eq .9s ease-in-out infinite;
}
.lnr-pill:hover .lnr-wave i:nth-child(2) { animation-delay: .12s; }
.lnr-pill:hover .lnr-wave i:nth-child(3) { animation-delay: .25s; }
.lnr-pill:hover .lnr-wave i:nth-child(4) { animation-delay: .38s; }
.lnr-pill.is-loading .lnr-wave i {
  animation: lnr-pill-eq .75s ease-in-out infinite;
}
.lnr-pill.is-loading .lnr-wave i:nth-child(2) { animation-delay: .1s; }
.lnr-pill.is-loading .lnr-wave i:nth-child(3) { animation-delay: .2s; }
.lnr-pill.is-loading .lnr-wave i:nth-child(4) { animation-delay: .3s; }
.lnr-close {
  border: 0;
  background: transparent;
  color: rgba(255,255,255,.45);
  padding: 0 9px 0 2px;
  font: 400 17px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  cursor: pointer;
  align-self: stretch;
}
.lnr-close:hover { color: #fff8ef; }
.lnr-toast {
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
}
.lnr-toast[hidden] { display: none; }
@keyframes lnr-pill-eq {
  0%, 100% { transform: scaleY(.35); }
  50% { transform: scaleY(1); }
}
@media (prefers-reduced-motion: reduce) {
  .lnr-pill .lnr-wave i { animation: none !important; }
}
@media print { .lnr-wrap { display: none !important; } }
`;

  function ensureUI() {
    if (host) return;
    host = document.createElement('div');
    host.id = 'listnr-page-reader-host';
    shadow = host.attachShadow({ mode: 'open' });

    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      shadow.append(style);
    }

    shadow.innerHTML = `
      <div class="lnr-wrap">
        <div class="lnr-pill" role="group" aria-label="LISTNR page reader">
          <button class="lnr-main" type="button" title="Read this page aloud with LISTNR">
            <span class="lnr-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
            <span class="lnr-label">Listen</span>
          </button>
          <button class="lnr-close" type="button" aria-label="Hide LISTNR on this page" title="Hide on this page">×</button>
          <div class="lnr-toast" role="status" aria-live="polite" hidden></div>
        </div>
      </div>`;

    mainButton = shadow.querySelector('.lnr-main');
    label = shadow.querySelector('.lnr-label');
    toast = shadow.querySelector('.lnr-toast');
    const close = shadow.querySelector('.lnr-close');

    mainButton.addEventListener('click', startImport);
    close.addEventListener('click', () => {
      sessionStorage.setItem('listnr:page-pill-hidden', '1');
      host.remove();
      host = null;
      shadow = null;
    });

    document.documentElement.append(host);
  }

  function setLoading(isLoading, text) {
    if (!mainButton) return;
    importing = isLoading;
    mainButton.disabled = isLoading;
    if (text) label.textContent = text;
    const pill = shadow?.querySelector('.lnr-pill');
    pill?.classList.toggle('is-loading', isLoading);
  }

  function showToast(message, duration = 5000) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toast) toast.hidden = true;
      toastTimer = null;
    }, duration);
  }

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

  async function startImport() {
    if (importing) return;
    ensureUI();

    const page = collectPage();
    if (!page.html && !page.text.trim()) {
      showToast('LISTNR could not find readable text on this page.');
      return;
    }

    setLoading(true, 'Preparing…');
    try {
      const result = await sendMessage({
        type: 'listnr:import-page',
        page: {
          title: document.title || 'Web page',
          url: location.href,
          html: page.html,
          text: page.text
        }
      });

      if (!result?.ok) {
        throw new Error(result?.error || 'Could not import this page.');
      }

      setLoading(true, 'Opening…');
      showToast('Opening LISTNR…', 2500);
      setTimeout(() => {
        if (!host) return;
        setLoading(false, 'Listen');
        if (toast) toast.hidden = true;
      }, 2200);
    } catch (error) {
      setLoading(false, 'Listen');
      showToast(String(error?.message || error), 6000);
    }
  }

  ensureUI();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'listnr:listen-page') {
      ensureUI();
      startImport();
    }
  });
})();
