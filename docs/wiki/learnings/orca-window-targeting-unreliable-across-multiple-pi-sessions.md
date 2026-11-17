---
type: Learning
title: Orca window targeting unreliable across multiple pi sessions
description: Automated GUI targeting (`--restore-window`, orca ids, Win32 HWNDs) flapped between identifiers when 4 pi sessions were open; `--restore-window` grabbed an Expl
tags: [qa, windows, automation]
timestamp: "2026-11-17T10:54:50.406Z"
---

# Orca window targeting unreliable across multiple pi sessions

Automated GUI targeting (`--restore-window`, orca ids, Win32 HWNDs) flapped between identifiers when 4 pi sessions were open; `--restore-window` grabbed an Explorer window, and identifying the right TUI (e.g. HWND 4982584 titled `cmd.exe`) cost several turns.

Don't sink turns into cross-session window capture for QA — verify via filesystem artifacts or stage the live check for the user instead.
