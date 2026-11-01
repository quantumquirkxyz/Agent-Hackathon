# ADR-0011: Treat WorkBridge as a product in deployment, not a hackathon deliverable

## Status

Accepted — 2026-10-30. Supersedes the hackathon framing in ADR-0002 and ADR-0009.

## Context

WorkBridge was built for a 24-hour competition and frozen with the tag `final-24h`. The
README, `CONTEXT.md` and the documentation set still described it as a competition entry:
"Reto: 3", a team roster, a freezing checklist, an AI log and an evaluation tracker. The
repository has kept evolving after the tag, so that framing is now false and misleads
both contributors and agents about what the project is for.

The team's decision on 2026-10-30 is that WorkBridge is going to be deployed for real.

## Decision

- WorkBridge is a **product in deployment**. Its documentation describes a live system
  with users, a deployment and production blockers.
- The competition submission is **history**: it stays in git history and in the annotated
  tag `final-24h`, and is not part of the current documentation surface.
- Hackathon-specific artifacts are removed from the working tree: competition framing in
  the README, the freezing checklist, the AI log, the evaluation document and the
  superseded `docs/old/` tree.
- Product documentation is written for operators and users of a deployed system, not for
  judges.

## Consequences

- The README, `CONTEXT.md`, `docs/arquitectura.md` and the deployment runbooks are
  rewritten around purpose, scope, invariants, deployment and known limitations.
- Obligations that only mattered for a demo (a three-minute video, a rubric mapping, a
  timed rehearsal) disappear; obligations that matter for production (persistence,
  national data, real verification, privacy, cost) become explicit.
- ADR-0014 records the production blockers. A red gate or a known limitation is now a
  product risk, not a scoring risk.
- Removing files from the tree does not erase them: `git log` and the tag preserve the
  submission exactly as it was.

## Alternatives

- **Keep the frozen-deliverable framing.** Rejected: the repository keeps receiving
  changes, so the fiction would contradict the code and the tracker.
- **Keep both narratives side by side.** Rejected: two identities produce documents that
  disagree about scope and quality bars, which is what this refinement exists to remove.
- **Rewrite the historical documents in place.** Rejected: they are records of decisions
  as they were made. Deleting them from the tree and leaving git history intact is
  honest and cheaper than falsifying the record.

## Links

- `CONTEXT.md`
- `README.md`
- ADR-0002, ADR-0009 (framing superseded)
- ADR-0013 (scope), ADR-0014 (production blockers), ADR-0015 (documentation surface)
