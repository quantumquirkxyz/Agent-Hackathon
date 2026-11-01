---
name: worktree-swarm
category: routing
maturity: stable
version: 1
description: Create isolated local git worktrees and launch one local coding agent per open GitHub issue in the current repository.
license: MIT
capabilities:
  - validate GitHub issue URLs and repository scope
  - create isolated issue worktrees atomically
  - launch local agents in parallel
  - emit a machine-readable worktree manifest
outputs:
  - type: object
    name: IssueCopyManifest
    properties:
      ok: { type: boolean }
      manifestPath: { type: string }
      created: { type: array }
      skipped: { type: array }
      error: { type: string }
    required: [ok, created, skipped]
sideEffects:
  - create-git-worktrees
  - create-git-branches
  - launch-local-agents
dependencies: []
stopCondition: All valid issues have isolated worktrees and local agents, a manifest is written, or validation/creation fails with safe rollback.
risk: medium
trustTier: 3
maxIterations: 1
promptVersion: "1.0"
artifactType: orchestration
evaluators: [behavioral, regression, traceability]
fixturesPath: .agents/skills/routing/worktree-swarm/behavioral-fixtures
tags: [routing, git, github, worktree, multi-agent]
compatibility: [parallel-issue-fleet, implement, review-pr, plan-review-fixes, implement-review-fixes, publish-open-pr, ship-subissue]
approvalRequired: true
approvalFor: [create-git-worktrees, create-git-branches, launch-local-agents]
reloadPolicy: on-trigger
---

## Contract

- **Use only when explicitly requested.** Do not infer this skill from a normal issue, implementation, or multi-agent request.
- **Input:** one or more HTTPS GitHub issue URLs and one mandatory base branch supplied by the user. There is no default base branch.
- **Output:** JSON on stdout and `manifest.json` under `<repo-parent>/<repo-name>-worktrees/`.
- **Dependencies:** the current directory must be a GitHub checkout with `git`, authenticated `gh`, and the local `opencode` CLI available.
- **Side effects:** creates issue branches and worktrees and launches detached local agents. It never pushes, opens or merges pull requests, closes issues, or changes the primary checkout's branch.
- **Risk:** medium. The validation phase must finish before any resource is created; a creation failure rolls back only resources created in this invocation.
- **Boundary:** this skill prepares and delegates work. It does not implement issues itself and does not perform publication or merge operations.
- **Evolution boundary:** use `parallel-issue-fleet` instead when the input is a `TicketArtifact` DAG or the run needs VM slots, bootstrap policies, concurrency limits, checkpoints, timeouts, secret injection, convergence, or owned-resource cleanup. This skill remains the one-shot local backend and compatibility route.

## Invocation

Run the script from the primary checkout:

```bash
node .agents/skills/routing/worktree-swarm/scripts/prepare-worktrees.mjs \
  --base main \
  https://github.com/owner/repo/issues/123 \
  https://github.com/owner/repo/issues/124
```

If the base branch or any issue URL is missing, ask for the missing information once and stop. The script itself is non-interactive and returns `ok: false` rather than guessing a base branch.

The script validates the checkout, `origin`, URL ownership, issue state and metadata, base ref, duplicate issues, existing branches, and existing worktree paths before creating anything. A closed, external, malformed, pull-request, duplicate, or conflicting issue rejects the complete batch and reports every rejected item.

## Agent workflow

For each created worktree, the script launches one detached local `opencode run` process with the worktree as its working directory. Agents receive only their own worktree and the issue context. They must not switch branches, touch another worktree, push, or modify the primary checkout; they commit their work on the prepared issue branch.

Each delegated issue follows the complete project workflow loop when the corresponding skills are available:

`/implement` → `/review-pr` → (`/plan-review-fixes` → `/implement-review-fixes` → `/review-pr`)* → `/publish-open-pr` → `/ship-subissue`

The loop must stop rather than bypass an unmet gate. In particular, this skill's no-push/no-PR/no-merge/no-close guardrails remain active: publication and shipping are handoffs requiring the user's separate authorization and the repository's review/CI evidence. The child agent must not execute those prohibited side effects while operating under this skill.

## Output

Successful output has this shape:

```json
{
  "ok": true,
  "manifestPath": "/parent/repo-worktrees/manifest.json",
  "created": [{
    "number": 123,
    "url": "https://github.com/owner/repo/issues/123",
    "title": "Example issue",
    "body": "...",
    "branch": "issue/123-example-issue",
    "path": "/parent/repo-worktrees/issue-123",
    "base": "origin/main",
    "agentId": 12345,
    "prompt": "..."
  }],
  "skipped": []
}
```

On validation or creation failure, return `ok: false`, an `error`, all rejected entries in `skipped`, and an empty `created` array. Repeating an execution is safe: existing branches and worktree paths are conflicts, so no duplicate agent or worktree is created.

## Completion criteria

- all supplied URLs and the explicit base branch were validated before mutation
- every accepted issue has one branch, one worktree, and one local agent
- all agents were launched without waiting for one to finish before starting another
- the manifest contains URL, number, title, branch, absolute path, agent identifier, and base ref
- creation failures remove only resources created during this invocation
- stdout is valid JSON and no prohibited remote/tracker operation occurred

## How This Skill Was Created

Created from the user's structured contract through the `skill-creator` workflow. The requested two-file runtime shape is preserved: this entrypoint and `scripts/prepare-worktrees.mjs`; repository projections and the lockfile are generated by bundle tooling.

---
@include .agents/skills/platform/contract-base.xml
