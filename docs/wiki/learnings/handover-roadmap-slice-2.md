---
type: Learning
title: "Handover roadmap status: 4 of ~11 items done — next slice is F2 + R2"
description: Second scorecard review: R1 (self-contained recap), F1 (init data-loss fix) and curator fallback are done; still open: F2, R2–R8, update check, tests. Next slice: F2 + R2.
tags: [roadmap, backlog, project-status, prioritization]
timestamp: "2026-11-16T09:19:20.914Z"
---

# Handover roadmap status: 4 of ~11 items done — next slice is F2 + R2

As of the second "did we implement all improvements?" scorecard (2026-11-16), **~4 of the ~11 planned items are done**, plus the user-requested disconnect/reconnect extra. This supersedes both the earlier 1-of-11 snapshot previously recorded in this file and the interim slice-done note ([[handover-roadmap-slice-1]]), which retains the slice's commit/rollback and verification details.

**Implemented:**
- Wiki bundle content (overview, glossary, file-tree descriptions)
- Disconnect/reconnect (user-requested extra — agent-home state keyed per cwd)
- **R1** — recap fully self-contained: single in-process completion call via `modelRegistry.complete`, JSON-out → deterministic writes through the `noteInto`/`notePage` funnel; no agentman, no prompt copying
- **F1** — re-init data-loss fixed: `initBundle` is now ensure-semantics (adds missing surfaces only, authored content never overwritten, `last_updated.md` never reset) — resolves [[wiki-init-data-loss]]
- Curator fallback — `/wiki:update` + staleness prompts fall back to an in-session update when agentman is absent

**Still open:**
- **F2** — `okf_version` migration layer (schema updates reaching existing bundles) — see [[okf-version-never-checked]]
- **R2** — session journal + resume card ("last time we were mid-X")
- **R3** — token-budgeted, ranked injection (nav map still inlined wholesale)
- **R4** — git-aware targeted injection ("3 learnings apply to your recent files")
- **R5** — ranked `wiki_search` (still a substring scan)
- **R6** — dedupe-at-write, lifecycle, injection governors
- **R7** — `/wiki:digest`, `/wiki:stats`, bootstrap import, viewer search
- **R8** — global (agent-home) memory tier (deliberately last)
- Optional daily, ask-first "new version available" update check
- Tests: still zero (only the 21-error tsc baseline)

**Pending runtime verification:** tsc and parser smoke tests pass, but the recap e2e (fresh session, real turn → note file) has not run yet. That is the handover's verification standard (see [[new-commands-need-reload]]) and gates building R2 on top of the recap.

**Recommended next slice (proposed, awaiting user go-ahead):** F2 + R2 — R2 is the first feature that genuinely needs F2's migration layer to reach existing bundles, so they share machinery.

This is point-in-time; update or delete once items land.
