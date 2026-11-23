const SENTENCE_SEGMENTER = (() => {
  try {
    return new Intl.Segmenter('en', { granularity: 'sentence' });
  } catch {
    return null;
  }
})();

const HEADING = /^h[1-6]$/;
const MAX_SENTENCE_CHARS = 700;

export function cleanText(value) {
  return String(value || '')
    .replace(/[​-‍﻿­]/g, '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForCompare(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeKind(kind) {
  if (kind === 'heading') return 'h2';
  if (HEADING.test(kind)) return kind;
  if (['p', 'li', 'quote', 'code', 'caption'].includes(kind)) return kind;
  return 'p';
}

export function splitSentences(value) {
  const text = cleanText(value);
  if (!text) return [];

  let pieces;
  if (SENTENCE_SEGMENTER) {
    pieces = Array.from(SENTENCE_SEGMENTER.segment(text), (entry) => entry.segment.trim());
  } else {
    pieces = (text.match(/[^.!?…]+[.!?…]+["'”’)\]]*|[^.!?…]+$/g) || [text]).map((piece) => piece.trim());
  }

  const merged = [];
  for (const piece of pieces) {
    if (!piece) continue;
    if (merged.length && piece.length < 3) merged[merged.length - 1] += ` ${piece}`;
    else merged.push(piece);
  }

  const final = [];
  for (const piece of merged) {
    if (piece.length <= MAX_SENTENCE_CHARS) {
      final.push(piece);
      continue;
    }
    let rest = piece;
    while (rest.length > MAX_SENTENCE_CHARS) {
      let cut = rest.lastIndexOf(' ', MAX_SENTENCE_CHARS - 100);
      if (cut < 200) cut = MAX_SENTENCE_CHARS;
      final.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) final.push(rest);
  }

  return final.filter(Boolean);
}

export function normalizeDocument({ title, author, blocks }) {
  const docTitle = cleanText(title) || 'Untitled document';
  const docAuthor = cleanText(author) || null;

  const cleaned = [];
  for (const block of blocks || []) {
    if (!block) continue;
    if (block.kind === 'chapter') {
      const chapterTitle = cleanText(block.title);
      if (chapterTitle) cleaned.push({ kind: 'chapter', title: chapterTitle });
      continue;
    }
    const kind = normalizeKind(block.kind);
    const text = cleanText(block.text);
    if (text) cleaned.push({ kind, text });
  }

  // Remove a leading title heading that merely repeats the header title.
  const firstContentIndex = cleaned.findIndex((block) => block.kind !== 'chapter');
  if (
    firstContentIndex >= 0 &&
    /^h[1-3]$/.test(cleaned[firstContentIndex].kind) &&
    normalizeForCompare(cleaned[firstContentIndex].text) === normalizeForCompare(docTitle) &&
    cleaned.length > firstContentIndex + 1
  ) {
    cleaned.splice(firstContentIndex, 1);
  }

  if (!cleaned.some((block) => block.kind !== 'chapter')) {
    throw new Error('No readable text was found.');
  }

  const chapters = [];
  let current = null;

  const beginChapter = (chapterTitle) => {
    const nextTitle = cleanText(chapterTitle) || `Chapter ${chapters.length + 1}`;
    current = { title: nextTitle, paragraphs: [], explicitTitle: false };
    chapters.push(current);
  };

  beginChapter(docTitle);

  for (const block of cleaned) {
    if (block.kind === 'chapter') {
      if (current.paragraphs.length === 0 && chapters.length === 1 && current.title === docTitle) {
        current.title = block.title;
      } else {
        beginChapter(block.title);
      }
      current.explicitTitle = true;
      continue;
    }

    if (HEADING.test(block.kind) && Number(block.kind[1]) <= 2) {
      if (current.paragraphs.length > 0) {
        beginChapter(block.text);
      } else if (!current.explicitTitle && current.title === docTitle) {
        current.title = block.text;
      }
    }

    const sentences = splitSentences(block.text);
    if (!sentences.length) continue;
    current.paragraphs.push({ kind: block.kind, sentences });
  }

  const finalChapters = chapters.filter((chapter) => chapter.paragraphs.length > 0);
  if (!finalChapters.length) throw new Error('No readable text was found.');

  const contentChapters = [];
  const segments = [];
  let segmentIndex = 0;
  let wordCount = 0;

  finalChapters.forEach((chapter, chapterIndex) => {
    const paragraphs = [];
    chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
      const sentenceObjects = paragraph.sentences.map((text) => {
        const segment = {
          i: segmentIndex,
          chapterIndex,
          paragraphIndex,
          kind: paragraph.kind,
          text
        };
        segmentIndex += 1;
        segments.push(segment);
        return { i: segment.i, text };
      });
      paragraphs.push({ kind: paragraph.kind, sentences: sentenceObjects });
      wordCount += paragraph.sentences.join(' ').split(/\s+/).filter(Boolean).length;
    });
    contentChapters.push({ title: chapter.title, paragraphs });
  });

  const plainTextLines = [docTitle];
  if (docAuthor) plainTextLines.push(`by ${docAuthor}`);
  plainTextLines.push('');

  finalChapters.forEach((chapter, chapterIndex) => {
    const firstParagraph = chapter.paragraphs[0];
    const firstText = firstParagraph?.sentences.join(' ') || '';
    const hasTitleHeading =
      firstParagraph &&
      /^h[1-2]$/.test(firstParagraph.kind) &&
      normalizeForCompare(firstText) === normalizeForCompare(chapter.title);
    const isDocumentTitle =
      chapterIndex === 0 &&
      normalizeForCompare(chapter.title) === normalizeForCompare(docTitle);

    if (!hasTitleHeading && !isDocumentTitle) plainTextLines.push(chapter.title, '');

    for (const paragraph of chapter.paragraphs) {
      const text = paragraph.sentences.join(' ');
      if (HEADING.test(paragraph.kind)) {
        plainTextLines.push(`${'#'.repeat(Number(paragraph.kind[1]))} ${text}`, '');
      } else if (paragraph.kind === 'li') {
        plainTextLines.push(`- ${text}`, '');
      } else if (paragraph.kind === 'quote') {
        plainTextLines.push(`> ${text}`, '');
      } else {
        plainTextLines.push(text, '');
      }
    }
  });

  const content = {
    chapters: contentChapters,
    segmentCount: segments.length,
    wordCount
  };

  return {
    title: docTitle,
    author: docAuthor,
    content,
    segments,
    plainText: plainTextLines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n',
    wordCount
  };
}
