# ADR 0012: Child profiles (one phone, several children)

Date: 2026-11-06. Status: Accepted — shipped, device-verified 2026-11-06.

## Context

The app was single-child by construction: `sessions`, `lists` and the wrong-word
book were one flat set of rows, and History / the weekly accuracy graph showed
everything mixed together. The user asked how records would be isolated when the
app is shared between two children (and, separately, across families).

Device isolation was already free: IndexedDB is per origin, so a friend who
installs the APK starts with an empty database and can never see this family's
rows. What was missing is isolation **within one phone**.

## Decision

- New `profiles` store (id, name, createdAt) and a `profileId` field on every
  `lists` / `sessions` / `wrongWords` row. Reads resolve "current profile" from
  the `profileId` setting and filter in JS (data volumes are tiny: a month of
  daily dictation is a few hundred rows).
- The first profile is deterministic: id `default`, so v1 rows — which have no
  `profileId` at all — are attributed to it (`ownedBy()` treats a missing field
  as `default`). That keeps the upgrade lossless without rewriting old rows.
- The wrong book is keyed `<profileId>:<word>` instead of `<word>`, so the same
  word can be tracked separately for each child. The v1→v2 upgrade copies the
  existing rows into `default:` ids inside the versionchange transaction.
- Settings (language, accent, cloud OCR) stay device-wide, not per profile: they
  describe the phone, not the child.
- UI: the switcher lives in Settings ("child profile" + add + rename), and Home
  shows the active profile so it is obvious whose records you are looking at.
  Adding/renaming uses `window.prompt`, which the WebView renders natively;
  profiles are named freely by the parent.

## Consequences

- Two children share one phone without sharing history, weekly stats or the
  wrong-word list. Switching profiles changes what History and Review show.
- Deleting a profile is **not** implemented yet: it would need a cascade delete
  of its rows (lists, sessions, wrong words) and a decision about what "current"
  becomes. Recorded as follow-up work.
- Sync between devices is still out of scope: records are per install. Two
  phones = two databases, even for the same child.
- The store-release story (families sharing one relay or one app backend) is
  unaffected: profiles are local organisation, not accounts.
