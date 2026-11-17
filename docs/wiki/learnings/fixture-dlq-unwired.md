---
type: Learning
title: Fixture DLQ is genuinely unwired; ground truth must bless code-truthful readings
description: The planted DLQ trap in the e2e fixture has no producer — the S6 agent's 'contrarian' claim that it was unwired was code-accurate. The ground-truth rubric was c
tags: [testing, fixtures]
timestamp: "2026-11-16T11:38:34.693Z"
---

# Fixture DLQ is genuinely unwired; ground truth must bless code-truthful readings

The DLQ is PLANTED TRAP #3 in the e2e fixture and is genuinely unwired: `services/worker/src/queues/dlq.ts` creates the `tasks-dlq` queue and a 60s sweeper, but no producer ever calls `dlq.add` — BullMQ retries a job 3 times and then leaves it in the `tasks` queue's own failed set, so it never reaches `tasks-dlq`. An empty DLQ is the code-correct reading. The S6 agent's 'contrarian' claim that it was unwired was code-accurate, so the ground-truth rubric (tests/ground-truth.md) was corrected to bless code-accurate readings of planted traps rather than the fixture's original (wrong) expectation — contradicting ADR 2's prose is RIGHT when the code says otherwise.
