---
type: Learning
title: Large-text Python splice corrupted index.ts; git restore + small verified steps
description: A Python splice replacing a large block in `extension/index.ts` swallowed the tail of `initBundle`, leaving an orphan duplicate fragment and 21 tsc errors. Reco
tags: [refactor, git, tsc]
timestamp: "2026-11-17T10:54:50.313Z"
---

# Large-text Python splice corrupted index.ts; git restore + small verified steps

A Python splice replacing a large block in `extension/index.ts` swallowed the tail of `initBundle`, leaving an orphan duplicate fragment and 21 tsc errors. Recovery was clean via `git checkout index.ts` (work already committed in `3d19c34`) and replaying the refactor in small steps with tsc verified between each.

Rule of thumb: prefer small, marker-verified edits over one big splice when touching large TS blocks; commit stable work first so restore is cheap.
