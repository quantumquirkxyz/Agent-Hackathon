# ADR-0020: Operate WorkBridge through an anchor organization (B2B2C)

## Status

Accepted — 2026-10-30.

## Context

The product has three sides: young candidates, employers and counselors. Counselors are
the human gate that makes the product trustworthy, but they are also a cost with no
revenue attached. If WorkBridge is a free open marketplace, nobody funds the counselors;
if it is a public program, procurement and integration timelines decide the roadmap.

The team must also decide who is accountable for moderation, data protection and support
when a real candidate uses the product.

## Decision

- An **anchor organization** — an NGO, an employment center or a program — licenses
  WorkBridge and provides the counselors.
- Employers publish vacancies for free. Candidates reach the product through the anchor
  organization, not through mass advertising.
- The anchor organization is accountable for moderation, data-protection compliance and
  counselor quality.
- v1 runs **one anchor organization** with many employers. White-label multi-tenancy is out
  of scope.
- Pricing and contract terms are commercial decisions and are not fixed by this ADR.

## Consequences

- The operator role belongs to the anchor organization; the operator panel is its tool.
- Success is measured by the anchor organization's outcomes: placements, time to first
  decision, gap closure and counselor SLA.
- Candidate acquisition is a partnership activity, not a growth-loop activity.
- The data-protection policy must be agreed with the anchor organization before real data
  enters the system (blocker 7 of ADR-0014).
- Adding a second anchor organization later requires real multi-tenancy; the current
  organization binding is a starting point, not a complete tenant model.

## Alternatives

- **Open marketplace.** Rejected: without a funded counselor, the human gate disappears
  and the product loses its differentiator.
- **Public program as operator.** Rejected for v1: procurement and integration timelines
  are outside the team's control; it remains a possible anchor organization.
- **White-label from day one.** Rejected: multiplies the data model and the authorization
  surface before the first deployment works.
- **Charge employers per posting.** Rejected for v1: slows the supply side that the anchor
  organization is already recruiting.

## Links

- `docs/producto.md`
- ADR-0013 (scope), ADR-0014 (blockers), ADR-0017 (operator panel)
