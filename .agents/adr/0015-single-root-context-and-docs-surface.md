# ADR-0015: Use one root context and a reduced documentation surface

## Status

Accepted — 2026-10-30. Supersedes the multi-context layout announced in `CONTEXT-MAP.md`.

## Context

`CONTEXT-MAP.md` declared eight domain contexts — one per app and package — and marked all
of them "Pending creation". None was ever written. The repository has one coherent domain:
candidates, vacancies, evidence, decisions, human gates. Per-package context documents
would repeat the root vocabulary, need an owner each, and drift the moment a package
changes. Meanwhile the documentation set had grown to serve a competition evaluation:
methodology, evaluation cases, AI log, demo runbook and a superseded archive.

## Decision

- **One context document**: the root `CONTEXT.md`. `CONTEXT-MAP.md` is deleted.
- Local `CONTEXT.md` files are created only when a package develops a vocabulary or
  boundary that the root cannot express. None exists today.
- The documentation surface is:
  - `README.md` — what the product is, how to run it, current state.
  - `docs/arquitectura.md` — agents, tools, flows, human gates.
  - `docs/despliegue.md` — environments, migrations, variables, health, security.
  - `docs/runbook-piloto.md` — operating a pilot.
  - `.agents/adr/` — durable decisions.
  - `docs/reference/agents/` — tracker, labels and domain-doc rules for agents.
- Product documents are written in Spanish; governance documents (`CONTEXT.md`, ADRs,
  `AGENTS.md`) are written in English.
- Competition documents (methodology, evaluation, AI log, demo runbook) and `docs/old/`
  are removed from the tree. Git history keeps them.

## Consequences

- `AGENTS.md`, `docs/reference/agents/domain.md` and any skill that mentions
  `CONTEXT-MAP.md` must point at the root context instead.
- Adding a local context later is allowed, but it needs a real seam and an owner; the
  default is "no".
- The documentation surface is small enough that a single change can keep it consistent.
- Losing `docs/old/` removes the only record of the pre-submission interface; that record
  is now `git log`, not a browsable tree.

## Alternatives

- **Write all eight context documents.** Rejected: most would restate the root, and none
  has an owner.
- **Keep the map but mark contexts optional.** Rejected: it still promises files that do
  not exist and sends readers to dead paths.
- **Keep every document and only remove the competition wording.** Rejected: the surface
  would stay large and the superseded archive would keep competing with current docs.

## Links

- `CONTEXT.md`
- `CONTEXT-MAP.md` (deleted by this decision)
- `docs/README.md`, `AGENTS.md`, `docs/reference/agents/domain.md`
- ADR-0011
