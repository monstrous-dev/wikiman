---
type: Learning
title: okf_version frontmatter is stamped at scaffold but never consumed
description: "`indexFrontmatter()` stamps `okf_version: "0.1"` into a bundle's root `index.md` at scaffold time (index.ts ~line 1232), but **nothing ever reads it** — there i"
tags: [okf, versioning, gotcha, migrations]
timestamp: "2026-11-16T08:48:51.977Z"
---

# okf_version frontmatter is stamped at scaffold but never consumed

`indexFrontmatter()` stamps `okf_version: "0.1"` into a bundle's root `index.md` at scaffold time (index.ts ~line 1232), but **nothing ever reads it** — there is no version check and no migration path. New extension versions can add bundle surfaces (e.g. `memory.md`, `changelog/`, nav markers) that pre-existing bundles never receive, silently.

This unused field is the natural hook for bundle update propagation: the extension declares a `BUNDLE_VERSION`, the bundle's `okf_version` frontmatter records the instance's current schema level (missing = `"0.1"` legacy), and a comparison drives ask-first additive migrations. See the update-propagation decision.

## Source

- `index.ts` — `indexFrontmatter()` (~line 1232): sole writer of `okf_version`; no consumer anywhere
