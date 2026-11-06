# ADR 0013: A relay address and token are deployment data, not source data

Date: 2026-11-06. Status: Accepted. Amends ADR-0011 (the compile-time default
relay endpoint) and narrows ADR-0010's "default on" for cloud OCR.

## Context

ADR-0011 put a real public hostname and a real shared token into `www/js/ocr.js`
and hid the fields from Settings. That was fine for a private family build, but it
is exactly what makes a source tree unpublishable: the token also lives in every
commit that touched that file, so flipping the repository public would leak it
while all installed APKs still carry it. Rewriting history was rejected — the
option to keep a private, full-history copy is worth more than a clean public log.

The app is also meant to be useful to *other* families: a hardcoded endpoint from
someone else's domain would either 404 for them or silently spend a stranger's
Azure quota.

## Decision

- The source carries **no** relay address and **no** token. `www/js/relay-config.js`
  is committed as an empty template (`{ url: '', token: '' }`) and is the one place
  a build may hardcode them (operators keep their filled-in copy out of git with
  `git update-index --skip-worktree`).
- The per-device settings store wins: `ocrCloudUrl` / `ocrCloudToken` (the Settings
  screen gained the two inputs back, plus the existing on/off checkbox). Settings
  override the file, so one APK can be repointed without a rebuild.
- **No URL means no cloud channel.** `cloudSettings()` requires a non-empty address
  before `extractWords()` will try the relay; with none the app goes straight to
  on-device recognition. The old "default on" therefore becomes "on when configured".
- `X-WD-Token` is sent only when a token is configured, so LAN-only relays and unit
  probes keep working unchanged.
- The committed template keeps `tests/ocr.test.mjs` hermetic: five assertions pin
  the empty-config, configured-build, settings-override and toggle-off paths.

## Consequences

- The published repository contains no personal endpoint, no token, and no baked-in
  third-party dependency; a fresh build is on-device-only until you configure a relay.
- The private deployment keeps working exactly as before: it fills in its own
  `relay-config.js` (or sets the two values on the device).
- Anyone extracting a token from a shipped APK still gets the F0-quota exposure
  described in ADR-0011; rotating it means editing the relay env file and the two
  config values, no release of the app logic.
- Cost: two more settings fields (five locales' worth of new strings) and one more
  script tag; the WebView origin is `http://localhost`, so a user-entered https
  endpoint is a normal CORS request the relay already allows.
