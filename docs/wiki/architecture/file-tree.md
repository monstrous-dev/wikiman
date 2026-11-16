---
type: Artifact
title: File tree
description: Complete project file listing with per-file descriptions.
timestamp: "2026-11-16T08:40:12.625Z"
---

# File tree — generated 2026-11-16T08:40:12.625Z
# Respects .wiki_ignore exclusions.
# [description] — shorthand summary of each file's function

.
├── .git/ [Git repository data — history and release tags]
├── .pi/ [Local pi session state for this checkout]
│   └── todos/ [pi's file-based todo storage for sessions here]
├── agents/ [Prompts for the companion sub-agents (copy to ~/.pi/agent/agents)]
│   ├── wiki-curator.md [Curator prompt — syncs wiki concepts to code changes, validates OKF]
│   └── wiki-recap.md [Recap prompt — end-of-turn background mining of decisions/rules/learnings]
├── docs/ [Project documentation]
│   └── wiki/ [The project's own OKF wiki bundle (dogfooded by the extension)]
├── skills/ [Skills shipped with the pi package]
│   └── wikiman/ [The wikiman skill folder]
│       └── SKILL.md [Wiki-first lookup order + recording taxonomy instructions for the LLM]
├── .gitignore [Git exclusions for local dev artifacts]
├── .wiki_ignore [Patterns excluded from staleness detection (wiki self-edits, build dirs)]
├── index.ts [The entire extension — context injection, wiki tools, staleness check, /wiki commands]
├── LICENSE [MIT license text]
├── package.json [pi package manifest — entry extension, skills folder, peer deps]
├── readme.html [Dev-local rendered README preview (not part of the package)]
├── README.md [Project README — features, install, how it works, security]
└── viewer.ts [Generates the self-contained HTML wiki viewer and serves it on localhost]
