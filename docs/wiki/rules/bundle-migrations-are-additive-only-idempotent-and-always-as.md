---
type: Rule
title: Bundle migrations are additive-only, idempotent, and always ask-first
description: "**Guideline**: Any new docs/wiki/ bundle surface or feature must ship as an **additive-only, idempotent migration step** keyed on a bump of the bundle's `okf_ve"
tags: [convention, migrations, bundling, data-loss]
timestamp: "2026-11-16T08:48:51.978Z"
---

# Bundle migrations are additive-only, idempotent, and always ask-first

**Guideline**: Any new docs/wiki/ bundle surface or feature must ship as an **additive-only, idempotent migration step** keyed on a bump of the bundle's `okf_version` — never as a change that rewrites existing files.

**When it applies**: every wikiman change that adds or alters what a project's `docs/wiki/` bundle should contain (new files like `journal/`, new marker-delimited sections, new index links, frontmatter fields).

**Rules**:

- Create missing dirs/files; **never overwrite user-authored content** — regenerate only derived, marker-delimited sections (nav map between `wiki-nav:start/end`, memory digest between `wiki-memory:start/end`).
- Idempotent: re-running a migration step must be a no-op (`existsSync` guards before every write).
- **Ask-first**: confirm with the user before migrating a bundle — each repo's git history is the user's only backup.
- Implement migrations as an ordered registry (`MIGRATIONS: Array<{to, apply(cwd)}>`) applied via the shared `ensureBundle()` path (migration step zero = fresh init), never a second divergent scaffold implementation.
- After migrating: append to `log.md`, bump `okf_version`, call `wiki_mark_synced()`.

**Rationale**: bundles are user data scattered across many repos; extension updates must reach them without data loss (evidence: the `/wiki:init` re-init overwrite bug — see learnings).
