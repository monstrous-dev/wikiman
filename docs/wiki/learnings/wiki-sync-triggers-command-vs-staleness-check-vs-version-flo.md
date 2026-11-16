---
type: Learning
title: "Wiki sync triggers: command vs staleness check vs version flows"
description: "Three independent wiki triggers exist: `/wiki:update` (on-demand full sync), a session-start staleness check keyed to *code* changes vs `docs/wiki/last_updated."
tags: [pi-extension, wiki, sync]
timestamp: "2026-11-16T12:29:12.439Z"
---

# Wiki sync triggers: command vs staleness check vs version flows

Three independent wiki triggers exist: `/wiki:update` (on-demand full sync), a session-start staleness check keyed to *code* changes vs `docs/wiki/last_updated.md` (not version, with 1h ask cooldown), and version flows limited to the once-per-`okf_version` F2 schema migration and a daily wikiman update notify. Wiki content never auto-updates on version bump; the staleness prompt is only a nudge — declining just cools down and the stale footer dot persists. `wiki_mark_synced` stamps the wiki current after manual edits.
