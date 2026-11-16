---
type: Rule
title: Auto-generated files in docs/wiki/ must be validator-invisible
description: Journal `.md` files without frontmatter tripped validator E1, and `wiki_mark_synced` refuses while errors exist — so agents burned tool calls fabricating frontm
tags: [wiki, validator, rule]
timestamp: "2026-11-16T10:24:49.330Z"
---

# Auto-generated files in docs/wiki/ must be validator-invisible

Journal `.md` files without frontmatter tripped validator E1, and `wiki_mark_synced` refuses while errors exist — so agents burned tool calls fabricating frontmatter (repair-fighting the writer, E3 on `type: Journal`). Rule: exclude any auto-generated file (e.g. `journal/`) from the wiki walk everywhere — validator, nav map, memory digest, search, viewer. Episodic ≠ semantic.
