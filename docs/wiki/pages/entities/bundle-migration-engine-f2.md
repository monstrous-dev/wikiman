---
type: Entity
title: Bundle migration engine (F2)
description: "Shipped F2: versioned bundle migration via `BUNDLE_VERSION="0.2"` with `readBundleVersion`/`migrateBundle`/`bumpBundleVersion`, wired into `session_start` and `"
tags: [migration, f2]
timestamp: "2026-11-16T10:03:12.666Z"
---

# Bundle migration engine (F2)

Shipped F2: versioned bundle migration via `BUNDLE_VERSION="0.2"` with `readBundleVersion`/`migrateBundle`/`bumpBundleVersion`, wired into `session_start` and `/wiki:init`. Migrations are **additive-only** — legacy 0.1 bundles get `changelog/`, `journal/`, `memory.md` scaffolded and the nav map injected between fresh markers without touching authored overview/glossary/learnings.
