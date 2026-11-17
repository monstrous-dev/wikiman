---
type: Entity
title: Background init (instant scaffold + off-session auto-doc)
description: "New-project init (commit `41c02fb`) is now non-blocking: the deterministic scaffold returns instantly with a notify ('auto-doc running in the background'), and "
tags: [init, background, subagent]
timestamp: "2026-11-17T10:54:50.460Z"
---

# Background init (instant scaffold + off-session auto-doc)

New-project init (commit `41c02fb`) is now non-blocking: the deterministic scaffold returns instantly with a notify ('auto-doc running in the background'), and overview/glossary/file-tree generation runs off-session — as a wiki-curator subagent window when agentman is present, otherwise an invisible in-process completion.

The old flow blocked startup ~30s on a hidden LLM turn in the user's session; the dead `askLLM`/`pendingPrompts`/`message_end` machinery was removed. tsc 21/0.
