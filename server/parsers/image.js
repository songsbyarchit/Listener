import fs from 'node:fs';
import path from 'node:path';
import { cleanText } from '../normalize.js';

function ocrTextToParagraphs(text) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n');
  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((paragraph) => cleanText(paragraph))
    .filter(Boolean);

  if (paragraphs.length > 1) return paragraphs;

  const lines = normalized
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);

  const grouped = [];
  let buffer = '';
  for (const line of lines) {
    if (buffer && buffer.length + line.length > 500) {
      grouped.push(buffer);
      buffer = '';
    }
    buffer = buffer ? `${buffer} ${line}` : line;
  }
  if (buffer) grouped.push(buffer);
  return grouped;
}

export async function parseImage(buffer, { title, recognize } = {}) {
  if (typeof recognize !== 'function') {
    throw new Error('OCR is not configured.');
  }

  const text = await recognize(buffer);
  const paragraphs = ocrTextToParagraphs(text);
  if (!paragraphs.length) {
    throw new Error('No readable text was found in this image.');
  }

  return {
    title: cleanText(title) || 'Scanned image',
    author: null,
    blocks: paragraphs.map((paragraph) => ({ kind: 'p', text: paragraph }))
  };
}

export function createTesseractRecognizer({ cachePath } = {}) {
  let workerPromise = null;

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        if (cachePath) fs.mkdirSync(cachePath, { recursive: true });
        const tesseractModule = await import('tesseract.js');
        const createWorker = tesseractModule.createWorker || tesseractModule.default?.createWorker;
        const dataModule = await import('@tesseract.js-data/eng');
        const data = dataModule.default || dataModule;
        const worker = await createWorker('eng', 1, {
          langPath: data.langPath,
          gzip: true,
          cachePath,
          logger: () => {}
        });
        return worker;
      })().catch((error) => {
        workerPromise = null;
        throw error;
      });
    }
    return workerPromise;
  }

  const recognize = async function recognize(imageBuffer) {
    const worker = await getWorker();
    const result = await worker.recognize(imageBuffer);
    return result?.data?.text || '';
  };

  recognize.terminate = async () => {
    if (!workerPromise) return;
    try {
      const worker = await workerPromise;
      await worker.terminate();
    } finally {
      workerPromise = null;
    }
  };

  return recognize;
}

export function imageTitleFromFilename(filename) {
  return path.basename(filename, path.extname(filename)).replace(/[_-]+/g, ' ');
}
