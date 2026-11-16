---
type: System Overview
title: Overview
description: What this project contains and its structure.
timestamp: "2026-11-16T08:40:12.625Z"
---

# Overview

This repository is **Wikiman** — a [pi](https://pi.dev) extension package
(`monstrous-dev/wikiman`, MIT) that gives every project a **living knowledge
wiki**: an OKF (Open Knowledge Format) bundle at `docs/wiki/` that the agent
consults before it greps and writes to as it learns. Each pi session starts
with the wiki's navigation map, overview, and a memory digest (recent
decisions, rules, patterns) injected into context, so the agent reads the map
before searching the codebase. Initialization is ask-first, declined folders
are remembered in `~/.pi/agent/.wiki-omitted.json`, and the extension stays
dormant inside git worktrees.

The implementation is deliberately minimal: two TypeScript files. `index.ts`
is the entire extension and the single source of truth ("no abstractions, one
file") — it provides session-start context injection, the lazy-load lookup
tools (`wiki_get` / `wiki_search` / `wiki_related` / `wiki_discover`), the
structured recording tools (`wiki_note_learning` / `_rule` / `_decision` /
`_preference` / `_page`), hygiene tools (`wiki_validate`, `wiki_timestamp`,
`wiki_changelog`, `wiki_mark_synced`), staleness detection comparing code
changes against `docs/wiki/last_updated.md` (git-first, mtime fallback,
respecting `.wiki_ignore` plus built-in framework ignores), and five commands:
`/wiki` (viewer), `/wiki:update`, `/wiki:init`, plus `/wiki:disconnect` /
`/wiki:reconnect` — pausing the extension's proactive machinery (injection,
staleness, recap, curator) for a folder without deleting its `docs/wiki/`
bundle (state in `~/.pi/agent/.wiki-disconnected.json`). `viewer.ts` is a
standalone module that generates a self-contained HTML viewer for the whole
bundle (`wiki-viewer.html` / `wiki.js` data) and serves it on localhost.

Supporting assets ship alongside the code: `agents/` holds the prompts for two
companion sub-agents (`wiki-recap` — an end-of-turn background agent that mines
each turn for decisions, rules, and learnings; `wiki-curator` — syncs wiki
concepts to code changes), meant to be copied to `~/.pi/agent/agents/` and run
via the separate `agentman` package. `skills/wikiman/SKILL.md` teaches the LLM
the wiki-first lookup order and the recording taxonomy.

Finally, the extension dogfoods its own product: `docs/wiki/` here is the
project's own OKF bundle (scaffolded 2026-11-16 with index, overview,
glossary, file-tree, log, and page templates). State lives in the project —
`.wiki_ignore` excludes wiki edits and build output from staleness counts —
and `readme.html` is a dev-local artifact kept out of the package.
