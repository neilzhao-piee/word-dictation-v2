# 1. Local-first: photos and grading never leave the device

Date: 2026-11-04. Status: accepted.

Context: v1 depends on a self-hosted server plus a vision model for OCR and grading. For a store-published product we need zero accounts, zero servers, and a privacy story we can state honestly in store listings.

Decision: v2 keeps word lists, photos, sessions, and grading entirely on the device (IndexedDB + local JS). No telemetry, no tracking SDK, no ads. Cloud OCR may appear later (Phase 4) only as an explicit, opt-in paid feature.

Consequences: offline acceptance test is "airplane mode full flow"; device storage is the only data store, so `exportJson()` exists from day one; handwriting OCR quality is limited with on-device models — the chip gate is the safety net.

Amended by ADR-0010 / ADR-0011 / ADR-0013: the OCR **step** may optionally call a
self-hosted relay (cloud recognition, off unless the operator configures one).
Photos are still never persisted and never sent to a third-party analytics or
storage service; recognition, grading, TTS, history and stats remain on-device
with no network.
