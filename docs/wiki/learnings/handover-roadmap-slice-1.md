---
type: Learning
title: "Handover roadmap: R1 + F1 + curator slice done (ec1034a) — next is R2 journal"
description: The **R1 + F1 + curator-inlining slice is done** — commit `ec1034a` (2026-11-16),
tags: [roadmap, backlog, project-status, prioritization]
timestamp: "2026-11-16T09:18:24.185Z"
---

# Handover roadmap: R1 + F1 + curator slice done (ec1034a) — next is R2 journal

> **Status moved on (2026-11-16T09:19Z):** the current roadmap snapshot is [[handover-roadmap-status-1-of-11-items-done-next-slice-is-r1-]] — 4 of ~11 done, next slice F2 + R2 (R2 now gated on F2's migration layer). This note keeps the slice's commit/rollback and verification details.

The **R1 + F1 + curator-inlining slice is done** — commit `ec1034a` (2026-11-16),
on top of restore-point commit `41d6d93` / tag `restore-pre-r1`
(`git reset --hard restore-pre-r1` rolls back the whole slice).

Shipped: R1 in-process recap ([[recap-runs-in-process-not-via-agentman-subagent]] —
`runInlineRecap`/`parseRecapNotes`), F1 ensure-semantics `initBundle`
([[wiki-init-is-ensure-semantics-never-overwrites-authored]]), `spawnWikiAgent`
`fallbackSteer` for `/wiki:update` + staleness prompts without agentman.

Verified statically: tsc exactly at the 21-error pre-existing baseline (0 new) and
JSON parser smoke-tested against fenced/prose/empty/garbage inputs. **Not yet
runtime-tested** — per the house gotcha this needs a fresh session or `/reload`:
1. fresh-install recap: a turn with a clear learning → note file appears +
   "wiki recap: recorded N learnings" notification
2. `/wiki:init` on this very bundle → authored overview survives
3. `/wiki:update` with agentman present vs. absent (fallback path)

Remaining backlog: R2 (session journal — will need the F2 migration layer),
R3–R5 (injection budget, git-aware injection, ranked search), R6 (dedupe
governors), R7 (`/wiki:digest`, `/wiki:stats`, viewer search), R8 (global tier).

Supersedes the earlier "1 of 11 items done" status learning.
