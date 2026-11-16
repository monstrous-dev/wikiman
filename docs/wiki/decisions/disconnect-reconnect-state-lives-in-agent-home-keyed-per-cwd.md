---
type: Decision
title: Disconnect/reconnect state lives in agent home, keyed per cwd
description: Context
tags: [disconnect, reconnect, state, registries, per-machine]
status: accepted
supersedes: "[]"
timestamp: "2026-11-16T08:52:53.151Z"
---

# Disconnect/reconnect state lives in agent home, keyed per cwd

## Context

User asked for a way to pause wikiman for a project **without deleting its `docs/wiki/` bundle** — "stop being proactive" had to be decoupled from "remove the wiki". Disconnect state needed a home, and the choice determines its semantics.

## Decision

Disconnect state lives in **agent home**: `DISCONNECTED_FILE` = `~/.pi/agent/.wiki-disconnected.json`, a flat JSON array of absolute cwd paths, loaded/saved via `loadDisconnected` / `saveDisconnected` / `isDisconnected` helpers. This mirrors the existing per-machine registries (`.wiki-omitted.json` for declined-init folders, `.wiki-asked.json` for ask-later state). Guards sit at all five proactive surfaces:

- `before_agent_start` — no context injection
- `session_start` — no staleness check / init-ask; footer shows `wiki: disconnected`
- `agent_end` — no recap spawn; pending debounced recap cancelled
- `/wiki:update`, `/wiki:init` — refuse with a reconnect hint

Still functional while disconnected: `docs/wiki/` bundle untouched on disk, `/wiki` viewer, and all `wiki_get` / `wiki_search` / `wiki_related` lookups. Both commands enforce the trust gate and refuse in git worktrees (dormancy rule).

## Alternatives considered

- **Repo-local marker** (e.g. `docs/wiki/.disconnected`) — would make disconnect survive sync across machines and be visible to collaborators. Offered to the user as a switch; rejected for now because disconnect is a *per-machine user preference* ("this machine finds this wiki noisy"), not a property of the project, and the bundle should stay pure project content.

## Rationale

Consistency with the two existing registries in agent home, and correct default semantics: reconnecting on another machine (fresh clone) should not inherit a muted wiki.

## Consequences

- Disconnect does **not** survive across machines — if cross-machine semantics are wanted later, migrate to a repo-local marker.
- The state file is keyed by absolute cwd; moving/renaming a project folder effectively disconnects the new path and orphans the old entry (harmless stale data).
- Implemented in `index.ts` (single source of truth); type-check verified 0 new errors (21 pre-existing before and after).

## Source

- `index.ts` — `DISCONNECTED_FILE`, `loadDisconnected` / `saveDisconnected` / `isDisconnected`, and the five guard sites
