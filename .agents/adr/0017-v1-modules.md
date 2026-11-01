# ADR-0017: Add the operator panel, the training-center portal and the interview UI to v1

## Status

Accepted — 2026-10-30.

## Context

The product has three user surfaces: candidate, employer and counselor. Two gaps make a
real deployment impossible:

- Curated vacancies, email retries, organizations and incident review have no owner
  surface; today they would be handled with scripts and SQL by whoever operates the
  deployment.
- The problem statement names training centers as one side of the market, but courses are
  a static fixture with no owner, no availability and no expiry.

The simulated interview exists as an API with a fixed rubric but no screen, so candidates
cannot use it.

Analytics for the anchor organization matters for funding, but it can be answered with SQL
and saved queries before it justifies a product surface.

## Decision

v1 adds three modules:

1. **Operator panel** (`/operador`): organizations and employers, curated vacancy upload
   (CSV or internal API) with source and freshness, catalog review, outbox retry, incident
   queue with `trace_id`, and minimal funnel metrics.
2. **Training-center portal** (`/centro`): publish and update courses with provider,
   modality, hours, cost, seats and validity; retire expired courses.
3. **Simulated interview with UI** (`/entrevista`): the existing deterministic rubric with
   a screen, no LLM and no new domain.

Analytics as a product surface is deferred to v1.1; v1 answers impact questions with SQL
and saved queries.

## Consequences

- Two new roles join the authorization model: `operator` and `training_center`. Both are
  assigned by seed or invitation, never by open registration.
- Curated vacancies need provenance fields (`source`, `fetchedAt`, `validUntil`) and a
  visibility rule independent of an employer organization.
- Courses need an owner, availability and expiry, and the roadmap must handle a course
  that disappears.
- The operator panel becomes the place where the email outbox is retried, which closes the
  operational loop for blocker 5 of ADR-0014.
- More surface means more tests: each module needs its own e2e seam.

## Alternatives

- **Only the three current roles.** Rejected: curation and support become manual SQL, and
  training centers stay a fixture.
- **All four modules including analytics.** Rejected for v1: a BI surface needs its own
  data model and owner; SQL covers the first questions.
- **Training centers as a spreadsheet import only.** Rejected: without an owner, seats and
  expiry go stale and the roadmap recommends courses that do not exist.

## Links

- `docs/producto.md`
- ADR-0013 (scope and dual supply), ADR-0014 (blockers), ADR-0016 (stack)
