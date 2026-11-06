# ADR 0010: Cloud OCR via a self-hosted relay (Azure AI Vision Read 3.2)

Date: 2026-11-05. Status: Accepted — device-verified 2026-11-06.
Amended by ADR-0011: the relay gained a public HTTPS hostname + shared token (2026-11-06).

Amends ADR-0001's "everything offline" scope **for the OCR step only**. Every other
invariant is untouched: the parent-confirm chip gate, one-word-at-a-time TTS,
manual entry as a first-class path, and local history/ISO-week stats all remain fully offline.

## Context

On-device ML Kit Text Recognition v2 (ADR-0006) is print-tuned. On a child's
handwritten word list it misreads roughly half the words even after the enhancement
pipeline shipped in `4cae383`; the user's device verdict (2026-11-05, verbatim):
"本地识别没法用，改成云端api识别吧，有没有推荐的免费provider？". The user chose Azure AI
Vision (Read) from the offered options — free tier F0 gives 5,000 transactions/month
against a usage of ~4–8 photos/week, and the Read API carries handwriting support
with per-line handwritten classification. The `.45:8080` multimodal model (v1's
keyless OCR channel) and Google Vision / AWS Textract were considered and not chosen.

## Decision

- The phone POSTs the photo as a base64 data URL to a thin relay you run yourself
  (`scripts/ocr-relay.py`, packaged as `scripts/wd-ocr.service`, port 8093 by
  default — see `docs/OCR-RELAY.md`). The relay forwards the raw image bytes to
  `POST {endpoint}/vision/v3.2/read/analyze` (`Ocp-Apim-Subscription-Key` header)
  and returns the Azure analyzeResult JSON verbatim; it handles the 202 +
  `Operation-Location` polling loop itself.
- The Azure key lives only in the relay's environment file (`/etc/wd-ocr.env`,
  root 0600 on the relay host) and never in the APK, the repo, IndexedDB, or the
  relay's logs. The phone stores only the relay URL, supplied at build time in
  `www/js/relay-config.js` or per device in Settings — never committed (ADR-0013).
- Photos stay transient end-to-end (ADR-0001): the relay holds image bytes in memory
  only, writes nothing to disk, and logs method/path/status — never bodies.
- Recognition order: cloud (when a relay address is configured and the toggle is
  on — ADR-0013) -> local ML Kit fallback
  (ADR-0006 pipeline, enhancement included) -> manual entry chips on rejection
  (`errors.ocr`). Azure receives the **original** photo; the contrast/unsharp
  enhancement exists for ML Kit and is not applied on the cloud path.
- The relay answers CORS (`Access-Control-Allow-Origin: *`) so the WebView can call
  it without CapacitorHttp. The WebView origin is `http://localhost`
  (`server.androidScheme: "http"`, `allowCleartextTraffic: true` already set in
  `capacitor.config.json`), so this is plain http->http on the LAN: no mixed content.

## Consequences

- The OCR step gains a network dependency. History, stats, TTS, grading and the chip
  gate remain fully offline; with no relay address, or when the relay is unreachable,
  the attempt fails fast and the app falls back to local recognition automatically —
  never a hard failure.
- An unconfigured relay (no key yet) answers 503 `relay-not-configured` and the app
  behaves exactly like before this ADR.
- One photo = one Azure transaction; F0 quota is ample. The key is single-purpose
  (Computer Vision single-service, F0 pricing tier) and revocable in the Azure portal.
- Microsoft states v3.2 GA Read receives no further model updates (future work goes
  to "OCR for images v4.0" / Document Intelligence). v3.2 is still the F0 Read path
  today; a switch is a future ticket, not a blocker.
