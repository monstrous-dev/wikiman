# Wikiman for pi

A [pi](https://pi.dev) extension that gives every project a **living knowledge
wiki** — an OKF bundle at `docs/wiki/` that your agent consults before it
greps, and writes to as it learns. The wiki becomes the authoritative map of
where things live and why the code looks the way it does.

```bash
pi install git:github.com/monstrous-dev/wikiman
```

## What you get

- **Wiki-first context injection** — every session starts with the wiki's
  navigation map, overview, and a live memory digest (recent decisions, rules,
  patterns), so the agent reads the map before searching the codebase.
- **A full wiki toolkit** — `wiki_get` / `wiki_search` / `wiki_related` /
  `wiki_discover` for lookup; `wiki_note_learning` / `_rule` / `_decision` /
  `_preference` / `_page` for structured recording; `wiki_validate`,
  `wiki_timestamp`, `wiki_changelog`, `wiki_mark_synced` for hygiene.
- **End-of-turn recap** (optional) — a background subagent mines each turn for
  major decisions, reusable rules, learnings, and new concepts, and records
  them itself. See "Optional: the recap subagent" below.
- **Staleness awareness** — the extension tracks when the wiki last changed
  alongside the code and nudges (ask-first, never automatic) when it drifts.
- **HTML viewer** — a self-contained `wiki-viewer.html` renders the whole
  bundle in a browser, kept fresh automatically.
- **Ships a skill** — installs a `wikiman` skill so the LLM knows the lookup
  order and the recording taxonomy out of the box.

## Requirements

- [pi](https://pi.dev)
- Any OS pi supports

## Install

```bash
pi install git:github.com/monstrous-dev/wikiman
```

Try it without installing:

```bash
pi -e git:github.com/monstrous-dev/wikiman
```

Then open pi in any project — the extension offers to scaffold `docs/wiki/`
(ask-first; declined folders are remembered in `.wiki-omitted.json`).

## Updates

```bash
pi update --extensions          # reconcile all packages
pi update git:github.com/monstrous-dev/wikiman   # just Wikiman
```

Installed without a ref you track `main`; releases are git tags. Pin one:

```bash
pi install git:github.com/monstrous-dev/wikiman@v0.1.0
```

## How it works

The wiki is plain Markdown in OKF (Open Knowledge Format): frontmatter-typed
concepts in `learnings/`, `rules/`, `decisions/`, `preferences/`, `pages/`,
cross-linked with `[[wikilinks]]`, plus auto-generated indexes (`index.md`,
memory digest) that are injected into every pi session. State lives in the
project (`docs/wiki/`) and small marker files (`.wiki-omitted.json`,
`.wiki-asked.json`) — nothing is sent anywhere.

Inside git worktrees the extension stays dormant, and wiki initialization
always asks first.

## Optional: the recap subagent

The richest feature — automatic end-of-turn wiki updates — needs two things
that are machine-local by nature:

1. The `wiki-recap` / `wiki-curator` agent prompts — copies ship in
   [`agents/`](agents/) of this repo. Copy them to `~/.pi/agent/agents/`.
2. The sub-agent runner — published separately as
   [`pi install git:github.com/monstrous-dev/agentman`](https://github.com/monstrous-dev/agentman).

## Security

Wikiman reads and writes files in your project and agent home only, and runs
no network services beyond a localhost viewer. Review the source — it's one
small directory.

## License

[MIT](LICENSE)
