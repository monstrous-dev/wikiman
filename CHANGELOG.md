# Changelog

All notable changes to wikiman. Releases are git tags; pin one with
`pi install git:github.com/monstrous-dev/wikiman@vX.Y.Z`.

## v0.2.1 — everything in the background

- **Staleness sync never interrupts you** — the blocking "Update via
  wiki-curator?" dialog is gone. With the subagent runner installed the
  curator spawns as a background child (footer: `● updating (background)`,
  completion notify); without it the sync queues as a hidden message that
  rides your next prompt (footer: `● stale — sync queued`), and
  `wiki_mark_synced` flips the footer to `● synced` when it lands.
- **`/wiki:self-update`** — update the extension itself from inside pi:
  ask-first, runs `pi update git:github.com/monstrous-dev/wikiman`, then
  reminds you to `/reload`. The update-available notification points at it.
- **Init returns instantly** — scaffolding a new wiki no longer blocks the
  session on a hidden LLM turn. The scaffold lands immediately and the
  auto-doc (overview/glossary/file-tree descriptions) runs in the background:
  a wiki-curator subagent window when agentman is present, an invisible
  in-process completion otherwise. Dead askLLM machinery removed.

## v0.2.0 — the self-contained release

The big one: wikiman no longer needs anything else installed to be amazing.

- **Recap is self-contained (R1)** — the end-of-turn wiki-recap is now one
  in-process completion call with a deterministic JSON→note writer. No
  intelligent-delegation, no agentman, no copying agent prompts. Install and
  it records learnings/decisions/rules on its own; without a model configured
  it degrades silently and the manual tools keep working.
- **Curator without agentman** — `/wiki:update` and the staleness prompt fall
  back to an in-session update when the subagent runner is missing. (The
  subagent path still works and is still nicer when agentman is installed.)
- **`/wiki:init` can't destroy your writing anymore (F1)** — re-init only adds
  missing scaffold files. Authored overview/glossary/concepts are never
  overwritten; `last_updated.md` is never reset.
- **Bundle migrations (F2)** — bundles carry `okf_version` now. Old 0.1 bundles
  get an additive migration at session start (changelog/, journal/, memory.md,
  nav map, .wiki_ignore) — ask-first in the TUI, silent headless, and declines
  are remembered until a newer version ships.
- **Session journal + resume card (R2)** — every turn appends
  attempted/landed/open to `docs/wiki/journal/`, and the newest entry is
  injected as a resume card. "Continue where we left off" actually works.
- **Wayfinding protocol (R3)** — the injected contract is now an imperative
  protocol at position 0, the nav map is a ranked slice, and injection is
  hard-capped at 12k chars with a deterministic shrink order.
- **Git-aware injection (R4)** — concepts whose `resource:` matches files from
  recent commits get boosted and surfaced in a "Relevant to your recent files"
  block. Time-boxed, silent outside repos.
- **Ranked search (R5)** — `wiki_search` is multi-term TF × field weights
  (title > path/description > body) + recency + type boost, with visible
  scores.
- **Dedupe-at-write + governors (R6)** — same-title concepts return the
  existing id + wikilink instead of a duplicate; the recap records additions
  only (it now sees `wiki_note_*` evidence in the transcript); `wiki_validate`
  warns on 90-day-stale concepts (W6).
- **`/wiki:stats` and `/wiki:digest` (R7)** — concept counts, injection size vs
  budget, last sync, journal entries; and a 7-day changelog + fresh-learnings
  roll-up written to `docs/wiki/digest.md`.
- **Viewer search + bootstrap import (R7)** — the offline viewer has a page
  filter; `/wiki:init` offers to turn `docs/adr/*.md` into starter Concept
  pages (ask-first).
- **Global memory tier (R8)** — a strict slice of your agent-home wiki
  (rules + preferences) is injected below the project wiki in every project
  session, with a cycle guard and `wiki_get("global/…")` lazy-loading.
- **Update check** — once a day, a silent tag check; if a newer version
  exists you get a notify. Never auto-installs.
- **`/wiki:disconnect` / `/wiki:reconnect`** — pause the extension for a
  folder (no injection, staleness, recap) without deleting `docs/wiki/`.

## v0.1.0

Initial release: wiki-first context injection, 13 wiki_* tools, staleness
checks, HTML viewer, optional recap/curator subagents.
