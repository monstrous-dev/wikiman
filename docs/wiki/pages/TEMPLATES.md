---
type: Concept
title: Page Templates
description: Reference templates for Concept, Entity, and Artifact pages. Follow these when using wiki_note_page.
timestamp: 2026-11-16T08:39:12.995Z
---
# Page Templates

Use these when documenting the projectbase with `wiki_note_page`. Each type has
a stable structure so pages are consistent, skimmable, and well-linked.

## Concept (abstract ideas, definitions, patterns, categories)

```markdown
## What is it?
[One paragraph — clear definition the team can agree on.]

## Why does it matter?
[What problem it solves, what depends on it, or what would break without it.]

## Key rules / properties
- [Characteristic or invariant]
- [Edge case to watch for]

## Relationships
- [[entity-that-implements-this]] — how
- [[related-concept]] — how

## Source
- \`path/to/file.ts\` — implements or references this concept
```

## Entity (concrete named things: endpoints, services, models, tools)

```markdown
## What is it?
[Concrete thing — what it IS, where it lives.]

## Why does it matter?
[Its role in the system, who/what depends on it.]

## Details
- **Location**: \`path/to/file\`
- **Interface / Schema**: [key fields, methods, routes, or shape]
- **Configuration**: [env vars, flags, settings]

## Relationships
- [[concept-it-implements]] — what abstract idea this instantiates
- [[entity-it-depends-on]] — dependency or peer

## Lifecycle
- First added: [when, why]
- Significant changes: [date — what changed]
```

## Artifact (deliverables: diagrams, reports, specs, configs, screenshots)

```markdown
## What is it?
[Document, diagram, report, or file — what it contains.]

## What it documents
- [[entity-or-concept]] — what this artifact describes or supports

## Details
- **Format**: [diagram type, file format, tool used]
- **Location**: \`path/to/file\`

## Source
- Generated from: [what data, process, or session produced it]
```
