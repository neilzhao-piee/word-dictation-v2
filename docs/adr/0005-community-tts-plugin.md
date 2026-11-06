# 5. TTS via @capacitor-community/text-to-speech

Date: 2026-11-04. Status: accepted (supersedes the draft's `@capacitor/text-to-speech`, which does not exist in npm).

Context: pronunciation variants (en-AU/en-GB/en-US) need native TTS control; the web fallback (speechSynthesis) exists but voice availability varies.

Decision: native path is `@capacitor-community/text-to-speech` (v8 line, plugin id `TextToSpeech`), called as `speak({ text, lang, rate: 0.9 })` — note `lang`, not `language`. tts.js keeps its own Web SpeechSynthesis fallback for plain-browser runs and rejects `no-tts` / `no-english-voice` so the UI can show `errors.tts` rather than mis-pronounce silently.

Consequences: one extra community dependency to review and version-pin; Android may need voice data installed (plugin exposes `openInstall()`).
