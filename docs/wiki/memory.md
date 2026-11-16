---
okf_version: "0.2"
---

<!-- wiki-memory:start -->
# Memory — the live contract

Auto-generated digest of the most recent conventions, decisions, rules and
development patterns, plus architecture and global patterns — newest first.
The actual files live in the wiki subfolders; follow the links (clickable in /wiki).
Regenerated on every wiki write and on wiki_mark_synced. Generated 2026-11-16T12:30:45.585Z.

## Recent Decisions

- [R3 nav injection replaces grep-first exploration](decisions/r3-nav-injection-replaces-grep-first-exploration.md) — `buildInjection` now emits a ranked nav slice under a budget plus a hard imperative operating contract: consult the wiki map first, grep onl… (2026-11-16)
- [Acceptance bar redefined: OKF wiki as a native LLM skill, 9/10 rubric on real transcripts](decisions/acceptance-bar-redefined-okf-wiki-as-a-native-llm-skill-9-10.md) — Context (2026-11-16)
- [Gauntlet acceptance bar: 9/10 LLM memory with self-learning, verified e2e](decisions/gauntlet-acceptance-bar-9-10-llm-memory-with-self-learning-v.md) — Context (2026-11-16)
- [Wiki:init is ensure-semantics — never overwrites authored content](decisions/wiki-init-is-ensure-semantics-never-overwrites-authored-cont.md) — Context (2026-11-16)
- [Recap runs in-process, not via agentman subagent](decisions/recap-runs-in-process-not-via-agentman-subagent.md) — Context (2026-11-16)
- [Disconnect/reconnect state lives in agent home, keyed per cwd](decisions/disconnect-reconnect-state-lives-in-agent-home-keyed-per-cwd.md) — Context (2026-11-16)
- [Update propagation: okf_version-gated additive bundle migrations + prompt-in-package](decisions/update-propagation-okf-version-gated-additive-bundle-migrati.md) — Context (2026-11-16)

## Active Rules

- [Match the task, not the recency (contract rule 5)](rules/match-the-task-not-the-recency-contract-rule-5.md) — Probe agents should open exactly the concepts named by the task, not chase recently-viewed files. Enforcing this halved session durations (S… (2026-11-16)
- [Exact-title duplicates rejected at the funnel level](rules/exact-title-duplicates-rejected-at-the-funnel-level.md) — `wiki_note_*` calls with an exact duplicate title return "Already recorded — id — reference as [[wikilink]]" instead of writing. Always refe… (2026-11-16)
- [Auto-generated files in docs/wiki/ must be validator-invisible](rules/auto-generated-files-in-docs-wiki-must-be-validator-invisibl.md) — Journal `.md` files without frontmatter tripped validator E1, and `wiki_mark_synced` refuses while errors exist — so agents burned tool call… (2026-11-16)
- [Migration prompts: ask in UI, silent headless](rules/migration-prompts-ask-in-ui-silent-headless.md) — Bundle version migration prompts ask-first in the real UI but migrate silently in headless/RPC sessions, with per-cwd + per-version decline … (2026-11-16)
- [Bundle migrations are additive-only, idempotent, and always ask-first](rules/bundle-migrations-are-additive-only-idempotent-and-always-as.md) — **Guideline**: Any new docs/wiki/ bundle surface or feature must ship as an **additive-only, idempotent migration step** keyed on a bump of … (2026-11-16)

## Recent Learnings — development patterns

- [Extensions load at session start only](learnings/extensions-load-at-session-start-only.md) — pi extensions cannot hot-reload their own code: after a self-update the running session still executes the old version until `/reload` is is… (2026-11-16)
- [Wiki sync triggers: command vs staleness check vs version flows](learnings/wiki-sync-triggers-command-vs-staleness-check-vs-version-flo.md) — Three independent wiki triggers exist: `/wiki:update` (on-demand full sync), a session-start staleness check keyed to *code* changes vs `doc… (2026-11-16)
- [Launching pi TUI QA windows on Windows](learnings/launching-pi-tui-qa-windows-on-windows.md) — To get a visible pi TUI session for QA on Windows, launch via `wt -w new` — a plain `Start-Process` of a `.cmd` lands in a hidden conhost. W… (2026-11-16)
- [TUI-only surfaces untested by headless e2e](learnings/tui-only-surfaces-untested-by-headless-e2e.md) — wikiman's e2e probes run headless (`pi -p`), which silently skips all UI-facing paths: confirm dialogs (staleness, migration, re-init scaffo… (2026-11-16)
- [Fixture DLQ is genuinely unwired; ground truth must bless code-truthful readings](learnings/fixture-dlq-is-genuinely-unwired-ground-truth-must-bless-cod.md) — The planted DLQ trap in the e2e fixture has no producer — the S6 agent's 'contrarian' claim that it was unwired was code-accurate. The groun… (2026-11-16)
- [Probe tool logs accumulate across sessions without per-run clearing](learnings/probe-tool-logs-accumulate-across-sessions-without-per-run-c.md) — In the wikiman-e2e gauntlet, round-1 `.tools.log` files accumulated across probe sessions, so blind critics grading S2/S3/S6 were partially … (2026-11-16)
- [/wiki:stats output is TUI-only by design](learnings/wiki-stats-output-is-tui-only-by-design.md) — `/wiki:stats` prints nothing when run headless (exit 0, silent) because its output goes through `ui.notify`, which is UI-facing. Headless ve… (2026-11-16)
- [Slash commands work headless via cmd.exe](learnings/slash-commands-work-headless-via-cmd-exe.md) — The "slash commands crash headless" gotcha is actually Git Bash / MSYS-specific path mangling, not a pi limitation. Running from cmd.exe — `… (2026-11-16)
- [JIT git-audit relevance pattern (R4) verified in practice](learnings/jit-git-audit-relevance-pattern-r4-verified-in-practice.md) — The agent performed a single git-audit call (log + status + last-commit stat), then read exactly the 3 recently-touched files and `wiki_get`… (2026-11-16)
- [Recap dedupe gap: transcript must include wiki-tool evidence](learnings/recap-dedupe-gap-transcript-must-include-wiki-tool-evidence.md) — `collectTurnText` originally captured only user/assistant text, so the recap could not see that a `wiki_note_*` call had already fired in-tu… (2026-11-16)
- [shell:true concatenates argv unquoted on Windows](learnings/shell-true-concatenates-argv-unquoted-on-windows.md) — With `shell: true`, args are joined raw, so a `-f` word inside a prompt string became a pi flag (instant exit 1). Prompts must carry their o… (2026-11-16)
- [Debounce timer dies when pi -p exits (headless recap race)](learnings/debounce-timer-dies-when-pi-p-exits-headless-recap-race.md) — The journal/recap write used a 1.2s debounce timer, which is killed when `pi -p` exits — the journal silently never landed in headless mode.… (2026-11-16)
- [regenerateMemory/updateIndexNavMap tolerate missing state](learnings/regeneratememory-updateindexnavmap-tolerate-missing-state.md) — `regenerateMemory` creates `memory.md` itself and `updateIndexNavMap` handles missing nav markers, so migrations can rely on them instead of… (2026-11-16)
- [Migration writes shouldn't trip staleness nag](learnings/migration-writes-shouldn-t-trip-staleness-nag.md) — After migrating, bump the bundle's `last_updated` so the migration's own writes don't trigger the staleness nag on next session. (2026-11-16)
- [Windows cmd.exe: use double quotes, not single](learnings/windows-cmd-exe-use-double-quotes-not-single.md) — cmd.exe does not honor single quotes — shell commands in the harness (e.g. git commit messages) must use double quotes on Windows. (2026-11-16)
- [Baseline: wikiman answers are correct but behavior is grep-first (map-first 0/2)](learnings/baseline-wikiman-answers-are-correct-but-behavior-is-grep-fi.md) — E2E baseline probes P1 and P3 both passed ground truth (caught the orphaned-middleware trap, picked the right file over the twin). But debug… (2026-11-16)
- [pi -p transcripts omit tool calls; args only on tool_execution_start](learnings/pi-p-transcripts-omit-tool-calls-args-only-on-tool-execution.md) — `pi -p` output shows only the final assistant answer — no tool-call evidence. For behavior scoring, `WIKI_DEBUG_LOG=1` in the agent writes a… (2026-11-16)
- [Handover roadmap status: 4 of ~11 items done — next slice is F2 + R2](learnings/handover-roadmap-status-1-of-11-items-done-next-slice-is-r1-.md) — Second scorecard review: R1 (self-contained recap), F1 (init data-loss fix) and curator fallback are done; still open: F2, R2–R8, update che… (2026-11-16)
- [/wiki:init re-init data loss (F1) — FIXED via ensure-semantics init](learnings/wiki-init-on-an-existing-bundle-destroys-authored-content-on.md) — initBundle() used to unconditionally overwrite authored overview/glossary/log/last_updated on re-init (only pages/ and .wiki_ignore were gua… (2026-11-16)
- [Handover roadmap: R1 + F1 + curator slice done (ec1034a) — next is R2 journal](learnings/handover-roadmap-r1-f1-curator-slice-done-ec1034a-next-is-r2.md) — The **R1 + F1 + curator-inlining slice is done** — commit `ec1034a` (2026-11-16), (2026-11-16)

## Architecture

- [File tree](architecture/file-tree.md) — Complete project file listing with per-file descriptions. (2026-11-16)

<!-- wiki-memory:end -->
