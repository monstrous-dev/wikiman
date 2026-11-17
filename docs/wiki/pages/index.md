# Pages

Knowledge graph: concepts, entities, and artifacts that make up this project.

- [Concepts](./concepts/) — Abstract ideas, definitions, and categories
- [Entities](./entities/) — Concrete named things, systems, tools, and records
- [Artifacts](./artifacts/) — Documents, diagrams, code files, and deliverables
- [Inline Recap Pipeline](./entities/inline-recap-pipeline.md) — The end-of-turn recap subsystem of `index.ts`: after each coding turn, one
- [wikiman-e2e harness and acme-ops fixture](./artifacts/wikiman-e2e-harness-and-acme-ops-fixture.md) — E2E test setup at `C:\Users\PTW\wikiman-e2e\`: `acme-ops` fixture (58 files, 4 git commits, legacy `okf_version 0.1` bundle, planted traps incl. ratelimit-unmou
- [Bundle migration engine (F2)](./entities/bundle-migration-engine-f2.md) — Shipped F2: versioned bundle migration via `BUNDLE_VERSION="0.2"` with `readBundleVersion`/`migrateBundle`/`bumpBundleVersion`, wired into `session_start` and `
- [R3 injection contract rework (planned)](./entities/r3-injection-contract-rework-planned.md) — Next planned work: hard imperative operating contract at the top of every injection ("the map is already in your context — consult it FIRST; grep/find is the fa
- [Session journal / resume card (R2)](./artifacts/session-journal-resume-card-r2.md) — Completion call now returns notes + journal in one shot; entries in `journal/2026-11.md` with `attempted`/`landed`/`open` fields (empty fields omitted, journal
- [/wiki:self-update command](./entities/wiki-self-update-command.md) — New extension command that performs the update loop in-app: ask-first TUI confirm, runs `pi update git:github.com/monstrous-dev/wikiman` (3-minute timeout), res
- [Background init (instant scaffold + off-session auto-doc)](./entities/background-init-instant-scaffold-off-session-auto-doc.md) — New-project init (commit `41c02fb`) is now non-blocking: the deterministic scaffold returns instantly with a notify ('auto-doc running in the background'), and
- [wikiman-improvement-handover.md fully implemented as of v0.2.0](./artifacts/wikiman-improvement-handover-md-fully-implemented-as-of-v0-2.md) — All handover items R1–R8 plus §5–§7 conventions/verification/release are done (commits `ec1034a`, `c3a42dd`, `45545cf`, `26f6a1f`, `c76d1f1`; v0.2.0 tagged/rele
