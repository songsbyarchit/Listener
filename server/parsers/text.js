import { cleanText } from '../normalize.js';

function groupLinesIntoParagraphs(lines) {
  const paragraphs = [];
  let buffer = '';
  for (const line of lines) {
    if (buffer && buffer.length + line.length > 600) {
      paragraphs.push(buffer);
      buffer = '';
    }
    buffer = buffer ? `${buffer} ${line}` : line;
  }
  if (buffer) paragraphs.push(buffer);
  return paragraphs;
}

export function parsePlainText(text, { title } = {}) {
  const normalized = String(text || '').replace(/\r\n?/g, '\n');
  if (!normalized.trim()) throw new Error('The text file is empty.');

  let paragraphs = normalized
    .split(/\n\s*\n/)
    .map((paragraph) => cleanText(paragraph))
    .filter(Boolean);

  if (paragraphs.length <= 1) {
    const lines = normalized
      .split(/\n+/)
      .map((line) => cleanText(line))
      .filter(Boolean);
    paragraphs = groupLinesIntoParagraphs(lines);
  }

  if (!paragraphs.length) throw new Error('No readable text was found.');

  return {
    title: cleanText(title) || 'Pasted text',
    author: null,
    blocks: paragraphs.map((paragraph) => ({ kind: 'p', text: paragraph }))
  };
}
