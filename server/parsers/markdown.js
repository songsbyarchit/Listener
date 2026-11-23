import { marked } from 'marked';
import { cleanText } from '../normalize.js';
import { extractBlocksFromHtml } from './html.js';

export function parseMarkdown(markdown, { title } = {}) {
  const source = String(markdown || '');
  if (!source.trim()) throw new Error('The Markdown file is empty.');

  const html = marked.parse(source, { gfm: true, breaks: false });
  const blocks = extractBlocksFromHtml(html);
  if (!blocks.length) throw new Error('No readable text was found in this Markdown file.');

  const firstHeading = blocks.find((block) => block.kind === 'h1');
  return {
    title: firstHeading?.text || cleanText(title) || 'Markdown document',
    author: null,
    blocks
  };
}
