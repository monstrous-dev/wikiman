---
type: Learning
title: "Recap dedupe gap: transcript must include wiki-tool evidence"
description: `collectTurnText` originally captured only user/assistant text, so the recap could not see that a `wiki_note_*` call had already fired in-turn and wrote a parap
tags: [wiki-recap, dedupe]
timestamp: "2026-11-16T10:34:27.274Z"
---

# Recap dedupe gap: transcript must include wiki-tool evidence

`collectTurnText` originally captured only user/assistant text, so the recap could not see that a `wiki_note_*` call had already fired in-turn and wrote a paraphrase duplicate afterwards. Fix: surface `TOOL wiki_note_*` evidence in `collectTurnText` plus an "additions only; duplicating is the worst thing you can do" clause in the recap prompt. Verified via P7b: one learning, zero recap duplicates.
