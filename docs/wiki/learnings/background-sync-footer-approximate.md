---
type: Learning
title: Background-sync 'synced' footer state is an approximation
description: "`wiki: ● synced (background)` shows on completion notify even if the curator partially failed; correctness is restored lazily because the next session's stalene"
tags: [pi-extension, wiki, gotcha]
timestamp: "2026-11-16T14:34:56.160Z"
---

# Background-sync 'synced' footer state is an approximation

`wiki: ● synced (background)` shows on completion notify even if the curator partially failed; correctness is restored lazily because the next session's staleness check re-flags and re-syncs. Self-correcting by design, not guaranteed-accurate UI.
