---
type: Entity
title: "/wiki:self-update command"
description: "New extension command that performs the update loop in-app: ask-first TUI confirm, runs `pi update git:github.com/monstrous-dev/wikiman` (3-minute timeout), res"
tags: [extension, self-update]
timestamp: "2026-11-16T12:30:45.539Z"
---

# /wiki:self-update command

New extension command that performs the update loop in-app: ask-first TUI confirm, runs `pi update git:github.com/monstrous-dev/wikiman` (3-minute timeout), resets the update-check throttle, and notifies with updater output. Headless sessions fall back to printing the manual CLI command since the confirm needs the TUI. The session-start update-available notification points at this command as well. Note the running session keeps executing the old code until `/reload` — see [[extensions-load-at-session-start-only]].
