---
type: Learning
title: Migration writes shouldn't trip staleness nag
description: After migrating, bump the bundle's `last_updated` so the migration's own writes don't trigger the staleness nag on next session.
tags: [migration, staleness]
timestamp: "2026-11-16T10:03:12.681Z"
---

# Migration writes shouldn't trip staleness nag

After migrating, bump the bundle's `last_updated` so the migration's own writes don't trigger the staleness nag on next session.
