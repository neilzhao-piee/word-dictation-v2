# 3. IndexedDB as the data layer

Date: 2026-11-04. Status: accepted.

Context: we want a native SQL plugin for simplicity, but no maintained Capacitor SQLite plugin fits Phase 1 (store packaging must stay light).

Decision: storage.js wraps IndexedDB (`worddict-v2`, version 1) with stores `lists`, `sessions`, `wrongWords` (keyPath `word`, index `updatedAt`), `settings`. A single `tx()` promise wrapper is the only IndexedDB surface; the rest of the app never touches IDB directly.

Consequences: export is a JSON dump (`exportJson()`), import is deferred; schema changes mean bumping DB_VERSION with an upgrade handler.
