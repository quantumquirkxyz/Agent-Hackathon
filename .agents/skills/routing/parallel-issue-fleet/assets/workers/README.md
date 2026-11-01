# Worker profiles

A worker profile is the only place that names a coding agent, a model, or a credential. The fleet controller and every provider execute the profile through `worker-runner.mjs`; neither of them knows which agent is inside.

Profiles are ordinary JSON and can live anywhere the target repository can read. The standard locations are:

1. `.github/fleet/worker.json` — GitHub Actions default.
2. `.agents/fleet/worker.json` — agent-neutral repository default.
3. `.fleet/worker.json` — minimal fallback.

The runner accepts `--profile <path>` or `FLEET_WORKER_PROFILE`, so a provider can also pass an absolute path.

## Shape

```json
{
  "schemaVersion": "1.0",
  "name": "my-agent",
  "description": "optional human note",
  "setup": [["npm", "install", "-g", "my-agent-cli"]],
  "command": ["my-agent", "run"],
  "modelArgs": ["--model", "{{model}}"],
  "promptDelivery": "argv",
  "model": "provider/model",
  "modelEnv": "MY_AGENT_MODEL",
  "env": ["MY_AGENT_API_KEY"],
  "requiredEnv": [],
  "timeoutMs": 1800000
}
```

- `command` is a non-empty argv array. It is never passed to a shell.
- `setup` is an array of argv arrays. It runs once before the agent, in the workspace. Put installation scripts in argv form (`["bash", ".github/fleet/setup.sh"]`) if a pipeline is needed; the script is committed and reviewed.
- `modelArgs` is appended only when a model is configured. Put flags that accept a model here rather than hardcoding a model. Use a complete `{{modelArgs}}` argv element in `command` to place those flags at a specific position; otherwise they are inserted before an inline `{{prompt}}` or appended.
- `promptDelivery` is `argv` (default), `stdin`, or `file`.
  - `argv`: use `{{prompt}}` in `command`, or omit it and the runner appends the prompt as the last argument.
  - `stdin`: the runner writes the prompt to the child's stdin.
  - `file`: `command` must contain `{{promptFile}}`.
- `model`, `modelEnv`: optional default model and the environment variable the agent reads it from. `FLEET_MODEL` is always set when a model is known.
- `env`: names the profile may read. Values come from the parent environment or from `FLEET_SECRETS_JSON`.
- `requiredEnv`: names that must be non-empty; the runner fails closed when one is missing.
- `timeoutMs`: optional per-process timeout.

## Placeholders

| Placeholder | Value |
|---|---|
| `{{prompt}}` | Full rendered prompt |
| `{{promptFile}}` | Path to a file containing the prompt |
| `{{model}}` | Effective model name |
| `{{artifact}}` | Workspace-relative ImplementArtifact path |
| `{{workspace}}` | Absolute workspace path |
| `{{run.id}}` | Fleet run identity |
| `{{issue.id}}` | Issue identity |
| `{{issue.title}}` | Issue title |
| `{{issue.url}}` | Issue URL |
| `{{base.revision}}` | Immutable base revision |

Unknown placeholders fail closed. `{{prompt}}` and `{{promptFile}}` are mutually exclusive by delivery mode.

## Secrets

The runner inherits only a small base environment plus the names listed in `env` and `requiredEnv`. It never passes `GITHUB_TOKEN`, `ACTIONS_RUNTIME_TOKEN`, or unrelated parent variables. `FLEET_SECRETS_JSON`, `GITHUB_TOKEN`, `ACTIONS_RUNTIME_TOKEN`, and the Actions OIDC request variables are reserved: listing them in `env` or `requiredEnv` is rejected rather than handing the whole secret blob or repository token to the agent.

Under GitHub Actions the runner registers each injected value with `::add-mask::`, so an agent that prints the environment does not also print the credential. Redaction is still a log safeguard, not a substitute for least privilege.

Two credential paths work everywhere:

- Set the named variable directly (`MY_AGENT_API_KEY=...` locally, or an `env:` entry in a workflow).
- Set `FLEET_SECRETS_JSON` to a JSON object and list the names in the profile. Only listed names are injected.

```bash
# local
export FLEET_SECRETS_JSON='{"ANTHROPIC_API_KEY":"..."}'
node worker-runner.mjs --profile .agents/fleet/worker.json ...
```

Never commit a secrets file or a profile containing a literal credential. The agent runs as the same OS user as the runner; process isolation is the provider's responsibility, so issue each agent a least-privilege credential rather than a personal administrator key.

## Included examples

- `opencode.json` — OpenCode CLI.
- `claude-code.json` — Claude Code non-interactive mode.
- `codex.json` — Codex `exec`.
- `gemini-cli.json` — Gemini CLI.
- `aider.json` — Aider message mode.
- `custom-argv.json` — any agent that accepts the prompt as a positional argument.
- `custom-file.json` — any agent that reads a prompt file.
- `custom-stdin.json` — any agent that reads stdin.

These are starting points, not a compatibility promise: agent flags change. Run `worker-runner.mjs --dry-run` against your profile and adjust the argv and approval flags for the installed version. The fleet never hardcodes any of them.
