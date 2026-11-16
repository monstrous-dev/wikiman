---
type: Learning
title: pi -p transcripts omit tool calls; args only on tool_execution_start
description: `pi -p` output shows only the final assistant answer — no tool-call evidence. For behavior scoring, `WIKI_DEBUG_LOG=1` in the agent writes a per-session `.wiki-
tags: [pi-extension, testing, e2e-harness]
timestamp: "2026-11-16T09:50:39.174Z"
---

# pi -p transcripts omit tool calls; args only on tool_execution_start

`pi -p` output shows only the final assistant answer — no tool-call evidence. For behavior scoring, `WIKI_DEBUG_LOG=1` in the agent writes a per-session `.wiki-debug.log` of every tool execution.

Gotcha: `ToolExecutionEndEvent` carries empty args (`{}`); arguments only appear on the `tool_execution_start` event. The debug seam must capture both events.
