---
type: Decision
title: Recap runs in-process, not via agentman subagent
description: Context
tags: [recap, architecture, agentman, graceful-degradation]
status: accepted
timestamp: "2026-11-16T09:18:24.184Z"
---

# Recap runs in-process, not via agentman subagent

## Context

The end-of-turn recap originally spawned an agentman subagent (`agents/wiki-recap.md`
prompt). That made the flagship recap a silent no-op on fresh installs: without
agentman — or without the copied prompt in `~/.pi/agent/agents/` — no recap ever
ran. Handover item R1 called for inlining it.

## Choice

`runInlineRecap()` in `index.ts` replaces the subagent spawn:

- One `modelRegistry.complete()` call (hamster pattern), 45 s timeout, `randomUUID`
  sessionId, recap prompt shipped in-package.
- `parseRecapNotes()` extracts JSON fence/prose-tolerantly, drops unknown note types
  and empty fields, and **never trusts LLM-authored file paths**.
- Validated notes flow through the same `noteInto`/`notePage` funnel the
  `wiki_note_*` tools use — frontmatter, slug collisions, indexes, memory.md all
  handled identically.
- **Silent degradation** with no model/auth; 2-attempt error-adaptive retry;
  per-note try/catch so one bad note can't kill the batch.
- Debounce/suppress machinery untouched (handover requirement).

## Alternatives considered

- Keep the agentman subagent — rejected: hard dependency; fresh installs get
  nothing.
- Let the LLM write files directly from its reply — rejected: bypasses the
  frontmatter/slug/index/memory handling and trusts LLM-authored paths.

## Rationale

Self-contained means the wiki is self-maintaining on every install, not just ones
with agentman; one validated write funnel for everything entering `docs/wiki/`.

## Consequences (why the code looks this way)

- The debounced timer carries a `.catch` — a timer firing during session teardown
  must never crash the session (the session-kill gotcha).
- The model reference is captured **synchronously** in `agent_end` before the timer
  is scheduled — async context may be gone by the time it fires.
- Related slice change: `spawnWikiAgent` gained a `fallbackSteer` — `/wiki:update`
  and staleness prompts fall back to an **in-session update** with house rules
  baked into the steer prompt when agentman or the prompt copy is absent; the
  staleness delegation prompt adapts to delegate-tool absence. Same
  degrade-gracefully philosophy as the recap.

## Status

Accepted. Implemented in commit `ec1034a` (2026-11-16), on top of restore point
`41d6d93` / tag `restore-pre-r1`. Runtime testing still pending (fresh session or
`/reload`).
