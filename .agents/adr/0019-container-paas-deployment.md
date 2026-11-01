# ADR-0019: Deploy web, runtime and worker as containers on one PaaS

## Status

Accepted — 2026-10-30. Replaces the Vercel function as the deployment model.

## Context

The repository has three deployable processes: the Next.js web, the application runtime
and the chat worker. The worker holds leases and processes a queue, so it needs a
long-running process; Vercel's serverless functions do not provide that. `vercel.json`
currently routes only the runtime, leaving web and worker without a coherent deployment
story.

A small team needs one model, one network and one place to read logs.

## Decision

- Deploy **web, runtime and worker as containers on a single PaaS** (Fly.io, Railway or
  Render; the specific vendor is an operational choice, not an architectural one).
- **Neon** remains the managed Postgres, with a branch per environment.
- Services share a private network; only the web is public, and the runtime is reachable
  from the web through the private network.
- The `vercel.json` function is retired once the container deployment is reproducible.
- Secrets are injected by the platform, never baked into images.

## Consequences

- The worker runs continuously and the chat queue behaves as designed.
- One deployment pipeline builds and releases all three services together.
- Losing Vercel means giving up its Next.js-specific optimizations; Next.js runs in
  standalone mode inside the container.
- Health checks become the deployment gate: `GET /health` for the runtime and the web's
  database health endpoint.
- Rollback is a container release rollback plus a Neon branch restore, not a serverless
  alias swap.

## Alternatives

- **Vercel for web and runtime, worker elsewhere.** Rejected: two providers, two
  configurations and a network boundary to secure.
- **VPS with Docker Compose and Caddy.** Rejected for v1: patching, backups and
  availability become the team's job.
- **Kubernetes.** Rejected: operational load far beyond three services.
- **Keep the Vercel function for the runtime.** Rejected: it cannot host the worker and
  splits the deployment model.

## Links

- `docs/stack.md`, `docs/despliegue.md`
- ADR-0014 (blockers), ADR-0016 (stack)
