---
type: Decision
title: "Update propagation: okf_version-gated additive bundle migrations + prompt-in-package"
description: Context
tags: [architecture, updates, migrations, bundling, okf]
status: proposed
timestamp: "2026-11-16T08:48:51.977Z"
---

# Update propagation: okf_version-gated additive bundle migrations + prompt-in-package

## Context

Wikiman has three kinds of "instances" that must receive updates, each with a different propagation story:

- **A. Extension instances** (user machines) — today manual `pi update git:github.com/monstrous-dev/wikiman`. Plan: add `CHANGELOG.md` + semver git tags, plus an optional ask-first update check on `session_start` (throttled to once/24h, `git ls-remote --tags`, ~2s time-box, silent offline, notify only — never auto-install, because extensions load at session start and mid-session swaps are messy).
- **B. Wiki bundle instances** (every project's `docs/wiki/`) — the real gap. Bundles are user data scattered across repos; new extension versions add surfaces (`memory.md`, `changelog/`, future `journal/`, nav markers) that old bundles never receive.
- **C. Agent prompt instances** (`wiki-recap`/`wiki-curator` in `~/.pi/agent/agents/`) — manual copies that are never updated. Worst propagation story.

## The choice

For **B**: the extension declares a `BUNDLE_VERSION`; the bundle's `okf_version` frontmatter (currently stamped at scaffold, never read) becomes the instance's schema level (missing = `"0.1"` legacy). On `session_start` or `/wiki:update`, compare; if behind → **ask-first** migrate. Migrations are an ordered, idempotent, **additive-only** registry (`MIGRATIONS: Array<{to, apply(cwd)}>`) that creates missing dirs/files, injects nav markers if absent, regenerates only marker-delimited derived surfaces (nav map, memory.md), appends to `log.md`, bumps `okf_version`, calls `wiki_mark_synced()`. `ensureBundle()` (the fix for the re-init data-loss bug) **is migration step zero** — one code path handles both fresh init and old-bundle catch-up.

For **C**: remove the instance — inline prompts in-package (prompt-in-package), so they propagate automatically with every `pi update`. Recap: already planned (R1). Curator: either fully in-process (structured edits-plan JSON applied deterministically) or keep agent-home copies as an optional power-user path refreshed via `/wiki:install-prompts` with a versioned header.

## Alternatives considered

- Auto-install extension updates → rejected: mid-session code swaps are messy; ask-first only.
- Silent auto-migration of bundles → rejected: each repo's git history is the user's only backup; ask-first always.
- Keep shipping prompts as agent-home files with a refresh command → rejected as primary path (drift risk; users never refresh); kept only as optional power-user escape hatch.

## Rationale

- `okf_version` already exists in every bundle's frontmatter — using it as the schema level costs nothing and gives an exact migration boundary.
- Additive-only + idempotent migrations mean re-running is safe and user-authored content can never be destroyed (directly addresses the `/wiki:init` overwrite bug).
- One shared code path (`ensureBundle`) for init and migration avoids two divergent scaffolding implementations.

## Consequences

- The `/wiki:init` rewrite bug must be fixed first (`initBundle` → `ensureBundle`, every write `existsSync`-guarded, regenerate only the marker-delimited nav-map section).
- The migration layer is a prerequisite for R2 (journal) reaching existing bundles.
- First recommended slice: R1 (inline recap) + ensureBundle + curator prompt-inlining — shared machinery (in-process completion, prompt-in-package, deterministic writer) makes the extension genuinely self-contained.
