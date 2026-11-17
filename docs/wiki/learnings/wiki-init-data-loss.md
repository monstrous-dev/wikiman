---
type: Learning
title: "/wiki:init re-init data loss (F1) — FIXED via ensure-semantics init"
description: "initBundle() used to unconditionally overwrite authored overview/glossary/log/last_updated on re-init (only pages/ and .wiki_ignore were guarded). FIXED 2026-11-16: init is now ensure-semantics — adds missing surfaces only."
tags: [gotcha, data-loss, wiki-init, initBundle, fixed, f1]
timestamp: "2026-11-16T09:19:20.914Z"
---

# /wiki:init re-init data loss (F1) — FIXED via ensure-semantics init

**RESOLVED (2026-11-16, handover item F1):** `initBundle` is now ensure-semantics — every scaffold write is guarded ("writeIfMissing"), only missing surfaces are added, authored overview/glossary/concept files survive a re-init, and `last_updated.md` is never reset. Re-running `/wiki:init` on a hand-written bundle is now safe. The analysis below is kept for context; do **not** treat this as an open gotcha anymore.

Original finding (pre-fix): `initBundle()` (`/wiki:init` handler) unconditionally `writeFile`'d `index.md`, `overview.md`, `log.md`, `last_updated.md`, `glossary.md`, and the `pages/**/index.md` scaffolds. Only `.wiki_ignore` was guarded by `existsSync`. The confirm dialog promised "will not overwrite existing concept files" — that was true **only for `pages/``; any authored overview/glossary content was wiped by a re-init.

The fix followed the direction agreed in the update-propagation decision: turn `initBundle` into an **ensureBundle**-style pass — every write guarded by `existsSync`, only *add missing surfaces*, regenerate only the auto-managed nav-map section between markers. `ensureBundle()` semantics double as migration step zero (fresh init and old-bundle catch-up share one code path) — the foundation F2's `okf_version` migration layer (see [[okf-version-never-checked]] and [[migrations-additive-ask-first]]) builds on.

## Source

- `index.ts` — `initBundle()` ensure-semantics rewrite (`writeIfMissing` helper, `hadAuthored` gates the auto-doc LLM pass)
