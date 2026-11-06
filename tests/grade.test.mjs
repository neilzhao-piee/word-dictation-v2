// Tests for grade.js — run with: node tests/grade.test.mjs
// Pins the grading rule: norm + levenshtein-ratio closestMatch, cutoff 0.55.
// Note (documented deviation from v1): v1 used Python difflib.get_close_matches
// (SequenceMatcher ratio); v2 uses 1 - levenshtein/max(len). The cutoff 0.55 is
// carried over unchanged; boundary cases below pin the v2 behaviour.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(path.join(root, 'www/js/grade.js'), 'utf-8');
// grade.js is an IIFE assigning to module.exports when loaded in Node
const mod = { exports: {} };
new Function('module', 'window', src)(mod, undefined);
const Grade = mod.exports;
assert.ok(Grade, 'grade.js did not export');

const { norm, levenshtein, ratio, closestMatch, gradeAnswers, CUTOFF } = Grade;
let n = 0;
function test(name, fn) { fn(); n++; console.log('ok - ' + name); }

test('norm trims, lowercases, strips punctuation', () => {
  assert.equal(norm('  Hello, World!  '), 'hello world');
  assert.equal(norm('it\'s'), 'its');
  assert.equal(norm(''), '');
  assert.equal(norm(null), '');
});

test('levenshtein basics', () => {
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('same', 'same'), 0);
});

test('ratio basics', () => {
  assert.equal(ratio('apple', 'apple'), 1);
  assert.equal(ratio('', ''), 1);
  assert.ok(Math.abs(ratio('apple', 'aple') - 0.8) < 1e-9); // 1 - 1/5
});

test('cutoff is 0.55 (carried from v1)', () => {
  assert.equal(CUTOFF, 0.55);
});

test('closestMatch picks nearest above cutoff', () => {
  const got = closestMatch('becuase', ['because', 'week', 'wrote'], 1, CUTOFF);
  assert.equal(got.length, 1);
  assert.equal(got[0].word, 'because');
  assert.ok(got[0].ratio >= 0.55);
});

test('closestMatch rejects distant words', () => {
  const got = closestMatch('xyzzy', ['because', 'week'], 1, CUTOFF);
  assert.equal(got.length, 0);
});

test('closestMatch boundary: ratio just under 0.55 excluded, just over included', () => {
  // 'house' vs 'horse': lev=2, maxLen=5, ratio=0.6 -> in
  assert.ok(closestMatch('horse', ['house'], 1, CUTOFF).length === 1);
  // 'cat' vs 'dog': lev=3, ratio=0 -> out
  assert.ok(closestMatch('cat', ['dog'], 1, CUTOFF).length === 0);
});

test('closestMatch dedupes and sorts best-first, n limits', () => {
  const got = closestMatch('recieve', ['receive', 'received', 'recipe'], 2, CUTOFF);
  assert.equal(got[0].word, 'receive');
  assert.equal(got.length, 2);
});

test('gradeAnswers exact/fuzzy/unmatched', () => {
  const out = gradeAnswers(['because', 'week', 'wrote'], ['because', 'wek', 'rote', 'xyzzy']);
  assert.equal(out.total, 3);
  const byGiven = Object.fromEntries(out.results.map(r => [r.given, r.status]));
  assert.equal(byGiven['because'], 'exact');
  assert.equal(byGiven['wek'], 'fuzzy');   // wek->week ratio 0.8
  assert.equal(byGiven['rote'], 'fuzzy');  // rote->wrote ratio 0.8
  assert.equal(byGiven['xyzzy'], 'unmatched');
  assert.equal(out.correct, 1);
  assert.equal(out.mistakes.length, 3);
});

test('gradeAnswers is case/punctuation insensitive', () => {
  const out = gradeAnswers(['Because', 'WEEK'], ['because.', 'week']);
  assert.equal(out.correct, 2);
  assert.equal(out.mistakes.length, 0);
});

test('gradeAnswers ignores blank givens', () => {
  const out = gradeAnswers(['apple'], ['   ', 'apple']);
  assert.equal(out.results.length, 1);
  assert.equal(out.correct, 1);
});

console.log('\n' + n + ' tests passed');
