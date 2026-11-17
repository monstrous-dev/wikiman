---
type: Decision
title: "Wiki:init is ensure-semantics — never overwrites authored content"
description: Context
tags: [wiki-init, idempotency, data-safety, f1]
status: accepted
timestamp: "2026-11-16T09:18:24.185Z"
---

# Wiki:init is ensure-semantics — never overwrites authored content

## Context

`initBundle()` (the `/wiki:init` handler) unconditionally rewrote `index.md`,
`overview.md`, `log.md`, `last_updated.md`, `glossary.md` and the `pages/**`
scaffolds — destroying authored content on an existing bundle (documented in
[[wiki-init-data-loss]]; only `pages/`
was guarded). The fix direction was pre-agreed in
[[update-propagation-okf-migrations]] as F1.

## Choice

Implemented as **ensure-semantics** (commit `ec1034a`):

- Every stub write goes through `writeIfMissing` (given a pass-through `enc` param
  so batched stub edits become unique prefix swaps).
- The auto-doc LLM pass (which rewrites overview etc.) runs **only on a fresh
  bundle** — its rewrites stay real writes there.
- `last_updated.md` is never reset by init.
- The confirm dialog now tells the truth about what init does on an existing bundle.

## Alternatives considered

- Keep destructive init behind louder warnings — rejected: data loss is
  unrecoverable and users don't read warnings.
- Extend the old per-file guard — rejected: guards rot; existence-based
  ensure-semantics cannot clobber by construction.

## Rationale

Init must be idempotent and safe to run anywhere: on an existing bundle it fills
gaps; on a fresh one it scaffolds and auto-docs. Re-running should never destroy.

## Status

Accepted, shipped. Note: the full `ensureBundle()` migration-step-zero unification
from the update-propagation decision (fresh init and old-bundle catch-up sharing
one code path, `okf_version`-gated migrations) is **still pending** — that's the F2
migration layer the R2 journal work will need.
