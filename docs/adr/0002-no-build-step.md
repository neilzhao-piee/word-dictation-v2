# 2. No build step for the web layer

Date: 2026-11-04. Status: accepted.

Context: the app is plain HTML/JS/CSS; Capacitor is only a shell. A bundler would add tooling churn without needing it at this size, and "open www/ and it runs" makes review and on-device debugging trivial.

Decision: `www/` ships as plain scripts and JSON files. No bundler, no transpiler, no framework. ES5-compatible style in browser files so a WebView runs them unmodified; Node-only tests import modules via `module.exports` dual export.

Consequences: imports are `<script>` tags with explicit order; i18n dictionaries are fetched JSON; scaling past this size requires revisiting this ADR.
