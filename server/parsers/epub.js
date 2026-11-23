import { cleanText } from '../normalize.js';
import { extractBlocksFromHtml } from './html.js';

let environment = null;
let ePub = null;

async function ensureEpubEnvironment() {
  if (environment && ePub) return;

  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/'
  });

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;

  for (const name of ['navigator', 'localStorage', 'location']) {
    try {
      Object.defineProperty(globalThis, name, {
        value: dom.window[name],
        configurable: true,
        writable: true
      });
    } catch {
      // Node may already provide a non-configurable version.
    }
  }

  const module = await import('epubjs');
  ePub = module.default?.default || module.default;
  environment = dom;
}

function hrefKey(value) {
  return String(value || '')
    .split('#')[0]
    .replace(/^\.\//, '')
    .trim()
    .toLowerCase();
}

function flattenToc(items, map = new Map()) {
  for (const item of items || []) {
    const key = hrefKey(item.href);
    if (key && !map.has(key)) map.set(key, cleanText(item.label || ''));
    if (item.subitems?.length) flattenToc(item.subitems, map);
  }
  return map;
}

function creatorName(value) {
  if (!value) return null;
  if (typeof value === 'string') return cleanText(value);
  if (Array.isArray(value)) return cleanText(value.filter(Boolean).join(', '));
  if (typeof value === 'object') return cleanText(value.name || '');
  return null;
}

export async function parseEpub(buffer, { title: fallbackTitle } = {}) {
  await ensureEpubEnvironment();

  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const book = ePub(bytes);

  try {
    const [metadata, navigation, spine] = await Promise.all([
      book.loaded.metadata,
      book.loaded.navigation,
      book.loaded.spine
    ]);

    const navMap = flattenToc(navigation?.toc || []);
    const blocks = [];
    let sectionNumber = 0;

    for (const item of spine.spineItems || []) {
      sectionNumber += 1;
      let node;
      try {
        node = await item.load(book.load.bind(book));
      } catch {
        continue;
      }

      try {
        const html = node?.outerHTML || node?.documentElement?.outerHTML || String(node || '');
        const sectionBlocks = html ? extractBlocksFromHtml(html) : [];
        if (!sectionBlocks.length) continue;

        const firstHeading = sectionBlocks.find((block) => /^h[1-3]$/.test(block.kind));
        const chapterTitle =
          navMap.get(hrefKey(item.href)) ||
          firstHeading?.text ||
          `Section ${sectionNumber}`;

        blocks.push({ kind: 'chapter', title: chapterTitle });
        blocks.push(...sectionBlocks);
      } finally {
        try {
          item.unload();
        } catch {
          // Ignore EPUB.js cleanup errors.
        }
      }
    }

    if (!blocks.some((block) => block.kind !== 'chapter')) {
      throw new Error('No readable text was found in this EPUB.');
    }

    const bookTitle =
      cleanText(metadata?.title) ||
      cleanText(fallbackTitle) ||
      'Untitled EPUB';

    return {
      title: bookTitle,
      author: creatorName(metadata?.creator) || null,
      blocks
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('No readable text')) throw error;
    throw new Error('The EPUB could not be read. It may be damaged or DRM-protected.');
  } finally {
    try {
      book.destroy?.();
    } catch {
      // Ignore cleanup errors.
    }
  }
}
