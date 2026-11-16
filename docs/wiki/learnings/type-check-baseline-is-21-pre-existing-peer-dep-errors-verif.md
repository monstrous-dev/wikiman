---
type: Learning
title: Type-check baseline is 21 pre-existing peer-dep errors — verify by before/after diff
description: `npx tsc -p ../tsconfig.wikicheck.json` currently reports **21 pre-existing errors**, all peer-dependency type drift (e.g. `AgentToolResult.details`, `ctx.mode`
tags: [type-check, tsc, verification, peer-dependencies]
timestamp: "2026-11-16T08:52:59.090Z"
---

# Type-check baseline is 21 pre-existing peer-dep errors — verify by before/after diff

`npx tsc -p ../tsconfig.wikicheck.json` currently reports **21 pre-existing errors**, all peer-dependency type drift (e.g. `AgentToolResult.details`, `ctx.mode` typing) — not bugs in this package.

**Gotcha:** a clean type-check is not the success bar here. The verification method is: run tsc **before** the change, run it **after**, and require identical error counts and identical error codes. Any new code or code is a regression; matching counts with the same codes is a pass.

Observed 2026-11-16 while adding disconnect/reconnect: 21 errors before, 21 after, identical codes.
