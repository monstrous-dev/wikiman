---
type: Learning
title: "/wiki:stats output is TUI-only by design"
description: "`/wiki:stats` prints nothing when run headless (exit 0, silent) because its output goes through `ui.notify`, which is UI-facing. Headless verification relies on"
tags: [wiki, testing]
timestamp: "2026-11-16T10:38:53.423Z"
---

# /wiki:stats output is TUI-only by design

`/wiki:stats` prints nothing when run headless (exit 0, silent) because its output goes through `ui.notify`, which is UI-facing. Headless verification relies on the fact that its underlying functions (injection size, counts, sync time) are already e2e-proven via injection paths.
