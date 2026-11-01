# Grill with docs — product context refresh

**Identifier:** `product-context-refresh` · **Date:** 2026-10-30 · **Status:** refined

## What was grilled

The project's purpose, functional boundary, market scope, vacancy supply, notification
channel, deployment blockers and documentation surface. The starting point was a repository
that still described itself as a frozen hackathon submission while continuing to ship code.

## Decisions confirmed

| Decision | ADR |
|---|---|
| WorkBridge is a product in deployment; the submission is history | ADR-0011 |
| Tracker is `quantumquirkxyz/WorkBridge` | ADR-0012 |
| v1: all Panama, broader taxonomy, two vacancy sources | ADR-0013 |
| Seven production blockers, in order; fairness only where the auditor runs | ADR-0014 |
| One root context and a reduced documentation surface | ADR-0015 |

Supporting decisions:

- Curated vacancies support exploration, aptitude and a draft; the application continues
  through the original external link. Only employer-published vacancies carry the full
  internal lifecycle.
- v1 notifications are transactional email driven by the SQL outbox.
- Hackathon artifacts are deleted from the tree; git history and `final-24h` preserve them.
- Product docs in Spanish; governance docs in English.

## Documentation changes

**Rewritten:** `CONTEXT.md`, `README.md`, `docs/README.md`, `docs/arquitectura.md`,
`docs/reference/agents/domain.md`.

**Created:** `docs/despliegue.md`, `docs/runbook-piloto.md`,
`docs/reference/assumed-contracts.md`, ADR-0011 to ADR-0015.

**Removed:** `CONTEXT-MAP.md`, `docs/metodologia.md`, `docs/evals.md`,
`docs/bitacora-ia.md`, `docs/runbook-demo.md`, `docs/old/`.

**Amended:** ADR index, ADR-0002 and ADR-0009 status, `AGENTS.md`, and the
`assumed-contracts` test path.

> Rescue: `docs/old/reference/assumed-contracts.md` was read by
> `packages/domain/src/__tests__/assumed-contracts.test.ts`. It is a live contract
> reference, not history, so it moved to `docs/reference/assumed-contracts.md` and the
> test path was updated.

## Vocabulary added

Employer-published vacancy · Curated vacancy · Submission · Human gate · Production
blocker.

## Validation

- Relative Markdown links: 0 broken across tracked `.md` files.
- Tests and lint: **not run** — `node_modules` is absent in this working tree.

## Unresolved

1. The operator model for curated vacancies is not designed beyond "external link".
2. Taxonomy expansion and per-family fairness validation have no owner or ticket.
3. Email provider and delivery guarantees are unchosen.
4. Privacy and retention must satisfy Panamanian data-protection law; legal review pending.
5. Rotation of leaked credentials and history purge remain owner actions.

## Next consumer

`to-spec` to publish the ADR-0014 blockers as issues, or `implement` to start blocker 1
(persist drafts, submissions and interview state).
