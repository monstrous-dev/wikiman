---
type: Learning
title: "Background wiki sync fallback: hidden queued message with 1h cooldown"
description: When no subagent runner (agentman) is available, the stale-wiki sync queues as a hidden message that silently rides the user's next prompt. A 1h cooldown preven
tags: [pi-extension, wiki]
timestamp: "2026-11-16T14:34:56.124Z"
---

# Background wiki sync fallback: hidden queued message with 1h cooldown

When no subagent runner (agentman) is available, the stale-wiki sync queues as a hidden message that silently rides the user's next prompt. A 1h cooldown prevents queued syncs from stacking across prompts.
