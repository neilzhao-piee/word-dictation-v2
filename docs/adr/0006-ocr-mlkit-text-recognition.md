# 6. OCR via @capacitor-mlkit/text-recognition (bundled ML Kit v2 models)

Date: 2026-11-04. Status: accepted.

Context: the OCR step needs on-device printed-text OCR that works in airplane mode. Rejected: `@capacitor-community/image-to-text` (older Tesseract line), `@pantrist/capacitor-plugin-ml-kit-text-recognition` (Capacitor 5 era). Chosen: `@capacitor-mlkit/text-recognition` 8.2.2 (Capawesome/robingenz), peer `@capacitor/core >=8.0.0`.

Key facts (verified from the installed package): method is `processImage({ path, script })` returning `{ text, blocks }` — there is no base64/image option, so a file path is required; `Script.Latin` is the string literal `"LATIN"` (native proxies expose no enum objects, same trap as camera `resultType`); ML Kit `com.google.mlkit:text-recognition` 16.0.1 script models are bundled in the APK at build time — no runtime download, airplane-mode compatible; each script model adds several MB to the APK.

Flow: camera dataUrl -> `Filesystem.writeFile` (Directory `"CACHE"`, base64 payload) -> `processImage({ path: written.uri, script: 'LATIN' })` -> words via `_cleanWords` land in the parent-confirm chip gate unchanged -> `Filesystem.deleteFile` in `finally`. The photo is never persisted (ADR-0001); only a transient cache file exists for the duration of recognition. OCR failure or absence (browser preview) rejects and the UI shows `errors.ocr` with manual entry as a first-class path.

Consequences: `@capacitor/filesystem` becomes a runtime dependency; iOS packaging will need CocoaPods (the plugin does not support SPM) — iOS is phase 3 and can also fall back to Apple Vision; handwriting grading policy belongs to ADR-0004, not this adapter.
