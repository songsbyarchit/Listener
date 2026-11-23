import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { cleanText } from '../normalize.js';

const BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption';

const REMOVE_SELECTOR = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'video',
  'audio',
  'object',
  'embed',
  'form',
  'button',
  'input',
  'select',
  'textarea',
  'nav',
  'aside',
  '[aria-hidden="true"]',
  '[hidden]',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]'
].join(',');

const JUNK_SIGNATURE =
  /(^|[\s_-])(nav|navbar|menu|footer|sidebar|aside|comment|comments|share|social|related|promo|advert|advertisement|ads?|cookie|cookies|banner|subscribe|newsletter|breadcrumb|pagination|modal|popup|toolbar|masthead|paywall|login|signup|search)([\s_-]|$)/i;

const BOILERPLATE =
  /^(advertisement|sponsored|subscribe( now)?|sign in|log in|share( this)?|menu|skip to (content|main content)|accept( all)? cookies?|cookie settings|read more|related( articles)?|comments?|loading(…|\.\.\.)?)$/i;

function blockText(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
  return cleanText(clone.textContent || '');
}

function kindOf(element) {
  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return tag;
  if (tag === 'li') return 'li';
  if (tag === 'blockquote') return 'quote';
  if (tag === 'pre') return 'code';
  if (tag === 'figcaption') return 'caption';

  // Leaf <p> elements inside lists/quotes inherit the container's role.
  if (element.closest('li')) return 'li';
  if (element.closest('blockquote')) return 'quote';
  return 'p';
}

export function extractBlocksFromElement(root) {
  if (!root) return [];

  const clone = root.cloneNode(true);
  clone.querySelectorAll(REMOVE_SELECTOR).forEach((node) => node.remove());
  clone.querySelectorAll('[class],[id]').forEach((node) => {
    const signature = `${node.getAttribute('class') || ''} ${node.id || ''}`;
    if (!JUNK_SIGNATURE.test(signature)) return;
    if (node.querySelectorAll('p').length >= 2) return;
    if ((node.textContent || '').length > 2000) return;
    node.remove();
  });

  const blocks = [];
  const seen = new Set();

  clone.querySelectorAll(BLOCK_SELECTOR).forEach((element) => {
    if (element.querySelector(BLOCK_SELECTOR)) return;
    const text = blockText(element);
    if (!text || text.length < 2 || BOILERPLATE.test(text)) return;

    const kind = kindOf(element);
    if (
      text.length < 12 &&
      kind === 'p' &&
      !element.closest('li') &&
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

export function extractBlocksFromHtml(html, { url = 'https://example.invalid/' } = {}) {
  const dom = new JSDOM(String(html), { url });
  return extractBlocksFromElement(dom.window.document.body);
}

function metaContent(document, selector) {
  return cleanText(document.querySelector(selector)?.getAttribute('content') || '');
}

export function parseHtml(html, { url, title: fallbackTitle } = {}) {
  if (!html || !String(html).trim()) throw new Error('The HTML file is empty.');

  const baseUrl = url || 'https://example.invalid/';
  let article = null;
  let metaTitle = '';
  let metaAuthor = '';
  let headingTitle = '';

  try {
    const readerDom = new JSDOM(String(html), { url: baseUrl });
    metaTitle = metaContent(readerDom.window.document, 'meta[property="og:title"]');
    metaAuthor =
      metaContent(readerDom.window.document, 'meta[name="author"]') ||
      metaContent(readerDom.window.document, 'meta[property="article:author"]');
    headingTitle = cleanText(
      readerDom.window.document.querySelector('article h1, main h1, [role="main"] h1, h1')
        ?.textContent || ''
    );
    article = new Readability(readerDom.window.document, { charThreshold: 100 }).parse();
  } catch {
    article = null;
  }

  let blocks = [];
  if (article?.content) {
    const articleDom = new JSDOM(
      `<!doctype html><html><body>${article.content}</body></html>`,
      { url: baseUrl }
    );
    blocks = extractBlocksFromElement(articleDom.window.document.body);
  }

  if (!blocks.length) {
    const fallbackDom = new JSDOM(String(html), { url: baseUrl });
    blocks = extractBlocksFromElement(fallbackDom.window.document.body);
  }

  if (!blocks.length) throw new Error('No readable text was found in this HTML.');

  const firstHeading = blocks.find((block) => block.kind === 'h1');
  const title =
    firstHeading?.text ||
    headingTitle ||
    cleanText(article?.title) ||
    metaTitle ||
    cleanText(fallbackTitle) ||
    'Untitled document';

  const author =
    cleanText(article?.byline) || metaAuthor || null;

  return { title, author, blocks };
}
