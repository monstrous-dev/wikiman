---
type: Learning
title: regenerateMemory/updateIndexNavMap tolerate missing state
description: `regenerateMemory` creates `memory.md` itself and `updateIndexNavMap` handles missing nav markers, so migrations can rely on them instead of duplicating scaffol
tags: [migration, helpers]
timestamp: "2026-11-16T10:03:12.684Z"
---

# regenerateMemory/updateIndexNavMap tolerate missing state

`regenerateMemory` creates `memory.md` itself and `updateIndexNavMap` handles missing nav markers, so migrations can rely on them instead of duplicating scaffold/injection logic.
