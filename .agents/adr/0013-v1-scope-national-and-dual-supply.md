# ADR-0013: Define the v1 scope — national coverage, broader taxonomy, two vacancy sources

## Status

Accepted — 2026-10-30. Narrows the MVP focus in ADR-0002 the other way: the product now
targets the whole country and more occupations.

## Context

ADR-0002 scoped WorkBridge to junior technical support, customer service and
administration in Panama Metro and Panama Oeste, as a demonstrable 24-hour flow. As a
deployed product, that scope is too small to matter: young people outside those regions
and occupations have the same information problem. At the same time, the product cannot
become a general job marketplace; that would dilute the determinism, the human gates and
the fairness guarantees it is sold on.

Two facts about the current implementation shape the scope:

- The runtime already supports a full application lifecycle (draft, approvals,
  submission, interview decision) for vacancies with a resolvable owning organization.
- The local geocoding fallback is a partial Panama catalog, and the vacancy catalog is a
  seed. Neither scales to national coverage without real data.

## Decision

**In scope for v1**

1. National coverage of Panama.
2. A broader occupation taxonomy than the original three families.
3. Two vacancy sources:
   - **Employer-published vacancy**: created in WorkBridge, owned by a resolvable
     organization, and carrying the full internal lifecycle.
   - **Curated vacancy**: ingested from an external portal or curated by the operator. It
     has no owning organization inside WorkBridge and supports exploration, aptitude and a
     draft; its application continues through the original external link.
4. The complete application lifecycle stays inside the product for employer-published
   vacancies.
5. Email notifications driven by the SQL outbox.

**Out of scope for v1**

- Payments, contracts, payroll or background checks.
- Live audio or voice interviews.
- SMS or WhatsApp notifications.
- Agents that send applications, progress interviews or send messages.
- Claiming internal ownership of a curated vacancy.

## Consequences

- The transfer constraint must be backed by real national data; the local matrix becomes a
  development fallback only (blocker 2 in ADR-0014).
- Adding occupation families means extending the ESCO-backed taxonomy, the vacancy
  normalization rules and the fairness rules, and validating each new family before
  ranking it. Fairness cannot be asserted for a family that has never been audited.
- The curated source needs provenance and freshness rules, and a visible external link,
  but no employer organization, shortlist or interview decision.
- "Curated" and "employer-published" become first-class domain terms in `CONTEXT.md`.
- The catalogs are a starting point, not the scope: expanding them is product work, not an
  accepted limit.

## Alternatives

- **Keep Metro and Oeste with three families.** Rejected: it caps the product's value and
  contradicts the decision to deploy for real.
- **Only employer-published vacancies.** Rejected: employers are the slower side to
  acquire; the curated source gives candidates value from day one.
- **Own curated vacancies as the operator and run the internal lifecycle.** Rejected: it
  would require contacting third-party employers on the candidate's behalf and would make
  WorkBridge responsible for a submission it does not control.
- **Curated vacancies for exploration only.** Rejected: it discards the draft, which is
  the product's main candidate-side value.

## Links

- `CONTEXT.md`
- ADR-0002 (MVP boundaries), ADR-0004 (catalog seam), ADR-0008 (organization ownership)
- ADR-0014 (blockers that make this scope real)
