---
okf_version: "0.1"
---

# Project Knowledge Wiki

<!-- wiki-nav:start -->
## Navigation map

Auto-generated detailed index of every docs/wiki/ concept — the map the LLM uses to locate information. 16 concept(s). Regenerated on init and on wiki_mark_synced. Generated 2026-11-16T09:21:15.204Z.

Each entry: [title](concept-id.md) — description. Links are clickable in /wiki; pass the concept-id (link target minus .md) to wiki_get.

### Core concepts

- [Glossary](glossary.md) — Key terms for this project.
- [Overview](overview.md) — What this project contains and its structure.

### Architecture

- [File tree](architecture/file-tree.md) — Complete project file listing with per-file descriptions.

### Pages

- [Inline Recap Pipeline](pages/entities/inline-recap-pipeline.md) — The end-of-turn recap subsystem of `index.ts`: after each coding turn, one
- [Page Templates](pages/TEMPLATES.md) — Reference templates for Concept, Entity, and Artifact pages. Follow these when using wiki_note_page.

### Decisions

- [Disconnect/reconnect state lives in agent home, keyed per cwd](decisions/disconnect-reconnect-state-lives-in-agent-home-keyed-per-cwd.md) — Context
- [Recap runs in-process, not via agentman subagent](decisions/recap-runs-in-process-not-via-agentman-subagent.md) — Context
- [Update propagation: okf_version-gated additive bundle migrations + prompt-in-package](decisions/update-propagation-okf-version-gated-additive-bundle-migrati.md) — Context
- [Wiki:init is ensure-semantics — never overwrites authored content](decisions/wiki-init-is-ensure-semantics-never-overwrites-authored-cont.md) — Context

### Rules

- [Bundle migrations are additive-only, idempotent, and always ask-first](rules/bundle-migrations-are-additive-only-idempotent-and-always-as.md) — **Guideline**: Any new docs/wiki/ bundle surface or feature must ship as an **additive-only, idempotent migration step** keyed on a bump of the bundle's `okf_ve

### Learnings

- [Handover roadmap: R1 + F1 + curator slice done (ec1034a) — next is R2 journal](learnings/handover-roadmap-r1-f1-curator-slice-done-ec1034a-next-is-r2.md) — The **R1 + F1 + curator-inlining slice is done** — commit `ec1034a` (2026-11-16),
- [Handover roadmap status: 4 of ~11 items done — next slice is F2 + R2](learnings/handover-roadmap-status-1-of-11-items-done-next-slice-is-r1-.md) — Second scorecard review: R1 (self-contained recap), F1 (init data-loss fix) and curator fallback are done; still open: F2, R2–R8, update check, tests. Next slice: F2 + R2.
- [New pi extension commands need a fresh session or /reload; test in the TUI, not pi -p](learnings/new-pi-extension-commands-need-a-fresh-session-or-reload-tes.md) — Two gotchas when developing this pi extension (referenced as the "house gotcha" but never written down until now):
- [okf_version frontmatter is stamped at scaffold but never consumed](learnings/okf-version-frontmatter-is-stamped-at-scaffold-but-never-con.md) — `indexFrontmatter()` stamps `okf_version: "0.1"` into a bundle's root `index.md` at scaffold time (index.ts ~line 1232), but **nothing ever reads it** — there i
- [Type-check baseline is 21 pre-existing peer-dep errors — verify by before/after diff](learnings/type-check-baseline-is-21-pre-existing-peer-dep-errors-verif.md) — `npx tsc -p ../tsconfig.wikicheck.json` currently reports **21 pre-existing errors**, all peer-dependency type drift (e.g. `AgentToolResult.details`, `ctx.mode`
- [/wiki:init re-init data loss (F1) — FIXED via ensure-semantics init](learnings/wiki-init-on-an-existing-bundle-destroys-authored-content-on.md) — initBundle() used to unconditionally overwrite authored overview/glossary/log/last_updated on re-init (only pages/ and .wiki_ignore were guarded). FIXED 2026-11-16: init is now ensure-semantics — adds missing surfaces only.
<!-- wiki-nav:end -->

An [OKF](https://github.com/earendil-works/okf) bundle documenting this project.

- [Overview](./overview.md) — What this project contains and its structure
- [File tree](./architecture/file-tree.md) — Complete project file listing
- [Glossary](./glossary.md) — Key terms for this project
- [Pages](./pages/) — Concepts, entities, and artifacts of this project
