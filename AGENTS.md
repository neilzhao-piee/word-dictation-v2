# word-dictation-v2 — agent notes

- Product rules (never violate): chip gate before dictation; one word at a time with explicit confirm; the flow must work offline and manual entry must always be available.
- No build step: `www/` is plain scripts + JSON. Browser JS stays WebView-friendly.
- Grading changes must stay pinned by `tests/grade.test.mjs`; OCR parsing by `tests/ocr.test.mjs`; storage migrations by `tests/storage.test.mjs`. Run `npm test` before claiming a change works.
- i18n: `en` is the source language; `{name}` placeholders are never translated; all locale files must have identical key sets.
- Domain vocabulary lives in `GLOSSARY.md`; decisions in `docs/adr/`.
- Issue tracker: GitHub Issues (see `docs/agents/issue-tracker.md`); triage roles per `docs/agents/triage-labels.md`.
- Privacy invariants: photos are transient (never written to disk by the app or the relay, never logged); history stays in IndexedDB on the device; cloud OCR is optional and degradable, never required.
- **Never commit a relay address or token.** They belong in `www/js/relay-config.js` (committed as an empty template — mark yours with `git update-index --skip-worktree`) or in the per-device settings store (`ocrCloudUrl` / `ocrCloudToken`). See `docs/adr/0013-relay-config-is-deployment-data.md`.
- Android build: needs Android SDK platform 35 / build-tools 35.0.0; run `scripts/patch-android.sh` after `npx cap sync` (status-bar colours, five-locale `locales_config.xml`). `npm run sync` = `npx cap sync`.
