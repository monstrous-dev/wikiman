---
type: Learning
title: Extensions load at session start only
description: "pi extensions cannot hot-reload their own code: after a self-update the running session still executes the old version until `/reload` is issued or pi restarts."
tags: [pi, reload]
timestamp: "2026-11-16T12:30:45.569Z"
---

# Extensions load at session start only

pi extensions cannot hot-reload their own code: after a self-update the running session still executes the old version until `/reload` is issued or pi restarts. `/wiki:self-update` therefore ends by reminding the user to `/reload`.
