import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDocument, splitSentences } from '../server/normalize.js';

test('splits sentences without losing punctuation', () => {
  assert.deepEqual(splitSentences('One thing. Two things! Three?'), [
    'One thing.',
    'Two things!',
    'Three?'
  ]);
  assert.deepEqual(splitSentences('No punctuation here'), ['No punctuation here']);
});

test('splits an overly long unpunctuated run at word boundaries', () => {
  const text = `${'word '.repeat(220)}end`;
  const sentences = splitSentences(text);
  assert.ok(sentences.length >= 2);
  assert.ok(sentences.every((sentence) => sentence.length <= 700));
});

test('builds chapters from headings and drops a duplicate title heading', () => {
  const result = normalizeDocument({
    title: 'The Tides',
    author: 'M. Rivera',
    blocks: [
      { kind: 'h1', text: 'The Tides' },
      { kind: 'p', text: 'Intro one. Intro two.' },
      { kind: 'h2', text: 'Why the timing drifts' },
      { kind: 'p', text: 'It takes the Moon longer each day.' },
      { kind: 'li', text: 'Spring tides follow new moons.' },
      { kind: 'quote', text: 'The tide keeps its own schedule.' }
    ]
  });

  assert.equal(result.content.chapters.length, 2);
  assert.equal(result.content.chapters[0].title, 'The Tides');
  assert.equal(result.content.chapters[1].title, 'Why the timing drifts');
  assert.equal(result.segments.length, 6);
  assert.equal(result.segments[0].text, 'Intro one.');
  assert.equal(result.segments[0].chapterIndex, 0);
  assert.equal(result.segments[3].chapterIndex, 1);
  assert.match(result.plainText, /^The Tides\nby M\. Rivera/);
  assert.equal((result.plainText.match(/The Tides/g) || []).length, 1);
  assert.match(result.plainText, /## Why the timing drifts/);
});

test('honours explicit chapter markers without inventing empty chapters', () => {
  const result = normalizeDocument({
    title: 'Test Book',
    blocks: [
      { kind: 'chapter', title: 'Chapter One' },
      { kind: 'p', text: 'First chapter text.' },
      { kind: 'chapter', title: 'Chapter Two' },
      { kind: 'p', text: 'Second chapter text.' }
    ]
  });

  assert.deepEqual(
    result.content.chapters.map((chapter) => chapter.title),
    ['Chapter One', 'Chapter Two']
  );
  assert.equal(result.segments.length, 2);
});

test('rejects documents with no readable blocks', () => {
  assert.throws(
    () => normalizeDocument({ title: 'Empty', blocks: [] }),
    /No readable text/
  );
});
