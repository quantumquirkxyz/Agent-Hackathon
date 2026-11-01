# Environment adapters

The fleet control plane is a Node script plus Git. It does not depend on a hosting vendor. A provider adapter selects the environment and implements seven argv-only lifecycle commands; a worker profile selects the agent. This document sketches the common environments. The GitHub Actions adapter is the fully implemented reference.

## Local worktree

The built-in `local-worktree` provider is the simplest environment. It creates one git worktree and branch per issue, runs the worker in the foreground, and removes the worktree after validation while preserving the branch.

```json
{
  "type": "local-worktree",
  "worker": { "profile": ".agents/fleet/worker.json" }
}
```

Use this on a workstation with enough memory for N agents. Lower `--concurrency` when each agent loads a large model or index.

## Docker

A Docker adapter can run each issue in a disposable container. The image only needs Git, Node, and the agent CLI, or the profile's `setup` can install the CLI. Mount or clone the workspace, pass `FLEET_SECRETS_JSON`, and return the branch and artifact from `collect`.

```json
{
  "type": "vm-pool",
  "name": "docker",
  "pool": "local-docker",
  "worker": { "profile": ".github/fleet/worker.json" },
  "commands": {
    "provision": ["docker", "run", "-d", "--name", "fleet-{{run.id}}-{{issue.id}}", "-v", "{{state.dir}}/workspaces/{{issue.id}}:/work", "fleet-worker:latest", "sleep", "infinity"],
    "status": ["docker", "inspect", "--format", "{{.State.Running}}", "{{resource.id}}"],
    "bootstrap": ["docker", "exec", "-w", "/work", "{{resource.id}}", "git", "status"],
    "execute": ["docker", "exec", "-w", "/work", "-e", "FLEET_ISSUE_BODY", "{{resource.id}}", "node", "/work/.github/fleet/worker-runner.mjs", "--profile", "/work/.github/fleet/worker.json", "--workspace", "/work", "--prompt-file", "/work/.fleet/prompt.txt", "--artifact", "{{artifact.path}}"],
    "validate": ["docker", "exec", "-w", "/work", "{{resource.id}}", "npm", "test"],
    "collect": ["node", "docker-collect.mjs", "--container", "{{resource.id}}", "--issue", "{{issue.id}}", "--dest", "{{state.dir}}/collected/{{issue.id}}"],
    "cleanup": ["docker", "rm", "-f", "{{resource.id}}"]
  }
}
```

The sketch is deliberately explicit: the container name is derived from the run and issue, and `provision` returns it as `resourceId`; cleanup must refuse a token mismatch. `docker-collect.mjs` is a small adapter that copies the artifact out of the container, reads the branch, and emits the required JSON. Do not pass issue text through a shell string. Prefer `docker exec` with argv and environment variables, as above, and mount the prompt file rather than interpolating it.

## SSH or a cloud VM

An SSH adapter provisions a VM (cloud CLI, Terraform, or an existing pool), clones the repository at the immutable base, stages `worker-runner.mjs` and the profile, and runs the worker over SSH.

- `provision` creates or leases the VM and returns `resourceId`, `workspacePath`, and a branch.
- `bootstrap` installs project dependencies.
- `execute` copies the profile and prompt, then runs `worker-runner.mjs` over SSH.
- `collect` fetches the branch and copies the artifact back with `scp`.
- `cleanup` terminates only the VM whose ownership tag matches the token.

Use `ssh -o BatchMode=yes` and a dedicated key. Keep the key out of argv; pass it through the profile's `env` or the SSH agent.

## GitHub Actions

The repository ships a complete adapter:

- `assets/github-actions/fleet-worker.yml` — workflow template.
- `assets/github-actions/worker-runner.mjs` — portable runner copied into `.github/fleet/`.
- `assets/github-actions/provider.example.json` — provider configuration.
- `references/github-actions.md` — setup and troubleshooting.

The workflow is agent-neutral: it runs the committed profile, not a hardcoded CLI. One `FLEET_SECRETS_JSON` secret serves any agent or model.

## Any CI or scheduler

Any environment that can run an argv command, clone a repository, and return an artifact can implement the seven commands. Examples include GitLab CI, Buildkite, CircleCI, Nomad, Kubernetes Jobs, or an internal job service. The provider contract is the only interface:

1. `provision` — create an isolated workspace and return its identity.
2. `bootstrap` — install dependencies.
3. `status` — reconcile an interrupted lifecycle.
4. `execute` — run the worker profile and block.
5. `validate` — run repository quality gates.
6. `collect` — return `branch`, `commitSha`, and an `implementArtifactPath`.
7. `cleanup` — release only the owned resource.

The fleet controller does not import a cloud SDK and does not know the provider's API. If the adapter can emit JSON and honor ownership, it fits.
