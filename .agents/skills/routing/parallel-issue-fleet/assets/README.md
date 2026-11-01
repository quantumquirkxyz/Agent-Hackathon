# Parallel Issue Fleet assets

- `github-actions/fleet-worker.yml` — agent-neutral workflow template for the recommended free VM provider.
- `github-actions/worker-runner.mjs` — portable runner copied into the target repository at `.github/fleet/worker-runner.mjs`.
- `github-actions/provider.example.json` — provider configuration for that workflow.
- `workers/*.json` — worker profiles for OpenCode, Claude Code, Codex, Gemini CLI, Aider, and custom argv/stdin/file agents.
- `workers/README.md` — profile schema, placeholders, prompt delivery, and secret handling.

Copy the workflow into the target repository's `.github/workflows/` directory, the runner into `.github/fleet/`, and one profile into `.github/fleet/worker.json`. Provider configurations and profiles belong to consuming repositories and must not contain secret values; put credentials in `FLEET_SECRETS_JSON` or named environment variables.

The same profile is portable: a local worktree, a Docker container, an SSH VM, or a hosted runner only needs to execute `worker-runner.mjs` with the profile, workspace, and prompt file.
