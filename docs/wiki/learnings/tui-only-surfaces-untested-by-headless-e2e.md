---
type: Learning
title: TUI-only surfaces untested by headless e2e
description: "wikiman's e2e probes run headless (`pi -p`), which silently skips all UI-facing paths: confirm dialogs (staleness, migration, re-init scaffold), `ui.notify` out"
tags: [tui, testing]
timestamp: "2026-11-16T11:47:19.993Z"
---

# TUI-only surfaces untested by headless e2e

wikiman's e2e probes run headless (`pi -p`), which silently skips all UI-facing paths: confirm dialogs (staleness, migration, re-init scaffold), `ui.notify` output (so `/wiki:stats` produces no visible output headless), footer `wiki:` indicator states, and the `/wiki` browser viewer's actual rendering.
