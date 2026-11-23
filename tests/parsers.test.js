import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseHtml } from '../server/parsers/html.js';
import { parseMarkdown } from '../server/parsers/markdown.js';
import { parsePlainText } from '../server/parsers/text.js';
import { parsePdf } from '../server/parsers/pdf.js';
import { parseEpub } from '../server/parsers/epub.js';
import { parseImage, createTesseractRecognizer } from '../server/parsers/image.js';
import { normalizeDocument } from '../server/normalize.js';
import { makePdf, makeEpub } from './helpers.js';

const HTML = `<!doctype html>
<html><head><title>The Tides — Coastal Review</title>
<meta name="author" content="M. Rivera">
</head><body>
<nav><a href="/">Home</a><a href="/subscribe">Subscribe</a></nav>
<main><article>
<h1>The Tides</h1>
<p>The Moon does most of the work. Its gravity pulls the water into two bulges.</p>
<h2>Why the timing drifts</h2>
<p>It takes the Moon about 24 hours and 50 minutes to return to the same meridian.</p>
<ul><li>Spring tides follow new moons.</li></ul>
</article></main>
<aside>Related stories</aside>
<footer>Privacy · Terms</footer>
</body></html>`;

test('HTML uses Readability and drops navigation/boilerplate', () => {
  const parsed = parseHtml(HTML);
  assert.equal(parsed.title, 'The Tides');
  assert.equal(parsed.author, 'M. Rivera');
  const allText = parsed.blocks.map((block) => block.text).join(' ');
  assert.match(allText, /The Moon does most of the work/);
  assert.doesNotMatch(allText, /Subscribe|Privacy|Related stories/);
  assert.ok(parsed.blocks.some((block) => block.kind === 'h2'));

  const normalized = normalizeDocument(parsed);
  assert.equal(normalized.content.chapters.length, 2);
});

test('Markdown preserves headings and lists', () => {
  const parsed = parseMarkdown(`# Markdown Title

Intro paragraph with two sentences. The second sentence follows.

## A Section

- First item
- Second item

> A quoted line.
`);
  assert.equal(parsed.title, 'Markdown Title');
  assert.equal(
    parseMarkdown('# Real Title\n\nBody copy.', { title: 'filename.md' }).title,
    'Real Title'
  );
  assert.ok(parsed.blocks.some((block) => block.kind === 'h2'));
  assert.ok(parsed.blocks.filter((block) => block.kind === 'li').length >= 2);
  assert.ok(parsed.blocks.some((block) => block.kind === 'quote'));

  const normalized = normalizeDocument(parsed);
  assert.ok(normalized.segments.length >= 5);
});

test('plain text keeps paragraphs and groups line-wrapped input', () => {
  const parsed = parsePlainText('First paragraph. Still first.\n\nSecond paragraph.', {
    title: 'Notes'
  });
  assert.equal(parsed.title, 'Notes');
  assert.equal(parsed.blocks.length, 2);
  assert.equal(parsed.blocks[0].text, 'First paragraph. Still first.');

  const wrapped = parsePlainText(Array.from({ length: 120 }, (_, i) => `Line ${i} of text.`).join('\n'));
  assert.ok(wrapped.blocks.length >= 2);
});

test('PDF text extraction finds large headings and body paragraphs', async () => {
  const buffer = await makePdf();
  const parsed = await parsePdf(buffer, { title: 'fallback-name' });
  assert.equal(parsed.title, 'The Tides of March');
  assert.ok(parsed.blocks.some((block) => block.kind === 'h1'));
  assert.ok(parsed.blocks.some((block) => block.kind === 'h2' && /timing drifts/.test(block.text)));
  assert.ok(parsed.blocks.some((block) => /Moon does most of the work/.test(block.text)));
});

test('image OCR text is normalized into paragraphs', async () => {
  const parsed = await parseImage(Buffer.from('not really an image'), {
    title: 'Scan',
    recognize: async () => 'First OCR line. Second OCR line.\n\nSecond OCR paragraph.'
  });
  assert.equal(parsed.title, 'Scan');
  assert.equal(parsed.blocks.length, 2);
  assert.match(parsed.blocks[0].text, /Second OCR line/);
});

test('real local Tesseract OCR reads a PNG', { timeout: 120_000 }, async () => {
  const cachePath = fs.mkdtempSync(path.join(os.tmpdir(), 'listnr-ocr-'));
  const recognize = createTesseractRecognizer({ cachePath });
  try {
    const parsed = await parseImage(fs.readFileSync(new URL('./fixtures/ocr.png', import.meta.url)), {
      title: 'OCR fixture',
      recognize
    });
    const text = parsed.blocks.map((block) => block.text).join(' ').toLowerCase();
    assert.match(text, /quick brown fox/);
    assert.match(text, /listnr/);
  } finally {
    await recognize.terminate();
    fs.rmSync(cachePath, { recursive: true, force: true });
  }
});

test('EPUB uses metadata, navigation, and spine order', async () => {
  const buffer = await makeEpub();
  const parsed = await parseEpub(buffer, { title: 'fallback' });
  assert.equal(parsed.title, 'Test Book');
  assert.equal(parsed.author, 'Test Author');
  assert.deepEqual(
    parsed.blocks.filter((block) => block.kind === 'chapter').map((block) => block.title),
    ['Chapter One', 'Chapter Two']
  );

  const normalized = normalizeDocument(parsed);
  assert.deepEqual(
    normalized.content.chapters.map((chapter) => chapter.title),
    ['Chapter One', 'Chapter Two']
  );
  assert.match(normalized.plainText, /Hello EPUB world/);
});
