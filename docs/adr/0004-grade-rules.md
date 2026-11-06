# 4. Grading rules carried from v1, algorithm deliberately replaced

Date: 2026-11-04. Status: accepted.

Context: v1 graded with Python `difflib.get_close_matches` (SequenceMatcher) at cutoff 0.55. JS has no equivalent builtin; Levenshtein ratio is simple, fast, and testable.

Decision: keep the product rule — normalized comparison (trim, lowercase, strip punctuation) and candidate acceptance at ratio >= 0.55 — but implement similarity as `1 - levenshtein/max(len)`. Deviation from SequenceMatcher is intentional and pinned by `tests/grade.test.mjs` boundary cases (horse/house in, cat/dog out).

Consequences: boundary words may differ from v1 in edge cases; tests are the arbiter. Only exact (post-norm) matches count as correct; fuzzy matches are surfaced as mistakes with the nearest expected word.
