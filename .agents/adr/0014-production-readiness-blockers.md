# ADR-0014: Require seven blockers to be closed before the first real deployment

## Status

Accepted — 2026-10-30. Tracks the work that separates the current code from a deployable
product (ADR-0011).

## Context

WorkBridge works as a tested system, but several of its behaviours were designed for a
demo: state that lives in process memory, optional external services, free language models
and a fairness auditor that runs in the agent graph while the web calls the deterministic
pieces directly. Deploying with any of those unresolved would break a promise the product
makes to candidates, employers or counselors.

## Decision

The following are **blocking for v1**, in this order. Each must close with tests at the
agreed seam before the product handles real users.

| # | Blocker | Why it blocks | Evidence it is closed |
|---|---|---|---|
| 1 | Persist drafts, submissions and interview state in Postgres | They live in the runtime process and are lost on restart | A restart preserves an open draft and its approval history |
| 2 | National transfer data with a real provider | The local matrix is a partial Panama catalog | Aptitude uses real distances for the full covered territory, with a recorded fallback reason |
| 3 | Real credential verification in production | The mock must never be presented as external verification | Mock is refused or clearly flagged outside development |
| 4 | Run the bias auditor on the path the web actually uses | A fairness claim is false where the auditor does not run | A discriminatory vacancy blocks ranking in the web flow and raises a counselor gate |
| 5 | Email notifications from the outbox | With `in_app` only, employers never learn of a submission | A submission produces a delivered email and an audited outbox row |
| 6 | Paid models with a budget | Free models degrade and cannot carry production quality | Production uses paid models with per-capability budget and a recorded fallback |
| 7 | Privacy, retention and deletion policy | Real candidate data carries legal and ethical duties | Documented retention, deletion and consent behaviour, enforced in code where possible |

Rules that follow from this decision:

- A fairness claim is only valid where the auditor runs. Until blocker 4 closes, documents
  and the interface must not imply that the web flow audits bias.
- No production deployment may run with `WORKBRIDGE_PERSISTENCE=memory`.
- "It works in the demo" is not acceptance evidence for any of the seven.

## Consequences

- `docs/arquitectura.md` marks each limitation with its blocker number.
- The README lists the blockers instead of hiding them.
- The first pilot runbook must state which blockers are still open; a pilot can run with
  synthetic data before blocker 7 closes, but not with real candidate data.
- Ordering is deliberate: persistence and real geography first, because they change the
  data model the later work depends on.

## Alternatives

- **Ship the demo as v1.** Rejected: it loses drafts on restart and claims fairness that
  does not run on the real path.
- **Close the fairness gap by weakening the claim.** Rejected: fairness is an invariant of
  the product, not a marketing line (see `CONTEXT.md`).
- **Fix everything before any pilot.** Rejected: a synthetic-data pilot validates the flow
  while blockers close, provided the open blockers are stated.

## Links

- `CONTEXT.md` (invariants)
- `README.md` (state and known limits)
- `docs/arquitectura.md` §7
- ADR-0003 (verification and human approval), ADR-0010 (trusted decision source)
