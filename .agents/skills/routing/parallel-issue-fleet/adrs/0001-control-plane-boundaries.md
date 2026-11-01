# ADR 0001: Separate the fleet control plane from local worktree preparation

## Status

Accepted

## Context

`worktree-swarm` creates local worktrees and detached agents. A durable issue fleet additionally needs DAG scheduling, VM lifecycle, secret boundaries, timeouts, convergence, replay, and cleanup.

## Decision

Create `parallel-issue-fleet` as a separate orchestration skill. Keep `worktree-swarm` as a local compatibility utility. Use provider adapters and require `land-by-wave` by default; allow an explicit integration branch when consumers accept that review model.

## Consequences

- Existing local users retain the small worktree utility.
- Remote infrastructure authority is isolated behind a high-risk, approval-gated contract.
- Dependent waves cannot run on stale code.
- The fleet adds a durable state artifact and provider configuration surface.
