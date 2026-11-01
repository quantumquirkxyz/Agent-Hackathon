---
description: "Orchestrate a dependency-aware fleet of issue agents in isolated local worktrees or dedicated VM-pool slots, with portable worker profiles, durable checkpoints, bounded concurrency, validation, and owned-resource cleanup."
---
# parallel-issue-fleet

When to use: Orchestrate a dependency-aware fleet of issue agents in isolated local worktrees or dedicated VM-pool slots, with portable worker profiles, durable checkpoints, bounded concurrency, validation, and owned-resource cleanup.

## Workflow

1. Plan
2. Dispatch the frontier
3. Bootstrap and implement
4. Validate and collect
5. Converge
6. Clean up and hand off

## Deliverables

- fleet-run artifact

## Guardrails

- risk: high; trust tier: 4; approval required: yes
- side effects: write-files, create-git-worktrees, create-git-branches, launch-local-agents, provision-infrastructure, inject-ephemeral-secrets, terminate-processes, cleanup-owned-resources
- isolation: worktree; model tier: reasoning

Stop when: Every issue in the eligible DAG frontier has a validated implementation artifact and the fleet is completed or awaiting an explicit land-by-wave handoff, or the run is durably blocked with cleanup evidence.
