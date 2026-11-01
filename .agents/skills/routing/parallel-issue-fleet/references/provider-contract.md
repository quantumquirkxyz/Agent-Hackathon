# Provider contract

`parallel-issue-fleet` has two provider types. Provider configuration is local trusted configuration; issue text and provider stdout remain untrusted data. A provider chooses **where** work runs; a worker profile chooses **which agent** runs it. Neither layer knows the other.

## Worker profile

Every execution path resolves a worker profile. The fleet hands the profile to `worker-runner.mjs`, which runs `setup` and the agent command as argv arrays, builds a minimal environment, and supports `argv`, `stdin`, or `file` prompt delivery.

```json
{
  "name": "claude-code",
  "profile": ".agents/fleet/worker.json",
  "model": "claude-sonnet-4-5"
}
```

- `profile` is a path relative to `provider.repo` (or an inline profile object).
- `model` overrides the profile's default. It is exposed as `{{model}}`, `FLEET_MODEL`, and the profile's `modelEnv`.
- The resolved profile name and model are persisted in `FleetRunArtifact.provider.worker`; commands and credentials are not.

The runner is environment-neutral and dependency-free. The same profile works in a local worktree, a container, an SSH VM, or a hosted runner. See [worker profiles](../assets/workers/README.md) for the full schema, placeholders, and examples for OpenCode, Claude Code, Codex, Gemini CLI, Aider, and custom CLIs.

## Local worktree

```json
{
  "type": "local-worktree",
  "repo": "/absolute/path/to/target/repository",
  "workspaceRoot": "/absolute/optional/path",
  "bootstrapCommands": [["bun", "install", "--frozen-lockfile"]],
  "artifactPath": ".agents/skills/platform/artifacts/implement/{{issue.id}}.json",
  "worker": {
    "profile": ".agents/fleet/worker.json",
    "model": "provider/model"
  },
  "qualityCommands": [["node", ".agents/skills/platform/check-all.mjs"]]
}
```

`repo` defaults to the repository that contains the installed skill bundle. Every worktree, branch, merge, and cleanup operation runs against that repository. `workspaceRoot` defaults to a sibling directory named `<repo>-fleet-worktrees/<run-id>`.

The controller writes the rendered prompt to a per-issue file and invokes `worker-runner.mjs` with `--profile`, `--workspace`, `--prompt-file`, `--artifact`, and `--model`. The runner receives only the environment allowlist declared by the profile plus the `FLEET_*` contract. A missing profile fails closed; there is no vendor-specific default.

`executeCommand` remains available for a fully custom local command. It is a legacy escape hatch: the array is executed verbatim, with optional `{{prompt}}`, `{{model}}`, and `{{artifact}}` substitution. Provider commands must remain argv arrays; shell strings are rejected.

When commands are omitted, bootstrap and quality gates are detected from repository files. The worker receives `FLEET_IMPLEMENT_ARTIFACT` and must write its `ImplementArtifact` at that workspace-relative path.

## VM pool

```json
{
  "type": "vm-pool",
  "name": "dedicated-build-pool",
  "pool": "agents",
  "artifactPath": ".fleet/artifacts/{{issue.id}}.json",
  "worker": {
    "profile": ".fleet/worker.json",
    "model": "provider/model"
  },
  "commands": {
    "provision": ["fleet-provider", "provision", "--run", "{{run.id}}", "--issue", "{{issue.id}}"],
    "status": ["fleet-provider", "status", "--ownership", "{{resource.ownershipToken}}"],
    "bootstrap": ["fleet-provider", "bootstrap", "--resource", "{{resource.id}}"],
    "execute": ["fleet-provider", "execute", "--resource", "{{resource.id}}", "--branch", "{{branch}}", "--worker-profile", "{{worker.profile}}", "--model", "{{worker.model}}"],
    "validate": ["fleet-provider", "validate", "--resource", "{{resource.id}}"],
    "collect": ["fleet-provider", "collect", "--resource", "{{resource.id}}"],
    "cleanup": ["fleet-provider", "cleanup", "--resource", "{{resource.id}}", "--ownership", "{{resource.ownershipToken}}"]
  }
}
```

The provider's `execute` command runs the worker profile inside the VM. It can use `worker-runner.mjs` directly or stage the profile into its own environment. The provider remains responsible for installing the agent, staging the prompt, and returning a locally readable artifact from `collect`.

Commands are argv arrays and never shell strings. Available substitutions are:

- `{{run.id}}`
- `{{issue.id}}`, `{{issue.title}}`, `{{issue.url}}`
- `{{branch}}`
- `{{base.revision}}`
- `{{workspace.path}}`
- `{{resource.id}}`, `{{resource.ownershipToken}}`
- `{{worker.profile}}`, `{{worker.model}}`
- `{{artifact.path}}`
- `{{state.dir}}`

Fleet-created branches must start with `fleet/` and must pass git ref validation. The adapter and worker both reject unprotected-branch names such as `main` and malformed refs, so a provider bug cannot push directly to the base branch.

`{{issue.id}}`, `{{issue.title}}`, and `{{issue.body}}` are untrusted tracker data. Never interpolate them into a filesystem path, shell string, or URL. Use `{{state.dir}}` as the only writable root and let the provider derive a safe leaf name; `{{issue.body}}` is rejected in argv entirely.

Unknown `{{...}}` sequences are left untouched so provider-specific template syntax (for example Docker's `{{.State.Running}}`) still works. Use the documented names exactly; `{{issue.body}}` is rejected because untrusted issue text must travel through `FLEET_ISSUE_BODY`.

Every provider command also receives these environment variables: `FLEET_RUN_ID`, `FLEET_ISSUE_ID`, `FLEET_ISSUE_TITLE`, `FLEET_ISSUE_URL`, `FLEET_ISSUE_BODY`, `FLEET_BASE_REVISION`, `FLEET_IMPLEMENT_ARTIFACT`, `FLEET_MODEL`, `FLEET_WORKER_PROFILE`, and `FLEET_PROMPT_FILE`. Use the environment for untrusted issue text instead of argv, so newlines and leading dashes cannot change command parsing. `FLEET_WORKER_PROFILE` and `FLEET_PROMPT_FILE` are controller-local paths; a remote provider must stage them into its VM before executing the worker.

`provision` must emit one JSON object on its final stdout line containing `resourceId`; it may include `workspacePath`, `branch`, and `ownershipToken`. `status` must emit `state` (`absent`, `ready`, `running`, `completed`, or `failed`) and the known resource identity. `collect` must emit `branch`, `commitSha`, and `implementArtifactPath` pointing at a locally readable copy of the worker's artifact. Other output is bounded and treated as diagnostic data.

The fleet does not trust worker gate claims: it sets `gateIde` and `gateCi` to `skipped` and derives `gatePreCommit` from the commands it ran. A worker artifact with `acceptanceCriteriaMet != true` blocks the issue.

## GitHub Actions

The recommended free implementation of the `vm-pool` contract is a GitHub-hosted runner. See [github-actions.md](github-actions.md) for the complete setup, lifecycle mapping, and limits.

## Secrets

Pass secret **names** using repeated `--secret-env NAME`. Values are inherited from the controller process and injected only into provider/worker child processes. Missing values fail closed. Values are never serialized.

Worker profiles add a second, portable path: list names in `env`/`requiredEnv` and supply values through the parent environment or `FLEET_SECRETS_JSON`. The runner injects only listed names and excludes `GITHUB_TOKEN`, runtime tokens, and unrelated parent variables. Locally, `policy.secretEnvNames` remains the fail-closed list for controller-injected values; profile `requiredEnv` is enforced by the runner.

## Ownership and cleanup

The controller cleans only resources present in the active `FleetRunArtifact` and carrying an ownership token. Providers must reject cleanup when the token does not match the resource's creation metadata.
