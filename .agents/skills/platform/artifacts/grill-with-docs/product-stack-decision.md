# Grill with docs — product definition and stack decision

**Identifier:** `product-stack-decision` · **Date:** 2026-10-30 · **Status:** refined

## What was grilled

Who operates and funds WorkBridge, which modules exist in v1, where supply comes from,
which integrations are mandatory, and the full technology stack: Bun, framework, data
access, validation, web data, observability and deployment.

## Decisions

| Area | Decision | ADR |
|---|---|---|
| Operating model | Anchor organization B2B2C; one anchor, many employers; counselors funded by it | ADR-0020 |
| v1 modules | Operator panel, training-center portal, interview UI; analytics in v1.1 | ADR-0017 |
| Supply | Employer publishing + operator-uploaded curated vacancies; no scraping | ADR-0013/0018 |
| Credentials | Accredible → Credly; Certo adapter; mock dev-only | ADR-0018 |
| Email | Resend behind an adapter; SMTP fallback; outbox is truth | ADR-0018 |
| Observability | Sentry + OpenTelemetry + Langfuse | ADR-0018 |
| Package manager | Bun workspaces and scripts; Node 22 production; Vitest tests | ADR-0016 |
| API framework | Hono replaces the hand-written `node:http` router | ADR-0016 |
| Data access | Drizzle ORM, baseline from `migrations/001..004` | ADR-0016 |
| Validation | Ajv + JSON Schema for domain; Zod for edges | ADR-0016 |
| Web data | RSC + Server Actions; TanStack Query only for live data | ADR-0016 |
| Deployment | Containers for web, runtime and worker on one PaaS; Vercel retired | ADR-0019 |

Kept: Next.js 16, React 19, Mastra, Better Auth, Tailwind v4 + shadcn/ui, Google Maps,
OpenRouter (paid), Vitest, Playwright, Spanish-only product, single-anchor tenancy.

## Documentation

**Created:** `docs/producto.md` (purpose, users, capabilities with acceptance criteria,
flows, metrics), `docs/stack.md` (target stack, integrations, migration phases, rejected
options), ADR-0016 to ADR-0020.

**Updated:** `CONTEXT.md`, `README.md`, `docs/README.md`, `docs/despliegue.md`,
`docs/arquitectura.md`, `AGENTS.md`, ADR index.

## Migration phases

0. Bun → 1. Hono → 2. Drizzle → 3. Web data → 4. PaaS → 5. Integrations.
Each phase has an exit criterion in `docs/stack.md` and does not block the production
blockers of ADR-0014.

## Unresolved

1. Object storage for CV files (recommended R2/S3 with signed URLs).
2. PaaS vendor (Fly.io, Railway or Render).
3. Email domain and bounce handling.
4. Taxonomy expansion and fairness validation by family, without owner.
5. Analytics v1.1 model and owner.
6. Privacy/retention under Panamanian law.
7. `apps/agent-runtime/package.json` declares `@mastra/pg` twice.

## Validation

- Relative Markdown links: 0 broken.
- Tests and lint: **not run** — `node_modules` absent.

## Next consumer

`to-spec` to publish the six migration phases and the three new modules as tickets, or
`implement` to start phase 0 (Bun).
