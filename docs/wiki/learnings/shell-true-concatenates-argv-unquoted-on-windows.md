---
type: Learning
title: "shell:true concatenates argv unquoted on Windows"
description: "With `shell: true`, args are joined raw, so a `-f` word inside a prompt string became a pi flag (instant exit 1). Prompts must carry their own cmd.exe quoting i"
tags: [windows, shell, gotcha]
timestamp: "2026-11-16T10:24:49.334Z"
---

# shell:true concatenates argv unquoted on Windows

With `shell: true`, args are joined raw, so a `-f` word inside a prompt string became a pi flag (instant exit 1). Prompts must carry their own cmd.exe quoting in the e2e runner.
