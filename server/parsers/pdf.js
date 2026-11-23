import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cleanText } from '../normalize.js';

function lineText(parts) {
  const sorted = parts.slice().sort((a, b) => a.x - b.x);
  let text = '';
  let previousEnd = null;

  for (const part of sorted) {
    const raw = part.str || '';
    if (!raw) continue;
    const estimatedWidth = part.width || raw.length * Math.max(4, part.height * 0.48);
    if (text && previousEnd != null) {
      const gap = part.x - previousEnd;
      if (gap > Math.max(1.2, part.height * 0.13) && !text.endsWith(' ') && !raw.startsWith(' ')) {
        text += ' ';
      }
    }
    text += raw;
    previousEnd = part.x + estimatedWidth;
  }

  return cleanText(text);
}

function buildPageLines(items) {
  const buckets = [];

  for (const item of items) {
    const raw = item.str || '';
    if (!raw.trim()) continue;

    const x = Number(item.transform?.[4]) || 0;
    const y = Number(item.transform?.[5]) || 0;
    const height = Math.abs(Number(item.height) || Number(item.transform?.[3]) || 10);

    let line = buckets.find((candidate) => Math.abs(candidate.y - y) < 3);
    if (!line) {
      line = { y, height, parts: [] };
      buckets.push(line);
    }
    line.height = Math.max(line.height, height);
    line.parts.push({
      x,
      str: raw,
      width: Math.abs(Number(item.width) || 0),
      height
    });
  }

  buckets.sort((a, b) => b.y - a.y);
  return buckets.map((line, index) => ({
    text: lineText(line.parts),
    height: line.height,
    y: line.y,
    gap: index > 0 ? buckets[index - 1].y - line.y : 0
  }));
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function headerFooterKeys(pages) {
  if (pages.length < 3) return new Set();

  const counts = new Map();
  for (const page of pages) {
    const candidates = [page[0], page[page.length - 1]].filter(Boolean);
    const seenOnPage = new Set();
    for (const line of candidates) {
      const key = cleanText(line.text)
        .toLowerCase()
        .replace(/\d+/g, '#');
      if (!key || key.length > 90 || seenOnPage.has(key)) continue;
      seenOnPage.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= threshold)
      .map(([key]) => key)
  );
}

export async function parsePdf(buffer, { title: fallbackTitle } = {}) {
  const data = new Uint8Array(buffer);
  if (data[0] !== 0x25 || data[1] !== 0x50 || data[2] !== 0x44 || data[3] !== 0x46) {
    throw new Error('That file does not look like a valid PDF.');
  }

  const task = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true
  });

  let document;
  try {
    document = await task.promise;
  } catch {
    throw new Error('The PDF could not be opened. It may be damaged or password-protected.');
  }

  try {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const lines = buildPageLines(textContent.items).filter((line) => line.text);
      pages.push(lines);
      page.cleanup();
    }

    const heights = pages
      .flat()
      .map((line) => line.height)
      .filter((height) => height > 0);
    const bodyHeight = percentile(heights, 0.25) || 11;
    const repeated = headerFooterKeys(pages);

    const blocks = [];
    for (const page of pages) {
      let paragraph = '';
      let previousLine = null;

      const flush = () => {
        const text = cleanText(paragraph);
        if (text) blocks.push({ kind: 'p', text });
        paragraph = '';
      };

      for (const line of page) {
        const key = cleanText(line.text).toLowerCase().replace(/\d+/g, '#');
        if (repeated.has(key)) continue;

        const isHeading = line.height >= bodyHeight * 1.42;
        if (isHeading) {
          flush();
          const level = line.height >= bodyHeight * 2.05 ? 'h1' : 'h2';
          blocks.push({ kind: level, text: line.text });
          previousLine = line;
          continue;
        }

        const gap = previousLine ? line.gap : 0;
        if (paragraph && gap > bodyHeight * 1.7) flush();

        paragraph = paragraph ? `${paragraph} ${line.text}` : line.text;
        previousLine = line;
      }

      flush();
    }

    if (!blocks.length) {
      throw new Error('No selectable text was found in this PDF. Scanned PDFs need OCR.');
    }

    const firstHeading = blocks.find((block) => /^h[1-2]$/.test(block.kind));
    return {
      title: firstHeading?.text || cleanText(fallbackTitle) || 'PDF document',
      author: null,
      blocks
    };
  } finally {
    try {
      await task.destroy();
    } catch {
      // Not fatal.
    }
  }
}
