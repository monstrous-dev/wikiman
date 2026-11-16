---
okf_version: "0.1"
---

<!-- wiki-memory:start -->
# Memory — the live contract

Auto-generated digest of the most recent conventions, decisions, rules and
development patterns, plus architecture and global patterns — newest first.
The actual files live in the wiki subfolders; follow the links (clickable in /wiki).
Regenerated on every wiki write and on wiki_mark_synced. Generated 2026-11-16T09:13:31.916Z.

## Recent Decisions

- [Disconnect/reconnect state lives in agent home, keyed per cwd](decisions/disconnect-reconnect-state-lives-in-agent-home-keyed-per-cwd.md) — Context (2026-11-16)
- [Update propagation: okf_version-gated additive bundle migrations + prompt-in-package](decisions/update-propagation-okf-version-gated-additive-bundle-migrati.md) — Context (2026-11-16)

## Active Rules

- [Bundle migrations are additive-only, idempotent, and always ask-first](rules/bundle-migrations-are-additive-only-idempotent-and-always-as.md) — **Guideline**: Any new docs/wiki/ bundle surface or feature must ship as an **additive-only, idempotent migration step** keyed on a bump of … (2026-11-16)

## Recent Learnings — development patterns

- [Handover roadmap status: 1 of 11 items done — next slice is R1 + F1 + curator inlining](learnings/handover-roadmap-status-1-of-11-items-done-next-slice-is-r1-.md) — As of the "did we implement all improvements?" scorecard review, only **1 of 11** backlog items is done. (2026-11-16)
- [New pi extension commands need a fresh session or /reload; test in the TUI, not pi -p](learnings/new-pi-extension-commands-need-a-fresh-session-or-reload-tes.md) — Two gotchas when developing this pi extension (referenced as the "house gotcha" but never written down until now): (2026-11-16)
- [Type-check baseline is 21 pre-existing peer-dep errors — verify by before/after diff](learnings/type-check-baseline-is-21-pre-existing-peer-dep-errors-verif.md) — `npx tsc -p ../tsconfig.wikicheck.json` currently reports **21 pre-existing errors**, all peer-dependency type drift (e.g. `AgentToolResult.… (2026-11-16)
- [/wiki:init on an existing bundle destroys authored content (only pages/ is guarded)](learnings/wiki-init-on-an-existing-bundle-destroys-authored-content-on.md) — `initBundle()` (index.ts, `/wiki:init` handler) unconditionally `writeFile`s `index.md`, `overview.md`, `log.md`, `last_updated.md`, `glossa… (2026-11-16)
- [okf_version frontmatter is stamped at scaffold but never consumed](learnings/okf-version-frontmatter-is-stamped-at-scaffold-but-never-con.md) — `indexFrontmatter()` stamps `okf_version: "0.1"` into a bundle's root `index.md` at scaffold time (index.ts ~line 1232), but **nothing ever … (2026-11-16)

## Architecture

- [File tree](architecture/file-tree.md) — Complete project file listing with per-file descriptions. (2026-11-16)

<!-- wiki-memory:end -->
