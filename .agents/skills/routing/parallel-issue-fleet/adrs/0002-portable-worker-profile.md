# ADR 0002: Portable worker profiles instead of an agent-specific worker

## Status

Accepted

## Context

The first fleet implementation treated the worker as `opencode run` in the local path and hardcoded OpenCode installation and credential names in the GitHub Actions workflow. That made the orchestrator depend on one vendor, one model provider, and one hosting assumption. A fleet that claims to orchestrate “issue agents” must instead accept any coding-agent CLI, any model, and any environment.

The hard problems are not the agent's flags. They are:

- keeping agent-specific argv and credentials out of the scheduler and provider adapters;
- preserving one security boundary across local, container, SSH, and hosted execution;
- allowing a repository to change agents without changing the fleet;
- avoiding shell interpolation of untrusted issue text;
- failing closed when a credential or profile is missing.

## Decision

Introduce a **worker profile** and a **worker runner**.

1. A profile is JSON: `setup`, `command`, `modelArgs`, `promptDelivery`, `model`, `modelEnv`, `env`, `requiredEnv`, and `timeoutMs`.
2. `worker-runner.mjs` is dependency-free, executes argv arrays only, supports `argv`/`stdin`/`file` prompt delivery, expands a closed set of placeholders, and builds a minimal child environment.
3. The controller resolves the profile for local execution and invokes the runner. It no longer has an agent-specific default.
4. The GitHub Actions workflow accepts a committed `worker_profile` path, runs the committed runner, and receives credentials through a single `FLEET_SECRETS_JSON` secret. The profile determines which names are injected.
5. Other environments implement the existing seven-command provider contract and call the same runner inside the VM/container. No provider imports an agent SDK.
6. Example profiles for common agents are assets, not defaults. They are starting points; the operator verifies flags against the installed version.

## Consequences

- Changing the agent or model is a profile edit, not a code change.
- The fleet artifact records the profile name and model, never the command or credential values.
- The same runner provides local/CI parity and one auditable environment allowlist.
- A missing profile or required environment variable fails before work starts.
- The GitHub workflow no longer contains vendor-specific install or auth steps.
- The runner asset must be copied into the target repository and kept in sync with the canonical script; a regression test compares the two files byte-for-byte.
- Agent CLIs remain a moving target. Profiles are configuration, so a flag change does not require a new skill release.
- The fleet still stops at a validated branch; publication, review, and merge remain outside this skill.
