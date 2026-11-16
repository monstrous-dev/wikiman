---
okf_version: "0.1"
---

<!-- wiki-memory:start -->
# Memory — the live contract

Auto-generated digest of the most recent conventions, decisions, rules and
development patterns, plus architecture and global patterns — newest first.
The actual files live in the wiki subfolders; follow the links (clickable in /wiki).
Regenerated on every wiki write and on wiki_mark_synced. Generated 2026-11-16T10:03:12.695Z.

## Recent Decisions

- [Acceptance bar redefined: OKF wiki as a native LLM skill, 9/10 rubric on real transcripts](decisions/acceptance-bar-redefined-okf-wiki-as-a-native-llm-skill-9-10.md) — Context (2026-11-16)
- [Gauntlet acceptance bar: 9/10 LLM memory with self-learning, verified e2e](decisions/gauntlet-acceptance-bar-9-10-llm-memory-with-self-learning-v.md) — Context (2026-11-16)
- [Wiki:init is ensure-semantics — never overwrites authored content](decisions/wiki-init-is-ensure-semantics-never-overwrites-authored-cont.md) — Context (2026-11-16)
- [Recap runs in-process, not via agentman subagent](decisions/recap-runs-in-process-not-via-agentman-subagent.md) — Context (2026-11-16)
- [Disconnect/reconnect state lives in agent home, keyed per cwd](decisions/disconnect-reconnect-state-lives-in-agent-home-keyed-per-cwd.md) — Context (2026-11-16)
- [Update propagation: okf_version-gated additive bundle migrations + prompt-in-package](decisions/update-propagation-okf-version-gated-additive-bundle-migrati.md) — Context (2026-11-16)

## Active Rules

- [Migration prompts: ask in UI, silent headless](rules/migration-prompts-ask-in-ui-silent-headless.md) — Bundle version migration prompts ask-first in the real UI but migrate silently in headless/RPC sessions, with per-cwd + per-version decline … (2026-11-16)
- [Bundle migrations are additive-only, idempotent, and always ask-first](rules/bundle-migrations-are-additive-only-idempotent-and-always-as.md) — **Guideline**: Any new docs/wiki/ bundle surface or feature must ship as an **additive-only, idempotent migration step** keyed on a bump of … (2026-11-16)

## Recent Learnings — development patterns

- [regenerateMemory/updateIndexNavMap tolerate missing state](learnings/regeneratememory-updateindexnavmap-tolerate-missing-state.md) — `regenerateMemory` creates `memory.md` itself and `updateIndexNavMap` handles missing nav markers, so migrations can rely on them instead of… (2026-11-16)
- [Migration writes shouldn't trip staleness nag](learnings/migration-writes-shouldn-t-trip-staleness-nag.md) — After migrating, bump the bundle's `last_updated` so the migration's own writes don't trigger the staleness nag on next session. (2026-11-16)
- [Windows cmd.exe: use double quotes, not single](learnings/windows-cmd-exe-use-double-quotes-not-single.md) — cmd.exe does not honor single quotes — shell commands in the harness (e.g. git commit messages) must use double quotes on Windows. (2026-11-16)
- [Baseline: wikiman answers are correct but behavior is grep-first (map-first 0/2)](learnings/baseline-wikiman-answers-are-correct-but-behavior-is-grep-fi.md) — E2E baseline probes P1 and P3 both passed ground truth (caught the orphaned-middleware trap, picked the right file over the twin). But debug… (2026-11-16)
- [pi -p transcripts omit tool calls; args only on tool_execution_start](learnings/pi-p-transcripts-omit-tool-calls-args-only-on-tool-execution.md) — `pi -p` output shows only the final assistant answer — no tool-call evidence. For behavior scoring, `WIKI_DEBUG_LOG=1` in the agent writes a… (2026-11-16)
- [Handover roadmap status: 4 of ~11 items done — next slice is F2 + R2](learnings/handover-roadmap-status-1-of-11-items-done-next-slice-is-r1-.md) — Second scorecard review: R1 (self-contained recap), F1 (init data-loss fix) and curator fallback are done; still open: F2, R2–R8, update che… (2026-11-16)
- [/wiki:init re-init data loss (F1) — FIXED via ensure-semantics init](learnings/wiki-init-on-an-existing-bundle-destroys-authored-content-on.md) — initBundle() used to unconditionally overwrite authored overview/glossary/log/last_updated on re-init (only pages/ and .wiki_ignore were gua… (2026-11-16)
- [Handover roadmap: R1 + F1 + curator slice done (ec1034a) — next is R2 journal](learnings/handover-roadmap-r1-f1-curator-slice-done-ec1034a-next-is-r2.md) — The **R1 + F1 + curator-inlining slice is done** — commit `ec1034a` (2026-11-16), (2026-11-16)
- [New pi extension commands need a fresh session or /reload; test in the TUI, not pi -p](learnings/new-pi-extension-commands-need-a-fresh-session-or-reload-tes.md) — Two gotchas when developing this pi extension (referenced as the "house gotcha" but never written down until now): (2026-11-16)
- [Type-check baseline is 21 pre-existing peer-dep errors — verify by before/after diff](learnings/type-check-baseline-is-21-pre-existing-peer-dep-errors-verif.md) — `npx tsc -p ../tsconfig.wikicheck.json` currently reports **21 pre-existing errors**, all peer-dependency type drift (e.g. `AgentToolResult.… (2026-11-16)
- [okf_version frontmatter is stamped at scaffold but never consumed](learnings/okf-version-frontmatter-is-stamped-at-scaffold-but-never-con.md) — `indexFrontmatter()` stamps `okf_version: "0.1"` into a bundle's root `index.md` at scaffold time (index.ts ~line 1232), but **nothing ever … (2026-11-16)

## Architecture

- [File tree](architecture/file-tree.md) — Complete project file listing with per-file descriptions. (2026-11-16)

<!-- wiki-memory:end -->
