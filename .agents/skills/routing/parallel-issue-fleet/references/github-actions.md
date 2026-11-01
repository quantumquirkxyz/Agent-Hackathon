# GitHub Actions provider

The simplest free VM provider for `parallel-issue-fleet` is a GitHub-hosted runner. Each dispatched workflow is one ephemeral Ubuntu VM with its own checkout, CPU, memory, and network. Nothing runs on the operator machine, and public repositories consume no paid minutes.

The workflow is **agent-neutral**. It runs a committed worker profile through a committed runner; it does not know whether the agent is OpenCode, Claude Code, Codex, Gemini CLI, Aider, or a custom CLI.

## Why this provider

| Option | Free? | Real VM? | Fits a 4 GB workstation? | Setup |
|---|---|---|---|---|
| GitHub Actions `ubuntu-latest` | Yes for public repositories; monthly minutes on the Free plan for private repositories | Yes, ephemeral VM per job | Yes, no local memory | One workflow, one runner, one profile, one secret |
| Multipass | Yes | Yes | No, two 2–4 GB VMs exhaust the host | Install Multipass and KVM |
| Oracle Cloud Always Free | Yes | Yes | Yes | Account, quota, and network setup |
| Docker | Yes | No, shared kernel | Marginal | Docker only |

Use GitHub Actions unless the repository cannot live on GitHub or the operator needs fully offline execution.

## Requirements

1. The target repository is on GitHub and Actions is enabled.
2. `.github/workflows/fleet-worker.yml` exists on the default branch. Copy it from `assets/github-actions/fleet-worker.yml`.
3. `.github/fleet/worker-runner.mjs` exists on the default branch. Copy it from `assets/github-actions/worker-runner.mjs`.
4. `.github/fleet/worker.json` exists on the default branch. Copy one profile from `assets/workers/` and edit it for the installed agent version.
5. Credentials are available to the worker. The recommended path is one `FLEET_SECRETS_JSON` secret containing a JSON object; the profile names which entries it may read. Direct `env:` entries also work.
6. Optional: set `worker.model` in the provider configuration to pin a model, or set a repository variable named `FLEET_MODEL`. The adapter passes the workflow input; an empty input falls back to `vars.FLEET_MODEL`, then to the profile default.
7. The workflow's `contents: write` permission is allowed by the repository's Actions settings.
8. The local `gh` CLI is authenticated with the `repo` scope. Pushing a workflow file additionally requires the `workflow` scope:
   ```bash
   gh auth refresh -s repo,workflow
   ```

## Setup

```bash
# 1. Copy the workflow, runner, and one profile.
mkdir -p .github/workflows .github/fleet
cp .agents/skills/routing/parallel-issue-fleet/assets/github-actions/fleet-worker.yml \
   .github/workflows/fleet-worker.yml
cp .agents/skills/routing/parallel-issue-fleet/assets/github-actions/worker-runner.mjs \
   .github/fleet/worker-runner.mjs
cp .agents/skills/routing/parallel-issue-fleet/assets/workers/claude-code.json \
   .github/fleet/worker.json

# 2. Edit .github/fleet/worker.json for the agent, approval flags, and model.
#    Keep credentials out of the file.

# 3. Store credentials as one JSON secret, from a file that is never committed.
cat > .fleet-secrets.json <<'JSON'
{"ANTHROPIC_API_KEY":"..."}
JSON
gh secret set FLEET_SECRETS_JSON --repo owner/repository < .fleet-secrets.json
rm .fleet-secrets.json

# 4. Optional: set a repository-wide default model.
gh variable set FLEET_MODEL --repo owner/repository --body 'provider/model'

# 5. Commit and push to the default branch.
git add .github/workflows/fleet-worker.yml .github/fleet/worker-runner.mjs .github/fleet/worker.json
git commit -m "ci: add portable fleet worker"
git push
```

Copy `assets/github-actions/provider.example.json`, replace `owner/repository`, `repo`, and the absolute paths, then pass it with `--provider`. The adapter resolves the repository's default branch with `gh repo view` unless the provider config passes `--ref <branch>`; this matters when the default branch is `master` or a release branch.

The profile's `env` and `requiredEnv` arrays select which names the runner may read from `FLEET_SECRETS_JSON`. An unknown name is not injected. For a local model or an agent with its own login, leave `requiredEnv` empty.

## Cost and limits

- Public repositories: standard GitHub-hosted runners are free.
- Private repositories on the Free plan: 2,000 Actions minutes per month; Linux minutes are billed at 1×.
- The template caps a job at 360 minutes, below GitHub's 6-hour job limit. Lower `--timeout-ms` and the workflow `timeout-minutes` for tighter cost control.
- `concurrency` keeps one run per `(run, issue)`. Distinct issues run concurrently up to the fleet's `--concurrency`.
- Verify the current allowance and runner specification in GitHub's billing documentation before relying on a monthly budget.

## Security model

- The issue body is untrusted text. The controller passes it through `FLEET_ISSUE_BODY`; the adapter sends it as a workflow input; the workflow writes the rendered prompt to `$RUNNER_TEMP/fleet-prompt.txt` from an environment variable. It is never interpolated into a shell command.
- `FLEET_SECRETS_JSON` is exposed only to the worker step. The runner parses it and injects only the names listed in the profile's `env`/`requiredEnv`.
- The runner builds a minimal child environment. It excludes `GITHUB_TOKEN`, `ACTIONS_RUNTIME_TOKEN`, and unrelated parent variables. Those names, the Actions OIDC request variables, and `FLEET_SECRETS_JSON` are reserved and are rejected if a profile tries to list them.
- Under Actions the runner registers each injected value with `::add-mask::`, so an agent that prints its environment does not also print the credential in the log.
- `actions/checkout` uses `persist-credentials: false`, and the agent step has no repository token. The push step receives `GITHUB_TOKEN` only after the agent exits.
- The workflow validates that `worker_profile` is a `.json` file under `.github/fleet/` and contains no `..`.
- The workflow validates that the branch starts with `fleet/` and is a well-formed git ref before checking it out or pushing. A fleet dispatch cannot target `main`, `master`, or another unprotected branch name.
- The `ImplementArtifact` is uploaded as a build artifact and validated locally after download.
- The adapter refuses cleanup when the ownership token does not match the dispatched run.
- The fleet still does not publish or merge. Branches flow to `publish-open-pr` and `review-pr`.
- **Trust boundary:** the agent runs arbitrary code with network access inside the VM, and later steps share that VM. The child-environment allowlist is not an OS sandbox. Run trusted agents and models only, give each agent a least-privilege credential, and do not point an adversarial prompt at a runner that holds a write token. For untrusted workloads, use a disposable VM with no repository token and publish through a separate controlled job.

## Lifecycle mapping

| Controller command | Adapter action |
|---|---|
| `provision` | `gh workflow run` and match the unique `run-name`, then persist the run identity, worker profile, model, and ownership token |
| `status` | `gh run view --json status,conclusion` mapped to `running`, `completed`, or `failed` |
| `bootstrap` | No-op; the workflow installs dependencies |
| `execute` | `gh run watch --exit-status` blocks until the VM finishes |
| `validate` | Confirms the run concluded successfully |
| `collect` | Fetches the pushed branch, downloads `fleet-artifact`, validates the `ImplementArtifact` |
| `cleanup` | Verifies the ownership token, cancels a still-running workflow, and releases the local marker; a completed VM is already destroyed |

## Landing policy

`confirm-landed` checks that every issue commit is an ancestor of the new base. Configure the repository to allow merge commits or rebase merging for fleet branches; a squash merge rewrites the commit and is rejected. If the repository requires squash merges, use the `integration-branch` strategy and land the integration branch instead.

## Troubleshooting

- `workflow not found`: the workflow is missing from the default branch, or `gh` lacks the `workflow` scope when pushing it. Add it through the web UI or use a PAT with `repo,workflow`.
- `dispatched workflow did not appear in gh run list within 90s`: the dispatch was rejected (permissions, invalid inputs) or `run-name` was changed. Check `gh run list --workflow fleet-worker.yml`.
- `missing .github/fleet/worker-runner.mjs`: copy the runner from `assets/github-actions/worker-runner.mjs`.
- `missing worker profile`: commit `.github/fleet/worker.json` or pass a valid `worker.profile` under `.github/fleet/`.
- `missing required worker environment variable`: the profile's `requiredEnv` names are not present. Add them to `FLEET_SECRETS_JSON` or remove them from `requiredEnv` if the agent uses its own login.
- Job fails at `Require the ImplementArtifact`: the agent did not write the artifact at the path in `FLEET_IMPLEMENT_ARTIFACT`. The fleet fails closed by design.
- Job fails at `Commit and push`: the worker produced no changes, or Actions lacks `contents: write`.
- `collect` fails to download: the job failed before `actions/upload-artifact`, or the artifact name was changed.
