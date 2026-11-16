---
type: Learning
title: Debounce timer dies when pi -p exits (headless recap race)
description: "The journal/recap write used a 1.2s debounce timer, which is killed when `pi -p` exits — the journal silently never landed in headless mode. Fix: in headless ha"
tags: [pi-extension, headless, debounce]
timestamp: "2026-11-16T10:24:49.324Z"
---

# Debounce timer dies when pi -p exits (headless recap race)

The journal/recap write used a 1.2s debounce timer, which is killed when `pi -p` exits — the journal silently never landed in headless mode. Fix: in headless hatch mode run the recap inline (awaited); RPC mode stays excluded as a recursion guard.
