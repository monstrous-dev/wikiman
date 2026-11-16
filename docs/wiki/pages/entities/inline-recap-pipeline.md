---
type: Entity
title: Inline Recap Pipeline
description: "The end-of-turn recap subsystem of `index.ts`: after each coding turn, one"
tags: [recap, pipeline, index-ts, background]
timestamp: "2026-11-16T09:18:36.521Z"
---

# Inline Recap Pipeline

The end-of-turn recap subsystem of `index.ts`: after each coding turn, one
in-process LLM completion mines the transcript and writes decisions, rules,
learnings, preferences, and pages into `docs/wiki/` — with no subagent and no
agentman dependency.

## Why it matters

It makes the wiki self-maintaining on every install (fresh installs included) and
guarantees every LLM-proposed wiki write goes through the same validated funnel as
the `wiki_note_*` tools — nothing the model says reaches disk unchecked.

## Details

- **Location**: `index.ts` — `runInlineRecap()` (scheduled debounced off
  `agent_end`), `parseRecapNotes()` (fence/prose-tolerant JSON extraction), recap
  prompt shipped in-package.
- **Interface**: input = the turn transcript; output = a validated note list fed to
  `noteInto`/`notePage` (the same funnel as `wiki_note_*`). 45 s timeout,
  `randomUUID` sessionId, 2-attempt error-adaptive retry, per-note try/catch.
- **Failure behavior**: silent degradation with no model/auth; `.catch` on the
  debounced timer (session-teardown safety); model captured synchronously in
  `agent_end` before the timer.
- **Configuration**: debounce/suppress machinery unchanged from the handover;
  `/wiki:disconnect` pauses it per folder.

## Relationships

- [recap-runs-in-process-not-via-agentman-subagent](../../decisions/recap-runs-in-process-not-via-agentman-subagent.md) — the decision behind it:
  why in-process, alternatives rejected
- `noteInto`/`notePage` — the only write path; identical handling to the
  `wiki_note_*` tools
- [wiki-init-is-ensure-semantics-never-overwrites-authored-cont](../../decisions/wiki-init-is-ensure-semantics-never-overwrites-authored-cont.md) — sibling
  safety change in the same slice (commit `ec1034a`)

## Lifecycle

- First added: 2026-11-16, commit `ec1034a` — replaced the agentman subagent
  spawn (`agents/wiki-recap.md` remains as a legacy copy).
- Significant changes: runtime testing pending (fresh session or `/reload`).
