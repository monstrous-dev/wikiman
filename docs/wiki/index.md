---
okf_version: "0.2"
---

# Project Knowledge Wiki

<!-- wiki-nav:start -->
## Navigation map

Auto-generated detailed index of every docs/wiki/ concept — the map the LLM uses to locate information. 35 concept(s). Regenerated on init and on wiki_mark_synced. Generated 2026-11-16T10:37:38.026Z.

Each entry: [title](concept-id.md) — description. Links are clickable in /wiki; pass the concept-id (link target minus .md) to wiki_get.

### Core concepts

- [Glossary](glossary.md) — Key terms for this project.
- [Overview](overview.md) — What this project contains and its structure.

### Architecture

- [File tree](architecture/file-tree.md) — Complete project file listing with per-file descriptions.

### Pages

- [Session journal / resume card (R2)](pages/artifacts/session-journal-resume-card-r2.md) — Completion call now returns notes + journal in one shot; entries in `journal/2026-11.md` with `attempted`/`landed`/`open` fields (empty fields omitted, journal
- [wikiman-e2e harness and acme-ops fixture](pages/artifacts/wikiman-e2e-harness-and-acme-ops-fixture.md) — E2E test setup at `C:\Users\PTW\wikiman-e2e\`: `acme-ops` fixture (58 files, 4 git commits, legacy `okf_version 0.1` bundle, planted traps incl. ratelimit-unmou
- [Bundle migration engine (F2)](pages/entities/bundle-migration-engine-f2.md) — Shipped F2: versioned bundle migration via `BUNDLE_VERSION="0.2"` with `readBundleVersion`/`migrateBundle`/`bumpBundleVersion`, wired into `session_start` and `
- [Inline Recap Pipeline](pages/entities/inline-recap-pipeline.md) — The end-of-turn recap subsystem of `index.ts`: after each coding turn, one
- [R3 injection contract rework (planned)](pages/entities/r3-injection-contract-rework-planned.md) — Next planned work: hard imperative operating contract at the top of every injection ("the map is already in your context — consult it FIRST; grep/find is the fa
- [Page Templates](pages/TEMPLATES.md) — Reference templates for Concept, Entity, and Artifact pages. Follow these when using wiki_note_page.

### Decisions

- [Acceptance bar redefined: OKF wiki as a native LLM skill, 9/10 rubric on real transcripts](decisions/acceptance-bar-redefined-okf-wiki-as-a-native-llm-skill-9-10.md) — Context
- [Disconnect/reconnect state lives in agent home, keyed per cwd](decisions/disconnect-reconnect-state-lives-in-agent-home-keyed-per-cwd.md) — Context
- [Gauntlet acceptance bar: 9/10 LLM memory with self-learning, verified e2e](decisions/gauntlet-acceptance-bar-9-10-llm-memory-with-self-learning-v.md) — Context
- [R3 nav injection replaces grep-first exploration](decisions/r3-nav-injection-replaces-grep-first-exploration.md) — `buildInjection` now emits a ranked nav slice under a budget plus a hard imperative operating contract: consult the wiki map first, grep only as fallback when t
- [Recap runs in-process, not via agentman subagent](decisions/recap-runs-in-process-not-via-agentman-subagent.md) — Context
- [Update propagation: okf_version-gated additive bundle migrations + prompt-in-package](decisions/update-propagation-okf-version-gated-additive-bundle-migrati.md) — Context
- [Wiki:init is ensure-semantics — never overwrites authored content](decisions/wiki-init-is-ensure-semantics-never-overwrites-authored-cont.md) — Context

### Rules

- [Auto-generated files in docs/wiki/ must be validator-invisible](rules/auto-generated-files-in-docs-wiki-must-be-validator-invisibl.md) — Journal `.md` files without frontmatter tripped validator E1, and `wiki_mark_synced` refuses while errors exist — so agents burned tool calls fabricating frontm
- [Bundle migrations are additive-only, idempotent, and always ask-first](rules/bundle-migrations-are-additive-only-idempotent-and-always-as.md) — **Guideline**: Any new docs/wiki/ bundle surface or feature must ship as an **additive-only, idempotent migration step** keyed on a bump of the bundle's `okf_ve
- [Exact-title duplicates rejected at the funnel level](rules/exact-title-duplicates-rejected-at-the-funnel-level.md) — `wiki_note_*` calls with an exact duplicate title return "Already recorded — id — reference as [[wikilink]]" instead of writing. Always reference existing notes
- [Migration prompts: ask in UI, silent headless](rules/migration-prompts-ask-in-ui-silent-headless.md) — Bundle version migration prompts ask-first in the real UI but migrate silently in headless/RPC sessions, with per-cwd + per-version decline memory. Verified via

### Learnings

- [Baseline: wikiman answers are correct but behavior is grep-first (map-first 0/2)](learnings/baseline-wikiman-answers-are-correct-but-behavior-is-grep-fi.md) — E2E baseline probes P1 and P3 both passed ground truth (caught the orphaned-middleware trap, picked the right file over the twin). But debug logs show the agent
- [Debounce timer dies when pi -p exits (headless recap race)](learnings/debounce-timer-dies-when-pi-p-exits-headless-recap-race.md) — The journal/recap write used a 1.2s debounce timer, which is killed when `pi -p` exits — the journal silently never landed in headless mode. Fix: in headless ha
- [Handover roadmap: R1 + F1 + curator slice done (ec1034a) — next is R2 journal](learnings/handover-roadmap-r1-f1-curator-slice-done-ec1034a-next-is-r2.md) — The **R1 + F1 + curator-inlining slice is done** — commit `ec1034a` (2026-11-16),
- [Handover roadmap status: 4 of ~11 items done — next slice is F2 + R2](learnings/handover-roadmap-status-1-of-11-items-done-next-slice-is-r1-.md) — Second scorecard review: R1 (self-contained recap), F1 (init data-loss fix) and curator fallback are done; still open: F2, R2–R8, update check, tests. Next slice: F2 + R2.
- [JIT git-audit relevance pattern (R4) verified in practice](learnings/jit-git-audit-relevance-pattern-r4-verified-in-practice.md) — The agent performed a single git-audit call (log + status + last-commit stat), then read exactly the 3 recently-touched files and `wiki_get`ed the 3 matching le
- [Migration writes shouldn't trip staleness nag](learnings/migration-writes-shouldn-t-trip-staleness-nag.md) — After migrating, bump the bundle's `last_updated` so the migration's own writes don't trigger the staleness nag on next session.
- [New pi extension commands need a fresh session or /reload; test in the TUI, not pi -p](learnings/new-pi-extension-commands-need-a-fresh-session-or-reload-tes.md) — Two gotchas when developing this pi extension (referenced as the "house gotcha" but never written down until now):
- [okf_version frontmatter is stamped at scaffold but never consumed](learnings/okf-version-frontmatter-is-stamped-at-scaffold-but-never-con.md) — `indexFrontmatter()` stamps `okf_version: "0.1"` into a bundle's root `index.md` at scaffold time (index.ts ~line 1232), but **nothing ever reads it** — there i
- [pi -p transcripts omit tool calls; args only on tool_execution_start](learnings/pi-p-transcripts-omit-tool-calls-args-only-on-tool-execution.md) — `pi -p` output shows only the final assistant answer — no tool-call evidence. For behavior scoring, `WIKI_DEBUG_LOG=1` in the agent writes a per-session `.wiki-
- [Recap dedupe gap: transcript must include wiki-tool evidence](learnings/recap-dedupe-gap-transcript-must-include-wiki-tool-evidence.md) — `collectTurnText` originally captured only user/assistant text, so the recap could not see that a `wiki_note_*` call had already fired in-turn and wrote a parap
- [regenerateMemory/updateIndexNavMap tolerate missing state](learnings/regeneratememory-updateindexnavmap-tolerate-missing-state.md) — `regenerateMemory` creates `memory.md` itself and `updateIndexNavMap` handles missing nav markers, so migrations can rely on them instead of duplicating scaffol
- [shell:true concatenates argv unquoted on Windows](learnings/shell-true-concatenates-argv-unquoted-on-windows.md) — With `shell: true`, args are joined raw, so a `-f` word inside a prompt string became a pi flag (instant exit 1). Prompts must carry their own cmd.exe quoting i
- [Type-check baseline is 21 pre-existing peer-dep errors — verify by before/after diff](learnings/type-check-baseline-is-21-pre-existing-peer-dep-errors-verif.md) — `npx tsc -p ../tsconfig.wikicheck.json` currently reports **21 pre-existing errors**, all peer-dependency type drift (e.g. `AgentToolResult.details`, `ctx.mode`
- [/wiki:init re-init data loss (F1) — FIXED via ensure-semantics init](learnings/wiki-init-on-an-existing-bundle-destroys-authored-content-on.md) — initBundle() used to unconditionally overwrite authored overview/glossary/log/last_updated on re-init (only pages/ and .wiki_ignore were guarded). FIXED 2026-11-16: init is now ensure-semantics — adds missing surfaces only.
- [Windows cmd.exe: use double quotes, not single](learnings/windows-cmd-exe-use-double-quotes-not-single.md) — cmd.exe does not honor single quotes — shell commands in the harness (e.g. git commit messages) must use double quotes on Windows.
<!-- wiki-nav:end -->

An [OKF](https://github.com/earendil-works/okf) bundle documenting this project.

- [Overview](./overview.md) — What this project contains and its structure
- [File tree](./architecture/file-tree.md) — Complete project file listing
- [Glossary](./glossary.md) — Key terms for this project
- [Pages](./pages/) — Concepts, entities, and artifacts of this project
