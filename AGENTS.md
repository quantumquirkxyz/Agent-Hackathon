# AGENTS.md — WorkBridge

Repository-specific guidance for agents (and humans) working in this repository.
This file is an active instruction path, not documentation: changes to it go
through the normal review flow like any other change.

- The repository-local Agent Skills bundle lives in `.agents/`. For bundle mechanics
  (canonical skills, lockfile, compatibility view) read `.agents/AGENTS.md`.
- When the next step is unclear, route through the `ask-to` skill
  (`.agents/skills/routing/ask-to/SKILL.md`) instead of guessing.

## What this repository is

**WorkBridge** — a multi-agent employability system for young people in Panama.
It evaluates readiness for a specific job, recognises formal and informal
experience, verifies credentials, identifies skill gaps, recommends a constrained
learning roadmap, and prepares a job application for human approval.

- Domain vocabulary and boundaries: `CONTEXT.md` (single root context; keep it domain-only).
- Architecture of record: `docs/arquitectura.md` (agents, tools, human gates, and a
  "Limitaciones conocidas" section that is kept honest on purpose).
- Product definition and v1 modules: `docs/producto.md`.
- Stack target, integrations and migration plan: `docs/stack.md`.
- Deployment and operations: `docs/despliegue.md`. Pilot runbook: `docs/runbook-piloto.md`.
- Production blockers and scope: ADR-0013 and ADR-0014. WorkBridge is a deployed product,
  not a hackathon deliverable (ADR-0011).

## Stack and layout

| Concern | Value |
|---|---|
| Language / runtime | TypeScript strict on Node.js >= 22 (`"type": "module"`) |
| Package manager | Bun workspaces — target; npm is the current tree until the migration lands (ADR-0016) |
| Web surface | Next.js 16 app router, `apps/web` |
| Runtime API | Hono — target; `node:http` is the current tree |
| Agent runtime | Node service, `apps/agent-runtime` (Mastra agent graph + deterministic services) |
| Database | Neon Postgres; Drizzle ORM target over `migrations/001..004` |
| Validation | Ajv + JSON Schema for domain contracts; Zod at HTTP, form and env edges |
| Styling | Tailwind CSS v4 + shadcn/ui (ADR-0007) |
| Tests | Vitest (node + jsdom projects), Playwright for e2e |
| Integrations | Resend, Accredible/Credly (Certo adapter), Google Maps, OpenRouter, Sentry/OTel/Langfuse |
| Delivery | Containers for web, runtime and worker on one PaaS (ADR-0019) |
| Issue tracker | GitHub Issues in `quantumquirkxyz/WorkBridge` (historical clone name: `Agent-Hackathon`) |
| ADRs | `.agents/adr/` — note: **not** `docs/adr/` |
| Assessments | `.reports/` (e.g. a project-viability report) |

```
apps/web/            Next.js surfaces (candidate, empresa, orientador, operador, centro) + BFF handlers
apps/agent-runtime/  Agent graph (workflow/), matching, vacancy, verification, application service
packages/            domain, profile, catalog, solver, training, ingestion
migrations/          SQL schema
docs/                current docs (product, architecture, deployment, pilot runbook)
.agents/             canonical skills bundle, ADRs, platform tooling
.reports/            assessment artifacts (viability, audits)
```

## Commands

| Command | Purpose |
|---|---|
| `npm ci` | Install (lockfile-faithful) |
| `npm run dev` | Next.js web dev server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest run (all projects) |
| `npm run test:coverage` | Vitest + v8 coverage (gate thresholds) |
| `npm run test:e2e` | Playwright (needs the web + runtime running) |
| `npm run lint` | ESLint |
| `npm run gate:ci` | `lint && typecheck && test:coverage` — the blocking gate |
| `npm run verify` | `lint && typecheck && test` |
| `npm run db:migrate` | Apply SQL migrations (needs `neon` CLI + env) |
| `npm run seed:roles` / `npm run seed:demo` | Seed roles and demo data |
| `docker compose up --build -d` | Local stack (`npm run local:up`) |

Coverage thresholds from `vitest.config.ts`: 80% lines/statements/functions,
70% branches, over `packages/*/src`, `apps/agent-runtime/src/application` and
`apps/web/lib`.

## Definition of done

Work is done when, at minimum:

1. `npm run gate:ci` passes (`typecheck` + `test:coverage`) — gate-ci
2. changed files pass lint and format — gate-ide / gate-pre-commit
3. acceptance criteria are covered by tests written at the agreed seam
4. the change is committed on a short-lived branch with conventional commit
   messages, and documented in an `ImplementArtifact` under
   `.agents/skills/platform/artifacts/implement/`

Do not open a PR with a red `gate:ci`. Known pre-existing red signals are listed
under "Known state" below — do not treat them as caused by your change, but do
not add to them.

## Issue workflow

1. **Pick the issue.** Work is tracked as GitHub issues in
   `quantumquirkxyz/WorkBridge` (`gh issue list`). One issue (or spec slice)
   per branch.
2. **Branch.** Create a short-lived branch from `main`, named from the issue
   reference, e.g. `feat/issue-12-role-based-approval` or
   `fix/issue-12-draft-employer-org`. Keep it under ~24h old.
3. **Slice.** One tracer bullet at a time: failing test → minimal implementation →
   gates → commit. Do not batch slices before committing.
4. **Commit.** Conventional commits (`feat(scope): …`, `fix(scope): …`,
   `docs: …`), one logical change each. Do not mix an unrelated repair into a
   feature commit; if an unrelated defect blocks the gate, fix it as its own
   commit and say so.
5. **Hand off.** Stop at a validated branch. `publish-open-pr` pushes the branch and
   opens the PR (never before gate-ci passes, and never creating commits). The
   linked issue's labels and milestone are the source of truth for PR metadata.
6. **Finish.** `review-pr` reviews, `ship-subissue` merges, closes the issue, and
   syncs the tracker. Agents never merge or close on their own initiative.

Feature flags protect incomplete features; keep them short-lived and delete the
flag once the feature is permanent.

## Agent skills

See `.agents/AGENTS.md` for the bundle and `ask-to` for routing.

### Issue tracker

GitHub Issues in `quantumquirkxyz/WorkBridge` (historical clone name: `Agent-Hackathon`), driven with the `gh` CLI
(`gh issue list`, `gh issue create`, `gh pr`). Specs are published by `to-spec`,
tracer-bullet tickets by `to-tickets`, PRs by `publish-open-pr`.

### Triage labels

Incoming work uses the canonical triage roles: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. `triage` applies labels to
incoming work; `to-spec` and `to-tickets` may also assign workflow labels to
published artifacts. Tickets produced by `to-tickets` are already agent-ready.
`spec` marks a published specification.

### Domain docs

Single-context layout: read the root `CONTEXT.md`; it holds the product's purpose, scope,
vocabulary, invariants and stack. Do not create per-package context documents unless a
package earns a seam of its own (ADR-0015). Durable design decisions are ADRs under
`.agents/adr/`. Add or change terminology only through `grill-with-docs` /
`domain-modeling`, recording an ADR when the decision is hard to reverse.

## Domain rules that must not be broken

These are the invariants the product is sold on. Breaking one is a defect, not a
trade-off:

- **The model does not decide hard constraints.** Aptitude, hard constraints,
  scoring, assignment (HiGHS MILP with a greedy fallback), training roadmaps and
  credential verification are deterministic code. The LLM only converses, extracts
  and drafts, and every LLM use has a no-LLM fallback.
- **Agents never send.** `submit_application`, `progress_interview` and
  `send_message` are always denied to agents. Human gates (candidate, counselor,
  employer) decide every sensitive step.
- **Evidence has a status.** Facts are `declared`, `extracted`, `verified` or
  `rejected`; invented credentials are rejected and unverified claims must not be
  presented as verified.
- **Ownership is a server fact.** An employer sees a submission only when the
  runtime resolves the vacancy's owning organization; a value claimed in a request
  body is never authoritative. Drafts without a resolvable owner stay invisible.
- **Fairness is enforced, not advisory.** Discriminatory vacancy requirements block
  ranking and route to a human; the counterfactual bias auditor is the source of
  bias alerts, not the vacancy document.
- **PII is redacted before any model call.** Never commit real candidate data,
  secrets, or `.env` files; CI-committed fixtures must stay synthetic.

## Known state

Snapshot of things an agent should know before touching the repo. Re-check rather
than trust; fix the list when you fix the cause.

- **CI runs `gate:ci`.** `.github/workflows/ci.yml` runs `npm ci` + `npm run
  gate:ci` on every pull request and on `main`, with least-privilege
  `permissions: contents: read` and a cancelling concurrency group. The gate
  includes lint, typecheck and coverage.
- **Production blockers are open.** ADR-0014 lists seven, in order: persist drafts and
  submissions, national transfer data, real credential verification, bias auditor on the
  web path, email notifications, paid models, and privacy/retention. Do not present the
  product as deployable while any of them is open.
- **The five-agent orchestrator is not on the web path.** It is exercised by tests;
  the web reuses the deterministic pieces through `intake`/`explore`/`match`/`roadmap`
  handlers. See `docs/arquitectura.md` §7 and ADR-0014 blocker 4.
- **Curated vacancies have no owning organization.** They support exploration, aptitude
  and a draft; the application continues through the original external link (ADR-0013).
- **Committed coverage report is narrow.** `apps/agent-runtime/coverage` instruments
  only a subset of files; trust a fresh `npm run test:coverage` instead.
- **No `CONTRIBUTING.md` / `CODE_OF_CONDUCT.md`.** Open-source onboarding surface is
  incomplete.
