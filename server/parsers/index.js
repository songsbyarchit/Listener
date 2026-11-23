import path from 'node:path';
import { cleanText } from '../normalize.js';
import { parseHtml } from './html.js';
import { parseMarkdown } from './markdown.js';
import { parsePlainText } from './text.js';
import { parsePdf } from './pdf.js';
import { parseEpub } from './epub.js';
import { parseImage } from './image.js';

export const SUPPORTED_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'html',
  'htm',
  'xhtml',
  'pdf',
  'epub',
  'png',
  'jpg',
  'jpeg'
];

export const SUPPORTED_FORMATS = [
  { extension: 'txt', label: 'Plain text' },
  { extension: 'md', label: 'Markdown' },
  { extension: 'html', label: 'HTML' },
  { extension: 'pdf', label: 'PDF' },
  { extension: 'epub', label: 'EPUB' },
  { extension: 'png', label: 'Image (OCR)' },
  { extension: 'jpg', label: 'Image (OCR)' }
];

export function isSupportedExtension(extension) {
  return SUPPORTED_EXTENSIONS.includes(String(extension || '').toLowerCase());
}

export function titleFromFilename(filename) {
  return cleanText(
    path
      .basename(String(filename || ''), path.extname(String(filename || '')))
      .replace(/[_-]+/g, ' ')
  );
}

export async function parseFileBuffer({
  buffer,
  extension,
  filename,
  title,
  recognize
}) {
  const ext = String(extension || '').toLowerCase().replace(/^\./, '');
  const fallbackTitle = cleanText(title) || titleFromFilename(filename);

  switch (ext) {
    case 'txt':
      return parsePlainText(buffer.toString('utf8'), { title: fallbackTitle });
    case 'md':
    case 'markdown':
      return parseMarkdown(buffer.toString('utf8'), { title: fallbackTitle });
    case 'html':
    case 'htm':
    case 'xhtml':
      return parseHtml(buffer.toString('utf8'), { title: fallbackTitle });
    case 'pdf':
      return parsePdf(buffer, { title: fallbackTitle });
    case 'epub':
      return parseEpub(buffer, { title: fallbackTitle });
    case 'png':
    case 'jpg':
    case 'jpeg':
      return parseImage(buffer, { title: fallbackTitle, recognize });
    default:
      throw new Error(`Unsupported file type: .${ext || 'unknown'}`);
  }
}
