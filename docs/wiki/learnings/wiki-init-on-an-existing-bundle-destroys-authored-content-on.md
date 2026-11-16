---
type: Learning
title: "/wiki:init on an existing bundle destroys authored content (only pages/ is guarded)"
description: "`initBundle()` (index.ts, `/wiki:init` handler) unconditionally `writeFile`s `index.md`, `overview.md`, `log.md`, `last_updated.md`, `glossary.md`, and the `pag"
tags: [gotcha, data-loss, wiki-init, initBundle]
timestamp: "2026-11-16T08:48:51.978Z"
---

# /wiki:init on an existing bundle destroys authored content (only pages/ is guarded)

`initBundle()` (index.ts, `/wiki:init` handler) unconditionally `writeFile`s `index.md`, `overview.md`, `log.md`, `last_updated.md`, `glossary.md`, and the `pages/**/index.md` scaffolds. Only `.wiki_ignore` is guarded by `existsSync`. The confirm dialog promises "will not overwrite existing concept files" — that is true **only for `pages/`**; any authored overview/glossary content is wiped by a re-init. Data-loss gotcha: never re-run `/wiki:init` on a bundle with hand-written content until this is fixed.

Fix direction (agreed in the update-propagation decision): turn `initBundle` into **`ensureBundle()`** — every write guarded by `existsSync`, only *add missing surfaces*, regenerate only the auto-managed nav-map section between markers. `ensureBundle()` doubles as migration step zero (fresh init and old-bundle catch-up share one code path).

## Source

- `index.ts` — `initBundle()` (~line 1047): unguarded writes to index/overview/log/last_updated/glossary
