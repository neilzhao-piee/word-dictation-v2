# Glossary

Single-context domain vocabulary for word-dictation-v2. Code, docs, and issues use these terms.

## Core flow

- **Word list** — the set of words for one dictation, from a photographed spelling list or manual entry. Persisted in IndexedDB store `lists`.
- **Chip gate** — the product rule that dictation never starts until the parent confirms the word chips (edited/deleted/added). Non-negotiable; enforced in `viewNew` before `#/dict`.
- **Dictation session** — one run of "one word at a time": TTS speaks a word, the child writes it, the parent taps confirm before the next word. Persisted in store `sessions`.
- **Answer sheet** — the written page photographed after dictation; input to grading.
- **Grading** — offline comparison of given answers vs expected words via `grade.js` (norm + levenshtein ratio, cutoff 0.55). "correct" counts only exact matches after norm; fuzzy hits are shown as mistakes with the nearest expected word.
- **Wrong book** — pool of words the child misspelled (`wrongWords` store, keyed by normalized word, `count` increments). "Review" view practices from it. A word graduates when written exactly correct in a later session.
- **ISO week** — history grouping window, Monday start (v1 rule carried over). Grouped client-side via `isoWeekLabel`, default timezone `Australia/Perth` (settings key `timezone`).

## Languages

- **UI language** — interface text language. Locales: `zh-CN`, `zh-TW`, `en`, `ja`, `ko`. `en` is the source language; `{name}` placeholders are never translated.
- **Pronunciation variant** — the English accent TTS uses: `en-AU` (default), `en-GB`, `en-US`. Independent from UI language; settings key `voiceVariant`.

## Engineering

- **Local-first** — recognition, grading, TTS and storage all run on the device; the app works with no network. Cloud OCR (ADR-0010) is an opt-in accelerator, never a requirement.
- **No-build** — `www/` is plain scripts + JSON, loadable as-is. No bundler/transpiler in Phase 0–1.
- **OCR adapter** — `ocr.js` seam for native on-device OCR (ML Kit Android / Vision iOS later). Absence must never block the flow: manual entry is a first-class path.
- **v1** — the earlier server-backed app (`neilzhao-piee/word-dictation`, FastAPI + SQLite, frozen). v2 ports its rules/algorithms only; no code imports across the two.
