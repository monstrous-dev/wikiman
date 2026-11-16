---
type: Learning
title: Slash commands work headless via cmd.exe
description: The "slash commands crash headless" gotcha is actually Git Bash / MSYS-specific path mangling, not a pi limitation. Running from cmd.exe — `cmd //c "pi -p /wiki
tags: [testing, slash-commands]
timestamp: "2026-11-16T10:38:53.418Z"
---

# Slash commands work headless via cmd.exe

The "slash commands crash headless" gotcha is actually Git Bash / MSYS-specific path mangling, not a pi limitation. Running from cmd.exe — `cmd //c "pi -p /wiki:digest"` — works fine and was used to e2e-verify `/wiki:digest` and `/wiki:stats`.

Rule of thumb: never test slash commands from Git Bash; use cmd.exe for headless verification instead.
