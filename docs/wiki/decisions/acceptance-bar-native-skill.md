---
type: Decision
title: "Acceptance bar redefined: OKF wiki as a native LLM skill, 9/10 rubric on real transcripts"
description: Context
tags: [quality-bar, gauntlet, acceptance-criteria, native-skill, e2e-testing, roadmap]
status: accepted
supersedes: decisions/gauntlet-bar-llm-memory-e2e
timestamp: "2026-11-16T09:30:31.431Z"
---

# Acceptance bar redefined: OKF wiki as a native LLM skill, 9/10 rubric on real transcripts

## Context

The prior gauntlet bar ([[gauntlet-bar-llm-memory-e2e]]) framed "done" as three quality pillars: LLM memory, self-learning, knows-when-to-use. The user then redefined the bar in behavioral terms: **the wiki operates in OKF, and using it must be a native skill of the LLM** — judged from real session transcripts, not from descriptions.

The assistant distilled this into a gauntlet prompt (gauntlet-loop method) for finishing wikiman at `C:\Users\PTW\.pi\agent\extensions\wiki-context` against the handover roadmap (`C:\Users\PTW\Desktop\wikiman-improvement-handover.md` + docs/wiki).

## The choice

**The bar**: a fresh-session transcript on a real project where —
1. The **operating contract, overview, and index are always in context** (instructions for how to operate the wiki present at all times);
2. **Where-is-X is answered from the map before any grep** (wayfinding/navigation as a native skill);
3. Concepts are **lazy-loaded one at a time** and the agent **progressively discloses only what the task needs**;
4. **Just-in-time instructions arrive exactly when relevant**.

**The protocol**: smallest judgeable pieces; builder + separate critic with fresh context; the critic runs real sessions, puts the transcript next to the bar blind, names the single biggest remaining gap, and loops back to the builder.

**The measurable half**: a 10-point rubric per session covering contract presence, map-first wayfinding, lazy-load discipline, progressive disclosure, and JIT timing. **9/10 or better wins**; praise is not useful — the critic is harsh. Builders and critics run as parallel subagents. A live progress page updates as work evolves.

## Alternatives considered

- Keep the prior three-pillar bar (memory / self-learning / knows-when-to-use). Superseded: pillars describe *outcomes*, but the new bar specifies *observable session behaviors* — contract presence, map-first lookup, lazy-load discipline, progressive disclosure, JIT timing — which a critic can score directly from a transcript.
- Score against a description of quality. Rejected: the bar is explicitly "compare transcripts against the bar itself, not against a description of it".

## Rationale

Behavioral criteria are judgeable from real transcripts; quality pillars are not. The redefinition keeps the gauntlet structure (real bar + separate critic + e2e runs) but makes the target concrete enough for a blind critic to grade.

## Consequences

- Supersedes the three-pillar formulation; all remaining roadmap work (F2 okf_version migrations, R2 session journal, R3 ranked token-budgeted injection, R4 git-aware injection, R5 ranked search, R6 dedupe/governors, R7 /wiki:digest /wiki:stats viewer search, R8 global memory tier, ask-first update check, e2e test suite) is now driven as gauntlet rounds against the native-skill rubric.
- R3/R5 (ranked, token-budgeted injection and search) directly serve contract-presence and progressive-disclosure criteria; R2 (session journal) serves JIT timing.
- Exit criterion for the whole project: a critic-scored 9/10 fresh-session transcript, not item counts on the roadmap.
