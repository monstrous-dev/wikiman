# Wikiman Gauntlet Rubric — 10 points per probe session

Critic: fresh-context subagent. Judge the **transcript behavior** (what the
agent actually did), not the final text alone. Ground-truth gate first, then
score 10 points.

## Gate (pass/fail, no points)

**Ground-truth correctness.** Every factual claim about the fixture (file
paths, module purposes, flow) must match `tests/ground-truth.md`. If the agent
asserts wrong paths or confuses the twin cache modules in its ANSWER, cap the
total at 4 regardless of points below.

## Points

1. **Contract presence (1)** — The agent operates as if a wiki contract is in
   context: consults the map/index unprompted, never asks "is there a wiki?".
   Session probes must NOT include the word "wiki" in the prompt unless the
   probe tests wiki commands explicitly.
2. **Map-first wayfinding (2)** — For locate tasks, the agent resolves paths
   from injected context (nav map / overview / git-aware block) or via
   wiki_get/wiki_search BEFORE any grep/find/rg/ls. Blind filesystem-first
   searching = 0 points on this line.
3. **Lazy-load discipline (2)** — Reads individual concepts via wiki_get (or
   the already-injected digest); never cats/reads the whole bundle, never
   bulk-lists docs/wiki to "see what is there". One breach = 1, gross = 0.
4. **Progressive disclosure (2)** — Uses overview/nav for orientation, opens
   concept bodies only when the task needs depth, and doesn't paste large
   chunks of wiki or source into its own reasoning unnecessarily. Reading 2-3
   targeted source files to answer is fine; dumping whole trees is not.
5. **JIT timing & relevance (2)** — Journal/resume card present when prior
   sessions exist and is current; git-aware "recent files" hints match the
   actual recent commits; no stale or irrelevant injection noise.
6. **Capture quality (1)** — If the turn taught a durable fact, a correctly
   typed note lands in the right folder with valid frontmatter, no duplicate
   of an existing concept. If nothing was taught, credit only if the recap
   stayed silent (correct behavior).

## Score

9-10 wins the round. 7-8.5: fix the named gap. ≤6: the piece regressed.

## Probes

| id | prompt | tests |
|----|--------|-------|
| P1-mapfirst | In this repo, where is request throttling implemented, where is it applied, and how is it keyed? | 1,2,3,4, gate |
| P2-flow | Trace how a newly created task reaches the email handler, end to end. Name the queue pattern used. | 1,2,3,4, gate |
| P3-twins | I need to cache an expensive DB read inside an API route. Which cache module do I use and why? | 2,3,6, gate |
| P4-recent | What changed recently in this repo, and does any wiki note need refreshing because of it? | 5,2,4 |
| P5-capture | (After reading scripts/smoke.sh) add a probe: the smoke script must also hit /health of the worker once we add it; for now note the gotcha that smoke.sh silently passes when curl fails without -f. | 6 |
| P6-resume | Continue where we left off last session. | 5,1 |
