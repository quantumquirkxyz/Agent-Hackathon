# Work Item Format

Canonical metadata shape for specs, tickets and linked PRs in
`quantumquirkxyz/WorkBridge`.

## Metadata

| Field | Values | Notes |
|---|---|---|
| `labels` | `spec`, `type/*`, `area/*`, `priority/*`, `size/*`, `wayfinder:*`, triage labels | Inherited from the source spec unless justified |
| `milestone` | `M1 — Fundaciones`, `M2 — Operación y confianza`, `M3 — Piloto` | Release train, not a sprint |
| `project` | `WorkBridge — Professional Pilot Delivery` (project 27) | The only board |
| `fields.status` | `Backlog`, `Ready`, `In Progress`, `Review`, `Blocked`, `Done` | Single source of work state |
| `fields.priority` | `Low`, `Medium`, `High`, `Urgent` | Driven by blocker order in ADR-0014 |
| `fields.size` | `S`, `M`, `L` | Larger than `L` is split, not labelled |
| `fields.risk` | `Low`, `Medium`, `High` | Touches domain invariants = High |
| `fields.sprint` | Iteration value | Timebox, never a milestone |
| `todo` | Checklist in the issue body | Acceptance criteria only |

Native GitHub relationships carry the rest: parent issue, sub-issues progress, linked pull
requests, reviewers and assignees. No `Phase`, `Repo Scope`, `Work Type`, `Release Train`,
`Outcome Owner` or `Launch Gate` field exists; do not invent one.

## Labels

| Group | Labels |
|---|---|
| Triage | `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` |
| Type | `spec`, `type/feature`, `type/bug`, `type/chore`, `type/docs`, `type/research`, `type/release`, `type/review-fix` |
| Area | `area/web`, `area/runtime`, `area/domain`, `area/data`, `area/agents`, `area/infra`, `area/docs` |
| Priority | `priority/high`, `priority/urgent` (absence means normal) |
| Size | `size/s`, `size/m`, `size/l` |

## Rules

- A spec is one issue labelled `spec` + `ready-for-agent` (the `spec` label is its type; add
  the relevant `type/*` label only when the spec is also a feature, chore, docs or research
  effort), and it is the parent of every ticket in its initiative.
- A ticket is a sub-issue of the spec, labelled `ready-for-agent` plus inherited labels,
  with exactly one milestone and one project item.
- `blockedBy` is expressed with GitHub's native issue dependency (blocked by) and repeated
  in the body under `## Blocked By` with the reason.
- A PR inherits its issue's labels, milestone and project item. It never invents new
  metadata in comments or handoff notes.
- Work state is changed through `fields.status`, never by adding ad hoc state labels. A
  planning lifecycle (the wayfinder map, its decision tickets, a spec) is identified by label
  and filtered out of the execution view; it is never a second status.
- Do not close or modify the parent spec while publishing tickets.

## Tracker coupling

- `to-spec` writes the spec with this shape.
- `to-tickets` preserves it across every ticket and its native dependencies.
- `publish-open-pr` copies it to the PR.
- `plan-review-fixes` and `implement-review-fixes` keep it aligned during review loops.
- `ship-subissue` closes the ticket and updates `fields.status` to `Done`.

## Board binding

Board: https://github.com/users/quantumquirkxyz/projects/27 (`WorkBridge — Professional Pilot
Delivery`), linked to `quantumquirkxyz/WorkBridge`. Five views: Planning, Execution Board,
Blocked, Review, Roadmap. The board README is the source of record for cadence, gates and
limitations.
