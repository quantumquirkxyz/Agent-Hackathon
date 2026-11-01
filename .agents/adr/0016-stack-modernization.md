# ADR-0016: Modernize the stack with Bun, Hono, Drizzle and a typed validation split

## Status

Accepted — 2026-10-30. Migration pending; phases and exit criteria in `docs/stack.md`.

## Context

The current stack works but carries debt that slows every new module: npm workspaces,
a hand-written `node:http` server, raw `pg` queries with no schema types, and no typed
validation for HTTP bodies, forms or environment variables. The next work (operator panel,
training-center portal, interview UI, production blockers) multiplies the number of routes
and tables, so the cost of each gap compounds.

The team wants TypeScript and Bun, but Bun can mean package manager, runtime, test runner
or all three, with very different risk.

## Decision

- **Bun 1.2+ as package manager, workspace resolver and script runner.** Production stays
  on Node.js 22; tests stay on Vitest. `bun.lock` replaces `package-lock.json`.
- **Hono** replaces the custom `node:http` router for the application runtime. Domain
  services remain framework-free.
- **Drizzle ORM with drizzle-kit** becomes the schema source, with a baseline generated
  from `migrations/001..004`. Migration is per module; no dual schema.
- **Validation split:** Ajv + JSON Schema 2020-12 for published domain contracts; Zod for
  HTTP input, forms and environment.
- **Web data:** React Server Components and Server Actions for reads and mutations;
  TanStack Query only for live data (chat queue, application state).
- Next.js 16, React 19, Mastra, Better Auth, Tailwind v4 + shadcn/ui, Vitest and Playwright
  stay.

## Consequences

- The migration runs in phases, each ending green and revertible: Bun, Hono, Drizzle, web
  data, then integrations and hosting.
- The Dockerfile installs with Bun and runs with Node; CI uses `oven-sh/setup-bun`.
- Hono's RPC client can replace part of the hand-written BFF calls, but the BFF stays as
  the session-signing boundary.
- Drizzle narrows the gap between schema and code, at the cost of a one-time baseline and
  rewriting queries module by module.
- Zod at the edges does not replace JSON Schema; domain contracts remain the public truth.

## Alternatives

- **Bun as production runtime.** Rejected: Next.js and Mastra are not guaranteed on Bun,
  and there is no cheap rollback once everything runs there.
- **`bun test` instead of Vitest.** Rejected: loses v8 coverage, jsdom projects and the
  current Playwright integration.
- **Keep `node:http`.** Rejected: every new route re-implements routing, errors and
  middleware by hand.
- **Prisma.** Rejected: its engine and migration model conflict with the existing SQL and
  with fine-grained control.
- **Zod only, generating JSON Schema.** Rejected: published domain contracts would depend
  on a generator and consumers would need revalidation.

## Links

- `docs/stack.md`
- ADR-0007 (styling), ADR-0014 (production blockers), ADR-0019 (hosting)
