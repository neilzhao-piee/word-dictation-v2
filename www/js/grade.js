// grade: pure functions, no DOM, no imports. Also runs under plain Node for tests.
// Grading rule ported from v1: norm() + close-match with cutoff 0.55.
// Similarity metric is 1 - levenshtein/max(len); this deviates slightly from Python
// difflib.get_close_matches (SequenceMatcher) — documented and pinned by tests/grade.test.mjs.
(function () {
  'use strict';

  const CUTOFF = 0.55;

  function norm(s) {
    return String(s == null ? '' : s)
      .trim()
      .toLowerCase()
      .replace(/[.,;:!?'"`´]/g, '')
      .replace(/\s+/g, ' ');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function ratio(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    return 1 - levenshtein(a, b) / maxLen;
  }

  // Like difflib.get_close_matches(word, possibilities, n, cutoff):
  // returns up to n candidates from `possibilities` sorted best-first,
  // keeping only those with ratio >= cutoff.
  function closestMatch(word, possibilities, n, cutoff) {
    n = n == null ? 1 : n;
    cutoff = cutoff == null ? CUTOFF : cutoff;
    const w = norm(word);
    if (!w) return [];
    const scored = [];
    const seen = new Set();
    for (const p of possibilities) {
      const pn = norm(p);
      if (!pn || seen.has(pn)) continue;
      seen.add(pn);
      const r = ratio(w, pn);
      if (r >= cutoff) scored.push({ word: pn, ratio: r });
    }
    scored.sort(function (x, y) { return y.ratio - x.ratio || x.word.localeCompare(y.word); });
    return scored.slice(0, n);
  }

  // Grade an answer sheet: expected + given word arrays -> per-word results.
  // exact = normalized strings equal; fuzzy = closest expected word within cutoff;
  // unmatched = nothing close enough.
  function gradeAnswers(expected, given) {
    const expectedNorm = expected.map(norm).filter(Boolean);
    const results = [];
    for (const raw of given) {
      const g = norm(raw);
      if (!g) continue;
      if (expectedNorm.includes(g)) {
        results.push({ given: g, status: 'exact', expected: g, ratio: 1 });
        continue;
      }
      const matches = closestMatch(g, expectedNorm, 1, CUTOFF);
      if (matches.length) {
        results.push({ given: g, status: 'fuzzy', expected: matches[0].word, ratio: matches[0].ratio });
      } else {
        results.push({ given: g, status: 'unmatched', expected: null, ratio: 0 });
      }
    }
    const correct = results.filter(function (r) { return r.status === 'exact'; }).length;
    return {
      results: results,
      total: expectedNorm.length,
      correct: correct,
      mistakes: results.filter(function (r) { return r.status !== 'exact'; }),
    };
  }

  const Grade = { norm, levenshtein, ratio, closestMatch, gradeAnswers, CUTOFF };
  if (typeof window !== 'undefined') window.Grade = Grade;
  if (typeof module !== 'undefined' && module.exports) module.exports = Grade;
})();
