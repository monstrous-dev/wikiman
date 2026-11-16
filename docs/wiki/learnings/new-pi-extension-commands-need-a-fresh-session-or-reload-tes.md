---
type: Learning
title: New pi extension commands need a fresh session or /reload; test in the TUI, not pi -p
description: "Two gotchas when developing this pi extension (referenced as the "house gotcha" but never written down until now):"
tags: [testing, tui, pi -p, session-lifecycle, gotcha]
timestamp: "2026-11-16T08:53:06.185Z"
---

# New pi extension commands need a fresh session or /reload; test in the TUI, not pi -p

Two gotchas when developing this pi extension (referenced as the "house gotcha" but never written down until now):

1. **New extension code only appears in sessions started after the change.** pi loads extensions at session start, so a command added mid-session (e.g. a new `/wiki:disconnect`) does not exist in the current session. Verify it with `/reload` or a fresh session.

2. **Test extension commands in the TUI, not via `pi -p` from Git Bash.** Slash commands and session-start machinery (injection, staleness footer, recap) only exercise correctly in an interactive TUI session.

Observed 2026-11-16 while adding `/wiki:disconnect` / `/wiki:reconnect` — new commands were invisible to the session that implemented them.
