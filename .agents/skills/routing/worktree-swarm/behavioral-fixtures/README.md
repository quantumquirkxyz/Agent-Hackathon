# Worktree Swarm Behavioral Fixtures

These fixtures document the minimum observable behavior expected from `worktree-swarm`.

## Required scenarios

- Missing `--base` or issue URLs returns one structured `ok: false` response and creates nothing.
- An external, closed, duplicate, malformed, or conflicting issue rejects the complete batch and reports its reason.
- Valid issues create one isolated worktree and branch per issue, then launch all local agents without waiting sequentially.
- Creation failure rolls back only branches and worktrees created by the current invocation.
- Successful output and `manifest.json` contain the issue URL, number, title, branch, absolute path, base ref, prompt, and agent identifier.
- The primary checkout is never switched or modified by the delegated workflow.

These are contract fixtures for review and regression validation; they do not invoke GitHub, create worktrees, or launch agents during the bundle gate.
