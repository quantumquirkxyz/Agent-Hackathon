# Context

This is the single, system-wide context document for **WorkBridge**. The repository
uses one root context (decision recorded in ADR-0015); there is no context map and no
per-package context document until a package earns one with a seam of its own.

WorkBridge is a product in deployment, not a hackathon deliverable (ADR-0011). The
hackathon submission is history: it lives in git history and in the annotated tag
`final-24h`. No current document frames WorkBridge as a competition entry.

## Purpose

WorkBridge is a multi-agent employability system for young people in Panama. It
evaluates readiness for a specific job, recognises formal and informal experience,
verifies credentials, identifies skill gaps, recommends a constrained learning
roadmap, and prepares a job application that a human approves before it is sent.

The product is operated by an **anchor organization** (an NGO, employment center or
program) that licenses it and provides the counselors; employers publish for free and
candidates arrive through the organization (ADR-0020).

The product exists to fix an information failure on three sides of the youth
employment market:

- Young people cannot translate informal experience into an employer's language, nor
  tell which course would close their gap.
- Employers receive applications that do not fit and publish vague or discriminatory
  requirements.
- Training providers offer courses that do not reach the people who need them.

Geography is part of the problem: an offer in Tocumen can be infeasible for someone in
La Chorrera because of commute time and cost.

## Users and roles

| Role | What they do | Surface |
|---|---|---|
| Candidate | Converses to build a profile, explores vacancies, reads an explainable aptitude decision, follows a training roadmap, reviews and approves an adapted application, sends it | `apps/web` candidate surfaces |
| Employer | Publishes vacancies (text, PDF or image), sees an audited shortlist, decides on an interview with a recorded reason | `apps/web` employer surfaces |
| Counselor | Reviews cases with critical gaps, unverified credentials, bias alerts or infeasible commutes | `apps/web` counselor queue |
| Operator | Runs the deployment and the product's supply: organizations, employers, curated vacancies, catalog freshness, outbox retries, incidents and minimal metrics (ADR-0017) | `apps/web` operator panel |
| Training center | Publishes courses with provider, modality, hours, cost, seats and validity, and retires expired ones | `apps/web` training-center portal |

## Scope of v1

Recorded in ADR-0013. In scope:

1. Conversational intake plus CV upload (text, PDF, image) producing a profile with
   evidence states.
2. Deterministic, explainable aptitude decisions for a vacancy: apt, apt with gaps, or
   not currently apt, with gaps, commute and hard constraints shown.
3. A constrained training roadmap built from the gaps.
4. An adapted application (CV, cover letter, selected evidence) that never invents
   facts, reviewed and corrected by the candidate.
5. Human gates for the candidate, the counselor and the employer.
6. A full application lifecycle inside WorkBridge for employer-published vacancies:
   draft, approvals, submission, interview decision.
7. Vacancy supply from two sources: employers publishing directly, and a curated catalog
   uploaded by the operator with source and freshness.
8. National coverage of Panama and a broader occupation taxonomy than the original
   three families.
9. Email notifications driven by the SQL outbox.
10. An operator panel, a training-center portal and a simulated-interview screen
    (ADR-0017). Analytics as a product surface is deferred to v1.1.

Out of scope for v1:

- A general job marketplace: payments, contracts, payroll or background checks.
- Live audio or voice interviews; the simulated interview stays text-based.
- Agents that send applications, progress interviews or send messages. These tools are
  denied to every agent, permanently.
- Treating a curated vacancy as internally owned: for those, WorkBridge produces the
  draft and hands over the original external link.
- External notification channels other than email (no SMS, no WhatsApp in v1).

## Domain vocabulary

| Term | Meaning |
|---|---|
| Apt | Meets mandatory job requirements and practical constraints. |
| Apt with gaps | Can progress, but has actionable skill, credential, experience or preparation gaps. |
| Not currently apt | Fails a hard constraint such as an unverified mandatory credential, an incompatible schedule or an infeasible commute. |
| Evidence | A declared, extracted, verified or inferred fact supporting a profile or a requirement. |
| Evidence status | `declared`, `extracted`, `verified` or `rejected`; an unverified claim is never presented as verified. |
| Informal experience | Experience from family businesses, volunteering, projects, academic work or unregistered work. |
| Gap | A missing or weak requirement that a roadmap action can close. |
| Roadmap | Ranked actions such as courses, certifications, projects or internships that address a gap. |
| Adapted application | A CV, cover letter and application answers tailored to one vacancy without inventing facts. |
| Employer-published vacancy | A vacancy created by an employer through WorkBridge. It has a resolvable owning organization and supports the full internal lifecycle. |
| Curated vacancy | A vacancy ingested from an external portal or curated by the operator. It has no employer organization inside WorkBridge; it supports exploration, aptitude and a draft, and its application continues through the original external link. |
| Submission | The recorded act of sending an approved application to an employer-published vacancy, with an idempotency key. |
| Human gate | A required human decision (candidate, counselor or employer) that no agent can perform. |
| Workflow graph | Explicit states, agent transitions, tools, fallbacks and human approval points. |
| Production blocker | A condition that prevents a real deployment; tracked in ADR-0014. |
| Ground truth | A known expected verification result used to measure classifier errors. |

Product documentation is written in Spanish; governance documents (this file, ADRs,
`AGENTS.md`) are written in English. Code identifiers and commit messages follow the
repository convention in `AGENTS.md`.

## Invariants

Breaking any of these is a defect, not a trade-off:

- **The model does not decide hard constraints.** Aptitude, hard constraints, scoring,
  assignment (HiGHS MILP with a greedy fallback), training roadmaps and credential
  verification are deterministic code. The LLM only converses, extracts and drafts, and
  every LLM use has a no-LLM fallback.
- **Agents never send.** `submit_application`, `progress_interview` and `send_message`
  are always denied to agents. Human gates decide every sensitive step.
- **Evidence has a status.** Invented credentials are rejected; unverified claims are
  never presented as verified.
- **Ownership is a server fact.** An employer sees a submission only when the runtime
  resolves the vacancy's owning organization. A value claimed in a request body is
  never authoritative.
- **Fairness is enforced, not advisory.** Discriminatory vacancy requirements block
  ranking and route to a human; the counterfactual bias auditor is the source of bias
  alerts. A fairness claim is only valid where the auditor actually runs.
- **PII is redacted before any model call.** Never commit real candidate data, secrets
  or `.env` files; committed fixtures stay synthetic.

## Stack (target for v1)

Status per layer is in `docs/stack.md`: "keep" means already in the code, "adopt" means
decided with migration pending. This table is the target, not a claim about the current
tree.

| Concern | Value |
|---|---|
| Language / runtime | TypeScript strict, Node.js >= 22, ESM (`"type": "module"`) |
| Package manager / scripts | Bun 1.2+ (workspaces); production still runs on Node |
| Web surface | Next.js 16 app router with React 19, `apps/web` |
| Web data | Server Components + Server Actions; TanStack Query only for live data |
| Runtime API | Hono on Web Standard, `apps/agent-runtime` (Mastra agent graph plus deterministic services) |
| Database | Neon Postgres; Drizzle ORM with a baseline from `migrations/001..004` |
| Auth | Better Auth with role and organization binding |
| Styling | Tailwind CSS v4 + shadcn/ui (ADR-0007) |
| Deterministic core | `packages/solver` (HiGHS MILP), `packages/training`, `packages/domain` |
| Contracts | JSON Schema 2020-12 with Ajv; Zod for HTTP, forms and environment |
| LLM | OpenRouter with paid models, a model chain and per-capability budget |
| Integrations | Resend (email), Accredible/Credly (credentials, Certo adapter), Google Maps, Sentry + OpenTelemetry + Langfuse |
| Tests | Vitest (node and jsdom projects), Playwright for e2e |
| Delivery | Containers for web, runtime and worker on one PaaS; Neon (ADR-0019) |
| Issue tracker | GitHub Issues in `quantumquirkxyz/WorkBridge` (ADR-0012) |

Stack decisions: ADR-0016 (Bun, Hono, Drizzle, validation), ADR-0018 (providers),
ADR-0019 (deployment). Migration phases and exit criteria: `docs/stack.md`.

## Documentation surface

| Document | Answers |
|---|---|
| `README.md` | What WorkBridge is, what it does, how to run it, current state |
| `docs/producto.md` | Users, capabilities, flows, acceptance criteria, success metrics |
| `docs/stack.md` | Stack target, integrations, migration plan, rejected options |
| `docs/arquitectura.md` | Agents, tools, flows and human intervention points |
| `docs/despliegue.md` | Environments, migrations, variables, health checks, security posture |
| `docs/runbook-piloto.md` | Operating the pilot: preparation, accounts, known risks |
| `.agents/adr/` | Durable decisions |
| `docs/reference/agents/` | Tracker, labels and domain-doc rules for agents |

## Maintenance rule

- Keep this file limited to WorkBridge's own domain and boundaries.
- New terminology enters only through `grill-with-docs` or `domain-modeling`, and a
  hard-to-reverse decision is recorded as an ADR.
- When a decision here is superseded, update this file and record the supersession in
  the ADR index in the same change. Do not leave placeholders or "to confirm" rows.
- Do not reintroduce hackathon framing; the submission is history.
