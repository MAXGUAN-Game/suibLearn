import assert from 'node:assert/strict';
import test from 'node:test';
import { getActiveSubtitleIndex } from '../src/utils/subtitleSelection.ts';
import type { SubtitleLine } from '../src/types/index.ts';

// Real timings from the overlapping Cream Puffs note and the next three cues.
const creamPuffs: SubtitleLine[] = [
  { start: 213.72, end: 221.63, text: '', translated_text: '[ Cream Puffs 意为泡芙或者娘娘腔 ]' },
  { start: 217.13, end: 217.97, text: 'Excuse me.' },
  { start: 217.97, end: 219.87, text: 'This baby would have grown up in a crowded orphanage' },
  { start: 219.87, end: 221.63, text: 'if it wasn\'t for us "Cream puffs."' },
];

test('a long translated note does not steal any of the following dialogue cues', () => {
  assert.equal(getActiveSubtitleIndex(creamPuffs, 217.13), 1);
  assert.equal(getActiveSubtitleIndex(creamPuffs, 217.5), 1);
  assert.equal(getActiveSubtitleIndex(creamPuffs, 218.5), 2);
  assert.equal(getActiveSubtitleIndex(creamPuffs, 220.2), 3);
});

test('shared boundaries select the new cue and exclude the final endpoint', () => {
  assert.equal(getActiveSubtitleIndex(creamPuffs, 213.72), 0);
  assert.equal(getActiveSubtitleIndex(creamPuffs, 217.97), 2);
  assert.equal(getActiveSubtitleIndex(creamPuffs, 219.87), 3);
  assert.equal(getActiveSubtitleIndex(creamPuffs, 221.63), -1);
});

test('a translated note remains available when it is the only active content', () => {
  assert.equal(getActiveSubtitleIndex(creamPuffs, 215), 0);
  assert.equal(getActiveSubtitleIndex([
    { start: 0, end: 10, text: '   ', translated_text: '只有译文' },
  ], 4), 0);
});

test('latest starting dialogue wins even if a later note is active', () => {
  const cues: SubtitleLine[] = [
    { start: 1, end: 12, text: 'Earlier dialogue' },
    { start: 5, end: 10, text: 'Later dialogue' },
    { start: 7, end: 9, text: '', translated_text: 'An even later note' },
  ];
  assert.equal(getActiveSubtitleIndex(cues, 8), 1);
  assert.equal(getActiveSubtitleIndex(cues, 10), 0);
});

test('selection does not depend on chronological array order', () => {
  const cues = [creamPuffs[3], creamPuffs[1], creamPuffs[0], creamPuffs[2]];
  assert.equal(getActiveSubtitleIndex(cues, 217.5), 1);
  assert.equal(getActiveSubtitleIndex(cues, 217.97), 3);
  assert.equal(getActiveSubtitleIndex(cues, 220), 0);
});

test('equal starting times keep the first dialogue deterministically', () => {
  const cues: SubtitleLine[] = [
    { start: 1, end: 5, text: '', translated_text: 'Note' },
    { start: 1, end: 5, text: 'First dialogue' },
    { start: 1, end: 5, text: 'Duplicate dialogue' },
  ];
  assert.equal(getActiveSubtitleIndex(cues, 2), 1);
});

test('latest translated-only cue wins when no dialogue is active', () => {
  const cues: SubtitleLine[] = [
    { start: 4, end: 10, text: '\n\t', translated_text: 'Later note' },
    { start: 1, end: 10, text: '', translated_text: 'Earlier note' },
  ];
  assert.equal(getActiveSubtitleIndex(cues, 6), 0);
});

test('whitespace-only originals are notes and entirely empty cues are ignored', () => {
  const cues: SubtitleLine[] = [
    { start: 0, end: 10, text: 'Dialogue' },
    { start: 2, end: 10, text: ' \n\t ', translated_text: 'Note' },
    { start: 3, end: 10, text: ' ', translated_text: '  ' },
  ];
  assert.equal(getActiveSubtitleIndex(cues, 5), 0);
  assert.equal(getActiveSubtitleIndex(cues.slice(1), 5), 0);
  assert.equal(getActiveSubtitleIndex(cues.slice(2), 5), -1);
});

test('gaps and empty or invalid time ranges have no active subtitle', () => {
  const cues: SubtitleLine[] = [
    { start: 1, end: 2, text: 'First' },
    { start: 4, end: 5, text: 'Second' },
    { start: 3, end: 3, text: 'Zero length' },
    { start: 8, end: 7, text: 'Reversed' },
  ];
  assert.equal(getActiveSubtitleIndex(cues, 0), -1);
  assert.equal(getActiveSubtitleIndex(cues, 2), -1);
  assert.equal(getActiveSubtitleIndex(cues, 3), -1);
  assert.equal(getActiveSubtitleIndex(cues, 7.5), -1);
  assert.equal(getActiveSubtitleIndex([], 1), -1);
  assert.equal(getActiveSubtitleIndex(cues, Number.NaN), -1);
});
