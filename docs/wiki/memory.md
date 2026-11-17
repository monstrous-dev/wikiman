---
okf_version: "0.2"
---

<!-- wiki-memory:start -->
# Memory — the live contract

Auto-generated digest of the most recent conventions, decisions, rules and
development patterns, plus architecture and global patterns — newest first.
The actual files live in the wiki subfolders; follow the links (clickable in /wiki).
Regenerated on every wiki write and on wiki_mark_synced. Generated 2026-11-17T10:54:50.558Z.

## Recent Decisions

- [R3 nav injection replaces grep-first exploration](decisions/r3-nav-injection-replaces-grep-first-exploration.md) — `buildInjection` now emits a ranked nav slice under a budget plus a hard imperative operating contract: consult the wiki map first, grep onl… (2026-11-16)
- [Acceptance bar redefined: OKF wiki as a native LLM skill, 9/10 rubric on real transcripts](decisions/acceptance-bar-native-skill.md) — Context (2026-11-16)
- [Gauntlet acceptance bar: 9/10 LLM memory with self-learning, verified e2e](decisions/gauntlet-bar-llm-memory-e2e.md) — Context (2026-11-16)
- [Wiki:init is ensure-semantics — never overwrites authored content](decisions/wiki-init-ensure-semantics.md) — Context (2026-11-16)
- [Recap runs in-process, not via agentman subagent](decisions/recap-runs-in-process-not-via-agentman-subagent.md) — Context (2026-11-16)
- [Disconnect/reconnect state lives in agent home, keyed per cwd](decisions/disconnect-state-agent-home.md) — Context (2026-11-16)
- [Update propagation: okf_version-gated additive bundle migrations + prompt-in-package](decisions/update-propagation-okf-migrations.md) — Context (2026-11-16)

## Active Rules

- [Match the task, not the recency (contract rule 5)](rules/match-the-task-not-the-recency-contract-rule-5.md) — Probe agents should open exactly the concepts named by the task, not chase recently-viewed files. Enforcing this halved session durations (S… (2026-11-16)
- [Exact-title duplicates rejected at the funnel level](rules/exact-title-dedupe-funnel.md) — `wiki_note_*` calls with an exact duplicate title return "Already recorded — id — reference as [[wikilink]]" instead of writing. Always refe… (2026-11-16)
- [Auto-generated files in docs/wiki/ must be validator-invisible](rules/generated-files-validator-invisible.md) — Journal `.md` files without frontmatter tripped validator E1, and `wiki_mark_synced` refuses while errors exist — so agents burned tool call… (2026-11-16)
- [Migration prompts: ask in UI, silent headless](rules/migration-prompts-ask-in-ui-silent-headless.md) — Bundle version migration prompts ask-first in the real UI but migrate silently in headless/RPC sessions, with per-cwd + per-version decline … (2026-11-16)
- [Bundle migrations are additive-only, idempotent, and always ask-first](rules/migrations-additive-ask-first.md) — **Guideline**: Any new docs/wiki/ bundle surface or feature must ship as an **additive-only, idempotent migration step** keyed on a bump of … (2026-11-16)

## Recent Learnings — development patterns

- [Orca window targeting unreliable across multiple pi sessions](learnings/orca-window-targeting-unreliable-across-multiple-pi-sessions.md) — Automated GUI targeting (`--restore-window`, orca ids, Win32 HWNDs) flapped between identifiers when 4 pi sessions were open; `--restore-win… (2026-11-17)
- [Large-text Python splice corrupted index.ts; git restore + small verified steps](learnings/large-text-python-splice-corrupted-index-ts-git-restore-smal.md) — A Python splice replacing a large block in `extension/index.ts` swallowed the tail of `initBundle`, leaving an orphan duplicate fragment and… (2026-11-17)
- [Background-sync 'synced' footer state is an approximation](learnings/background-sync-footer-approximate.md) — `wiki: ● synced (background)` shows on completion notify even if the curator partially failed; correctness is restored lazily because the ne… (2026-11-16)
- [Background wiki sync fallback: hidden queued message with 1h cooldown](learnings/background-wiki-sync-fallback.md) — When no subagent runner (agentman) is available, the stale-wiki sync queues as a hidden message that silently rides the user's next prompt. … (2026-11-16)
- [Tool contexts extend the full extension context](learnings/tool-contexts-extend-the-full-extension-context.md) — In this codebase, a tool's context is not a narrow object — it extends the complete extension context, meaning tools can update the footer U… (2026-11-16)
- [Extensions load at session start only](learnings/extensions-load-at-session-start-only.md) — pi extensions cannot hot-reload their own code: after a self-update the running session still executes the old version until `/reload` is is… (2026-11-16)
- [Wiki sync triggers: command vs staleness check vs version flows](learnings/wiki-sync-trigger-map.md) — Three independent wiki triggers exist: `/wiki:update` (on-demand full sync), a session-start staleness check keyed to *code* changes vs `doc… (2026-11-16)
- [Launching pi TUI QA windows on Windows](learnings/launching-pi-tui-qa-windows-on-windows.md) — To get a visible pi TUI session for QA on Windows, launch via `wt -w new` — a plain `Start-Process` of a `.cmd` lands in a hidden conhost. W… (2026-11-16)
- [TUI-only surfaces untested by headless e2e](learnings/tui-only-surfaces-untested-by-headless-e2e.md) — wikiman's e2e probes run headless (`pi -p`), which silently skips all UI-facing paths: confirm dialogs (staleness, migration, re-init scaffo… (2026-11-16)
- [Fixture DLQ is genuinely unwired; ground truth must bless code-truthful readings](learnings/fixture-dlq-unwired.md) — The planted DLQ trap in the e2e fixture has no producer — the S6 agent's 'contrarian' claim that it was unwired was code-accurate. The groun… (2026-11-16)
- [Probe tool logs accumulate across sessions without per-run clearing](learnings/probe-logs-need-per-run-clear.md) — In the wikiman-e2e gauntlet, round-1 `.tools.log` files accumulated across probe sessions, so blind critics grading S2/S3/S6 were partially … (2026-11-16)
- [/wiki:stats output is TUI-only by design](learnings/wiki-stats-output-is-tui-only-by-design.md) — `/wiki:stats` prints nothing when run headless (exit 0, silent) because its output goes through `ui.notify`, which is UI-facing. Headless ve… (2026-11-16)
- [Slash commands work headless via cmd.exe](learnings/slash-commands-work-headless-via-cmd-exe.md) — The "slash commands crash headless" gotcha is actually Git Bash / MSYS-specific path mangling, not a pi limitation. Running from cmd.exe — `… (2026-11-16)
- [JIT git-audit relevance pattern (R4) verified in practice](learnings/jit-git-audit-r4.md) — The agent performed a single git-audit call (log + status + last-commit stat), then read exactly the 3 recently-touched files and `wiki_get`… (2026-11-16)
- [Recap dedupe gap: transcript must include wiki-tool evidence](learnings/recap-dedupe-tool-evidence.md) — `collectTurnText` originally captured only user/assistant text, so the recap could not see that a `wiki_note_*` call had already fired in-tu… (2026-11-16)
- [shell:true concatenates argv unquoted on Windows](learnings/shell-true-concatenates-argv-unquoted-on-windows.md) — With `shell: true`, args are joined raw, so a `-f` word inside a prompt string became a pi flag (instant exit 1). Prompts must carry their o… (2026-11-16)
- [Debounce timer dies when pi -p exits (headless recap race)](learnings/debounce-dies-headless-race.md) — The journal/recap write used a 1.2s debounce timer, which is killed when `pi -p` exits — the journal silently never landed in headless mode.… (2026-11-16)
- [regenerateMemory/updateIndexNavMap tolerate missing state](learnings/regenerate-tolerates-missing.md) — `regenerateMemory` creates `memory.md` itself and `updateIndexNavMap` handles missing nav markers, so migrations can rely on them instead of… (2026-11-16)
- [Migration writes shouldn't trip staleness nag](learnings/migration-writes-shouldn-t-trip-staleness-nag.md) — After migrating, bump the bundle's `last_updated` so the migration's own writes don't trigger the staleness nag on next session. (2026-11-16)
- [Windows cmd.exe: use double quotes, not single](learnings/windows-cmd-exe-use-double-quotes-not-single.md) — cmd.exe does not honor single quotes — shell commands in the harness (e.g. git commit messages) must use double quotes on Windows. (2026-11-16)

## Architecture

- [File tree](architecture/file-tree.md) — Complete project file listing with per-file descriptions. (2026-11-16)

<!-- wiki-memory:end -->
