---
type: Learning
title: "Baseline: wikiman answers are correct but behavior is grep-first (map-first 0/2)"
description: E2E baseline probes P1 and P3 both passed ground truth (caught the orphaned-middleware trap, picked the right file over the twin). But debug logs show the agent
tags: [testing, behavior-scoring, r3]
timestamp: "2026-11-16T09:50:39.183Z"
---

# Baseline: wikiman answers are correct but behavior is grep-first (map-first 0/2)

E2E baseline probes P1 and P3 both passed ground truth (caught the orphaned-middleware trap, picked the right file over the twin). But debug logs show the agent goes filesystem-first (`ls` → `read` → `grep` ×2 → `read`, ~2 min) before ever calling `wiki_search`/`wiki_get`.

The always-in-context contract isn't changing actual behavior — this is the primary target for R3's operating-contract rework. Score behavior via the debug log, not transcripts.
