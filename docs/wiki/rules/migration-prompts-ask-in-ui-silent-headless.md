---
type: Rule
title: "Migration prompts: ask in UI, silent headless"
description: Bundle version migration prompts ask-first in the real UI but migrate silently in headless/RPC sessions, with per-cwd + per-version decline memory. Verified via
tags: [migration, ux]
timestamp: "2026-11-16T10:03:12.677Z"
---

# Migration prompts: ask in UI, silent headless

Bundle version migration prompts ask-first in the real UI but migrate silently in headless/RPC sessions, with per-cwd + per-version decline memory. Verified via a headless probe session that migrated a legacy 0.1 bundle end-to-end (`okf_version` bumped, scaffolds created, migration journaled).
