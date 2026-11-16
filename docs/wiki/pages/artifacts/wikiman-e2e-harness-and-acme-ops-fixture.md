---
type: Artifact
title: wikiman-e2e harness and acme-ops fixture
description: "E2E test setup at `C:\Users\PTW\wikiman-e2e\`: `acme-ops` fixture (58 files, 4 git commits, legacy `okf_version 0.1` bundle, planted traps incl. ratelimit-unmou"
tags: [e2e-harness, fixture]
timestamp: "2026-11-16T09:50:39.189Z"
---

# wikiman-e2e harness and acme-ops fixture

E2E test setup at `C:\Users\PTW\wikiman-e2e\`: `acme-ops` fixture (58 files, 4 git commits, legacy `okf_version 0.1` bundle, planted traps incl. ratelimit-unmounted and cache.ts twin), rubric + ground truth + probe runner, transcripts in `wikiman-e2e\transcripts\`.

Fixture is deliberately legacy 0.1 so the upcoming F2 migration layer can be exercised additively. Probe evidence source is `WIKI_DEBUG_LOG=1` debug logs, not `pi -p` transcripts.
