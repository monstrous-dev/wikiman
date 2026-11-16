---
type: Learning
title: Probe tool logs accumulate across sessions without per-run clearing
description: In the wikiman-e2e gauntlet, round-1 `.tools.log` files accumulated across probe sessions, so blind critics grading S2/S3/S6 were partially reading S1's tool ca
tags: [testing, harness]
timestamp: "2026-11-16T11:38:34.666Z"
---

# Probe tool logs accumulate across sessions without per-run clearing

In the wikiman-e2e gauntlet, round-1 `.tools.log` files accumulated across probe sessions, so blind critics grading S2/S3/S6 were partially reading S1's tool calls — contaminated evidence. The runner now clears the log before each run; always do this when sharing per-session tool logs as scoring evidence.
