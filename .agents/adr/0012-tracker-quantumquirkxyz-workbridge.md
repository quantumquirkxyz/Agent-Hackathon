# ADR-0012: Track work in quantumquirkxyz/WorkBridge

## Status

Accepted — 2026-10-30. Supersedes the tracker pointer in ADR-0009; the product name
decision in ADR-0009 stands.

## Context

ADR-0009 moved the tracker to `HackathonFISC/equipo-02` because that was the team's
competition queue and the remote of the delivery. After the decision to keep WorkBridge as
a deployed product (ADR-0011), the actual remote is
`https://github.com/quantumquirkxyz/WorkBridge.git`, and `AGENTS.md` and
`docs/reference/agents/issue-tracker.md` already name that repository. Three documents
still pointed at the competition organization, so an agent could file work where nobody
reviews it.

## Decision

- The issue tracker is **GitHub Issues in `quantumquirkxyz/WorkBridge`**.
- `gh issue` and `gh pr` commands target that repository; the current clone resolves it
  automatically.
- `CONTEXT.md` and `docs/reference/agents/issue-tracker.md` name that repository.
- The competition repository stays a historical archive and receives no new work.

## Consequences

- Tracker, remote and agent instructions agree.
- Issues filed against `HackathonFISC/equipo-02` are not part of the active queue.
- ADR-0009 remains the record of the naming decision; only its tracker pointer is
  superseded.

## Alternatives

- **Keep `HackathonFISC/equipo-02`.** Rejected: it is not the remote of this product and
  its queue is the competition's.
- **Split product and archive trackers.** Rejected: it doubles triage and creates two
  sources of truth for the same work.
- **Rewrite ADR-0009.** Rejected: it records a past decision. This ADR supersedes the part
  that changed.

## Links

- `.agents/adr/0009-name-workbridge-and-equipo-02-tracker.md`
- `docs/reference/agents/issue-tracker.md`
- ADR-0011
