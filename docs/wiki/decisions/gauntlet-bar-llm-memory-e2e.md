---
type: Decision
title: "Gauntlet acceptance bar: 9/10 LLM memory with self-learning, verified e2e"
description: Context
tags: [quality-bar, gauntlet, acceptance-criteria, e2e-testing, roadmap, self-learning]
status: accepted
supersedes: "[]"
timestamp: "2026-11-16T09:25:00.822Z"
---

# Gauntlet acceptance bar: 9/10 LLM memory with self-learning, verified e2e

## Context

After the R1 + F1 + curator slice landed ([[recap-runs-in-process-not-via-agentman-subagent]], commit `ec1034a`), the roadmap status ([[handover-roadmap-slice-2]]) showed 4 of ~11 items done and named F2 + R2 as the next slice. The user then set an explicit, measurable acceptance bar for ALL remaining work, invoking the gauntlet-loop method:

> build all improvements and test the extension e2e until the wiki/extension is **9 out of 10 for LLM memory**, has **self-learning**, and **knows when to use** (records the right thing at the right moment).

## The choice

The remaining roadmap (F2 migration layer, R2 session journal, R3–R8) is no longer "ship slices and self-assess quality". Every improvement is driven as a gauntlet:

1. **Concrete bar** — quality is judged against a real, fetchable reference (a working wiki that demonstrably captures the right knowledge, verified e2e in a live session), not against a self-description of quality.
2. **Builder + separate critic** — the agent that builds a piece is not the one that judges it; the critic compares output blind against the bar and names the single biggest remaining gap.
3. **Loop until the bar is met** — exit is "critic picks ours" / the 9/10 bar demonstrably reached, never a round count or a "looks good to me".
4. **E2E verification is a hard gate** — per the house gotcha ([[new-commands-need-reload]]), static checks (tsc baseline diff) are necessary but not sufficient; features are only "done" after runtime verification in a fresh session.

## Alternatives considered

- **Continue ad-hoc slice-by-slice with self-assessed quality** (the previous mode). Rejected: self-assessment drifts upward; the existing roadmap learnings already flagged "pending runtime verification" items that nobody had actually run.
- **Define the bar as a rubric/scorecard doc only**. Rejected as insufficient alone: a rubric without a separate critic and e2e runs still lets the builder grade its own homework.

## Rationale

"9 out of 10 for LLM memory" only means something if some agent can actually observe the extension failing or succeeding at capturing the right knowledge in real sessions. The gauntlet structure (real bar + separate critic + e2e) is the only approach in play that produces that evidence.

## Consequences

- The three pillars define "done" for the whole backlog: (1) **LLM memory quality** — the wiki captures what future sessions actually need, (2) **self-learning** — capture happens automatically and correctly without prompting, (3) **knows when to use** — injection/staleness/recap fire at the right moments, not nagging or silent.
- The recap e2e run flagged in the roadmap learning's "Pending runtime verification" section is now a blocking gate, not a nice-to-have.
- Each gauntlet round should still land as a reviewable slice/commit so rollback points (cf. `restore-pre-r1`) survive.
- Status updates to [[handover-roadmap-slice-2]] should report progress against the bar, not just item counts.
