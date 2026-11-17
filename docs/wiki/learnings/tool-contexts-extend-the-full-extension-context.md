---
type: Learning
title: Tool contexts extend the full extension context
description: In this codebase, a tool's context is not a narrow object — it extends the complete extension context, meaning tools can update the footer UI directly. This is 
tags: [pi-extension, footer, tools]
timestamp: "2026-11-16T14:34:56.091Z"
---

# Tool contexts extend the full extension context

In this codebase, a tool's context is not a narrow object — it extends the complete extension context, meaning tools can update the footer UI directly. This is how the queued-sync indicator is set/cleared from inside `wiki_mark_synced` without any new plumbing.
