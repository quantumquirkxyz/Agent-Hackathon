---
description: Create isolated local git worktrees and launch one local coding agent per open GitHub issue in the current repository.
---
# worktree-swarm

When to use: Create isolated local git worktrees and launch one local coding agent per open GitHub issue in the current repository.

## Workflow

1. Read the canonical skill at .agents/skills/routing/worktree-swarm/SKILL.md and execute its Process.

## Deliverables

- orchestration artifact

## Guardrails

- risk: medium; trust tier: 3; approval required: yes
- side effects: create-git-worktrees, create-git-branches, launch-local-agents
- isolation: none; model tier: reasoning

Stop when: All valid issues have isolated worktrees and local agents, a manifest is written, or validation/creation fails with safe rollback.
