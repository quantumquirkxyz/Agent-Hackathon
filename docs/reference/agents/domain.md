# Domain Docs

This repository uses a single root context.

## Before exploring

1. Read `CONTEXT.md` at the repository root: purpose, scope, vocabulary, invariants, stack.
2. Read system-wide ADRs under `.agents/adr/`.
3. Read the architecture of record in `docs/arquitectura.md` when the question touches
   agents, tools, flows or human gates.

There is no context map and no per-package context document. Create one only when a
package develops a vocabulary or boundary the root cannot express, and record that
decision as an ADR (ADR-0015).

## Vocabulary and conflicts

Use the vocabulary defined by `CONTEXT.md`. If a proposed output contradicts an existing
ADR, state the conflict explicitly instead of silently overriding it.

## Layout

- Root context: `CONTEXT.md`
- System-wide decisions: `.agents/adr/`
- Architecture: `docs/arquitectura.md`
- Deployment and operations: `docs/despliegue.md`
