import test from 'node:test';
import assert from 'node:assert/strict';
import { speakableText } from '../server/normalize.js';

test('drops bullets and shapes that voices read as names', () => {
  assert.equal(speakableText('● Recording now'), 'Recording now');
  assert.equal(speakableText('• one\n• two'), 'one\ntwo');
  assert.equal(speakableText('■ Stop ▶ Play'), 'Stop, Play');
});

test('drops emoji, stars, ticks and box drawing', () => {
  assert.equal(speakableText('Shipped 🚀 today ✅'), 'Shipped today');
  assert.equal(speakableText('★★★★☆ rating'), 'rating');
  assert.equal(speakableText('─────\nSection'), 'Section');
});

test('turns separators into short pauses', () => {
  assert.equal(speakableText('Home · Pricing · Docs'), 'Home, Pricing, Docs');
  assert.equal(speakableText('Plans | Teams'), 'Plans, Teams');
  assert.equal(speakableText('Logs → Metrics → Traces'), 'Logs, Metrics, Traces');
});

test('keeps words, numbers, money and ordinary punctuation', () => {
  const plain = 'It costs $12.50, about 20% less & ships on 3 May. Email me@example.com?';
  assert.equal(speakableText(plain), plain);
  assert.equal(speakableText("Don't touch the café's crème brûlée."), "Don't touch the café's crème brûlée.");
});

test('a piece with only symbols becomes silence, not an error', () => {
  assert.equal(speakableText('● ● ●'), '');
  assert.equal(speakableText('   '), '');
});
