---
name: wikiman
description: Project knowledge wiki toolkit — wiki-first lookups (get/search/related/discover) before grepping, and structured recording (learnings, rules, decisions, preferences, concept/entity/artifact pages) into docs/wiki/ as an OKF bundle. Use when a project has docs/wiki/, when asked to look something up in the wiki, record a learning/decision/rule, or when the system prompt tells you to consult the wiki first.
---

# Wikiman — the project knowledge wiki

Every wiki-backed project keeps an OKF bundle at `docs/wiki/`. It is the
authoritative map of where things live and why the code looks the way it does.
Your system prompt carries its navigation map, overview, and memory digest —
that context is your index into everything else.

## Lookup order — stop at the first hit

When locating files, code, or logic:

1. The Navigation map in `index.md` (already in your context) — find the concept
   that documents the area.
2. The Overview — project structure and major subsystems.
3. The memory digest — recent decisions, rules, patterns; follow links.
4. `architecture/file-tree.md` via `wiki_get` — jump straight to the right path.
5. Only then grep / find / LSP to pin exact lines.

Reading a concept: `wiki_get("concepts/id")`. Search: `wiki_search("keyword")`.
Follow cross-links: `wiki_related("id")`. Explore untracked areas:
`wiki_discover("path", depth, filter)`.

## Recording — pick the right tool

| Write | Tool | When |
|-------|------|------|
| Learning | `wiki_note_learning` | A non-obvious fact, gotcha, behavior, or debugging insight worth persisting. Lead with symptom or discovery. |
| Rule | `wiki_note_rule` | A reusable heuristic or "always do X" convention — name when it applies and the evidence. |
| Decision | `wiki_note_decision` | A MAJOR choice or direction shift — context, the choice, alternatives, rationale, consequences. Not routine progress. |
| Preference | `wiki_note_preference` | A stated style/tool/convention preference from the user. |
| Page | `wiki_note_page` | A Concept (abstract idea), Entity (concrete thing: endpoint, service, model), or Artifact (deliverable). Use `[[wikilinks]]`. |

Discipline:

- Dedupe first — `wiki_search` before writing; update instead of duplicating.
- Be selective — routine task progress warrants zero writes.
- Timestamps: `wiki_timestamp`, never guess.
- After substantive wiki edits: `wiki_mark_synced` and a user-facing
  `wiki_changelog` entry (category, user-benefit one-liner, what/why/next).
- Validate structure with `wiki_validate` (frontmatter, types, links).

## HTML viewer

`wiki-viewer.html` inside the bundle renders the whole wiki in a browser;
it regenerates automatically as the wiki changes.
