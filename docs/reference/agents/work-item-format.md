# Work Item Format

Canonical metadata shape for specs, tickets and linked PRs in
`quantumquirkxyz/WorkBridge`.

## Metadata

| Field | Values | Notes |
|---|---|---|
| `labels` | `spec`, `type/*`, `area/*`, `priority/*`, `size/*`, triage labels | Inherited from the source spec unless justified |
| `milestone` | `M1 — Fundaciones`, `M2 — Operación y confianza`, `M3 — Piloto` | Release train, not a sprint |
| `project` | `WorkBridge v1` | GitHub Project board |
| `fields.work_type` | `Epic`, `Feature`, `Bug`, `Chore`, `Docs`, `Research`, `Release`, `Review-fix` | Mirrors `type/*` |
| `fields.repo_scope` | `apps/web`, `apps/agent-runtime`, `packages/domain`, `packages/solver`, `packages/training`, `packages/catalog`, `packages/profile`, `packages/ingestion`, `infra`, `docs` | Owning module |
| `fields.phase` | `Spec`, `Ready`, `In progress`, `Review`, `Blocked`, `Done` | Single source of work state |
| `fields.priority` | `Low`, `Medium`, `High`, `Urgent` | Driven by blocker order in ADR-0014 |
| `fields.risk` | `Low`, `Medium`, `High` | Touches domain invariants = High |
| `fields.iteration` | Sprint identifier | Sprint Backlog |
| `todo` | Checklist in the issue body | Acceptance criteria only |

## Labels

| Group | Labels |
|---|---|
| Triage | `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` |
| Type | `spec`, `type/feature`, `type/bug`, `type/chore`, `type/docs`, `type/research`, `type/release`, `type/review-fix` |
| Area | `area/web`, `area/runtime`, `area/domain`, `area/data`, `area/agents`, `area/infra`, `area/docs` |
| Priority | `priority/high`, `priority/urgent` (absence means normal) |
| Size | `size/s`, `size/m`, `size/l` |

## Rules

- A spec is one issue labelled `spec` + `ready-for-agent`, with
  `fields.work_type = Epic`, and it is the parent of every ticket in its initiative.
- A ticket is a sub-issue of the spec, labelled `ready-for-agent` plus inherited labels,
  with exactly one milestone and one project item.
- `blockedBy` is expressed with GitHub's native issue dependency (blocked by) and repeated
  in the body under `## Blocked By` with the reason.
- A PR inherits its issue's labels, milestone and project item. It never invents new
  metadata in comments or handoff notes.
- Work state is changed through `fields.phase`, never by adding ad hoc state labels.
- Do not close or modify the parent spec while publishing tickets.

## Tracker coupling

- `to-spec` writes the spec with this shape.
- `to-tickets` preserves it across every ticket and its native dependencies.
- `publish-open-pr` copies it to the PR.
- `plan-review-fixes` and `implement-review-fixes` keep it aligned during review loops.
- `ship-subissue` closes the ticket and updates `fields.phase` to `Done`.
