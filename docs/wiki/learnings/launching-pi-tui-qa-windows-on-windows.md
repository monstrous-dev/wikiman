---
type: Learning
title: Launching pi TUI QA windows on Windows
description: To get a visible pi TUI session for QA on Windows, launch via `wt -w new` — a plain `Start-Process` of a `.cmd` lands in a hidden conhost. When multiple Windows
tags: [windows, testing, orca]
timestamp: "2026-11-16T12:03:47.888Z"
---

# Launching pi TUI QA windows on Windows

To get a visible pi TUI session for QA on Windows, launch via `wt -w new` — a plain `Start-Process` of a `.cmd` lands in a hidden conhost. When multiple WindowsTerminal windows exist, `--restore-window` can bring the *wrong* one forward; enumerate all top-level windows and call `SetForegroundWindow` on the exact HWND instead.
