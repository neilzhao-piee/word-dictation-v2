// Deployment config for the optional cloud OCR relay (docs/OCR-RELAY.md).
//
// This file is the ONLY place a relay address and its shared token belong in a
// build -- committed empty so the published source carries no private endpoint.
// Fill it in locally and keep it out of the commit:
//   git update-index --skip-worktree www/js/relay-config.js
// Per-device alternative: Settings > recognition server address / token (the
// settings store wins over this file). Leaving the address empty means no cloud
// channel at all: recognition is on-device only (ADR-0011).
window.WD_RELAY = { url: '', token: '' };
