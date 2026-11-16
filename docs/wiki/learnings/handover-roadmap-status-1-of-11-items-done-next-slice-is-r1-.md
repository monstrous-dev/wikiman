---
type: Learning
title: "Handover roadmap status: 1 of 11 items done — next slice is R1 + F1 + curator inlining"
description: As of the "did we implement all improvements?" scorecard review, only **1 of 11** backlog items is done.
tags: [roadmap, backlog, project-status, prioritization]
timestamp: "2026-11-16T09:01:22.630Z"
---

# Handover roadmap status: 1 of 11 items done — next slice is R1 + F1 + curator inlining

As of the "did we implement all improvements?" scorecard review, only **1 of 11** backlog items is done.

**Implemented:**
- Wiki bundle content (overview, glossary, file-tree descriptions)
- Disconnect/reconnect (`/wiki:disconnect` + `/wiki:reconnect`, agent-home state keyed per cwd)

**Not implemented — handover roadmap R1–R8:**
- R1 inline the recap, kill the agentman dependency (top priority — the flagship end-of-turn recap silently no-ops without it)
- R2 session journal / resume card
- R3 ranked, token-budgeted injection
- R4 git-aware targeted injection
- R5 ranked `wiki_search` (still a substring scan)
- R6 dedupe-at-write, lifecycle, governors
- R7 `/wiki:digest`, `/wiki:stats`, bootstrap import, viewer search
- R8 global memory tier

**Also open from the architecture review:**
- F1 `/wiki:init` data-loss bug — see [[wiki-init-on-an-existing-bundle-destroys-authored-content-on]]
- F2 `okf_version` written but never read, so no migration path — see [[okf-version-frontmatter-is-stamped-at-scaffold-but-never-con]]
- Update propagation mechanisms (extension update check, bundle migrations, curator prompt inlining) — decision recorded, not built
- Tests: zero (only the type-check config with its 21-error peer-dep baseline)

**Recommended next slice (proposed, awaiting user go-ahead):** R1 + F1 + curator prompt inlining — they share machinery, and F1 is a genuine data-loss bug sitting in the code today.

This is point-in-time; update or delete once items land.
