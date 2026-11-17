---
type: Learning
title: JIT git-audit relevance pattern (R4) verified in practice
description: The agent performed a single git-audit call (log + status + last-commit stat), then read exactly the 3 recently-touched files and `wiki_get`ed the 3 matching le
tags: [relevance, git, jit]
timestamp: "2026-11-16T10:34:27.285Z"
---

# JIT git-audit relevance pattern (R4) verified in practice

The agent performed a single git-audit call (log + status + last-commit stat), then read exactly the 3 recently-touched files and `wiki_get`ed the 3 matching learnings — including one from a prior session ("dead-code ratelimit"), demonstrating cross-session self-learning compounding. JIT relevance (git-aware boost) beats eager loading.
