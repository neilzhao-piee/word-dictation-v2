# Issue tracker: GitHub Issues

Issues, specs and wayfinding maps for this repo live as **GitHub Issues** on
`neilzhao-piee/word-dictation-v2` (use `gh issue` / `gh label`, or the web UI).

## Conventions

- One **spec** per feature: an issue titled `spec: <feature>` with the specification
  in the body; label the sub-issues it spawns with `feature:<feature-slug>` so a
  feature's work can be listed with one filter (`gh issue list -l feature:<slug>`).
- One **ticket** per implementation issue; refer to it by issue number (`#123`), not
  by a hand-rolled `NN` prefix, so cross-references stay clickable.
- Triage state is a **label**, not a line in the body: `needs-triage`, `needs-info`,
  `ready-for-agent`, `ready-for-human`, `wontfix` (see `triage-labels.md`).
- Discussion appends as issue comments — never rewrite an existing comment; add a
  new one, so the history stays auditable.
- Closing is a maintainer action: an agent may set `in review` by commenting with its
  execution report and leaving the issue open, but never closes an issue itself.

## When a skill says "publish to the issue tracker"

```sh
gh issue create --title "..." --body-file /tmp/issue.md --label needs-triage
```

Include: what/why, acceptance criteria, and the files or areas expected to change.
Never paste secrets, tokens, private hostnames or customer data into an issue — see
ADR-0013 for how relay configuration is handled.

## When a skill says "fetch the relevant ticket"

```sh
gh issue view <number> --comments
```

Read every comment before acting: comments are the newest requirement. If a comment
says to wait or hold, stop and report instead of changing the issue state.

## Wayfinding operations

Used by `/wayfinder`. The **map** is one issue with one **child** issue per ticket.

- **Map**: an issue titled `map: <effort>`, labelled `wayfinder:map`. Its body holds
  the Notes / Decisions-so-far / Fog sections and a task list linking every child.
- **Child ticket**: an issue labelled `wayfinder:research` / `wayfinder:prototype` /
  `wayfinder:grilling` / `wayfinder:task`, linked as a sub-issue (or listed under the
  map's task list); the question is the body.
- **Blocking**: GitHub's native issue dependencies, or a `Blocked by: #12, #15` line
  at the top of the body when dependencies are not available. A ticket is unblocked
  when every issue it lists is closed.
- **Frontier**: `gh issue list --label wayfinder:research,wayfinder:task --state open`
  filtered by no assignee and no open blocker; the lowest issue number wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` **before** any work.
- **Resolve**: comment the answer under a `## Answer` heading, close the issue only
  when the maintainer has confirmed, then append a one-line pointer (gist + link) to
  the map's Decisions-so-far section.
