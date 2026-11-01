#!/usr/bin/env node
// github-actions-provider.mjs - vm-pool provider backed by GitHub Actions runners.
//
// Every issue runs in one ephemeral GitHub-hosted Ubuntu VM. The workflow that
// does the work lives in the target repository as `.github/workflows/fleet-worker.yml`
// (copy the template from assets/github-actions/). This adapter only controls the
// lifecycle: dispatch, watch, collect, and release ownership.
//
// Commands (all emit one JSON object on stdout):
//   provision  dispatch the workflow and record the run identity
//   status     map the Actions run status to absent|ready|running|completed|failed
//   bootstrap  no-op; the workflow bootstraps the checkout
//   execute    block until the run finishes and fail on a non-success conclusion
//   validate   confirm the run completed successfully
//   collect    fetch the branch and download the ImplementArtifact
//   cleanup    verify the ownership token and release the marker
//
// No secret value is accepted as an argument. The workflow reads its credentials
// from GitHub Actions secrets.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_WORKFLOW = 'fleet-worker.yml';
const DEFAULT_ARTIFACT = 'fleet-artifact';
const DEFAULT_REF = 'main';
const DEFAULT_WORKER_PROFILE = '.github/fleet/worker.json';
const DISPATCH_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 3_000;
const MAX_PROMPT_BODY = 60_000;

function now() {
  return new Date().toISOString();
}

function fail(message) {
  const error = new Error(message);
  error.cli = true;
  throw error;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) fail(`Unexpected argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) fail(`Missing value for --${token.slice(2)}`);
    index += 1;
    options[key] = value;
  }
  return options;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  }
  return result.stdout;
}

function gh(args, options) {
  return run('gh', args, options);
}

function git(args, options) {
  return run('git', args, options);
}

function requireOptions(options, names) {
  for (const name of names) if (!options[name]) fail(`missing --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
}

function safePathSegment(value) {
  const safe = String(value ?? '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '');
  return safe === '' ? '_' : safe;
}

function markerPath(stateDir, resourceId) {
  return path.join(stateDir, 'provider', `${safePathSegment(resourceId)}.json`);
}

function writeMarker(stateDir, marker) {
  const target = markerPath(stateDir, marker.resourceId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  return target;
}

function readMarker(stateDir, resourceId) {
  const target = markerPath(stateDir, resourceId);
  if (!fs.existsSync(target)) return null;
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

export function mapRunState(value = {}) {
  const status = String(value.status ?? '').toLowerCase();
  const conclusion = String(value.conclusion ?? '').toLowerCase();
  if (status === 'completed') return conclusion === 'success' ? 'completed' : 'failed';
  if (['queued', 'requested', 'pending', 'waiting', 'in_progress'].includes(status)) return 'running';
  return 'unknown';
}

export function runTitle(runId, issueId) {
  return `fleet-${runId}-${issueId}`;
}

export function parseRunId(payload, runId, issueId) {
  let runs;
  try {
    runs = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!Array.isArray(runs)) return null;
  const title = runTitle(runId, issueId);
  const match = runs.find((entry) => entry.displayTitle === title);
  return match ? String(match.databaseId) : null;
}

export function validateWorkerProfilePath(value = DEFAULT_WORKER_PROFILE) {
  const normalized = String(value).replace(/\\/g, '/');
  if (path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error('worker profile must be a repository-relative path under .github/fleet/');
  }
  if (!normalized.startsWith('.github/fleet/') || !normalized.endsWith('.json')) {
    throw new Error('worker profile must be a .json file under .github/fleet/');
  }
  return normalized;
}

export function validateFleetBranch(value) {
  const branch = String(value ?? '');
  if (!branch.startsWith('fleet/') || branch.length <= 'fleet/'.length) {
    throw new Error('fleet branch must start with fleet/ and name a branch');
  }
  if (
    branch.endsWith('/')
    || branch.endsWith('.')
    || branch.endsWith('.lock')
    || branch.includes('..')
    || branch.includes('@{')
    || branch.includes('//')
    || /[\s~^:?*[\]\\]/.test(branch)
    || /[\x00-\x1f\x7f]/.test(branch)
  ) {
    throw new Error('fleet branch is not a valid git branch name');
  }
  for (const part of branch.split('/')) {
    if (!part || part.startsWith('.') || part.endsWith('.lock')) {
      throw new Error('fleet branch is not a valid git branch name');
    }
  }
  return branch;
}

export function buildPrompt({ issueId, issueTitle, issueUrl, issueBody, artifactPath, runId, baseSha }) {
  const body = String(issueBody ?? '').slice(0, MAX_PROMPT_BODY);
  return [
    'Work only in this checkout. Do not switch branches, push, open or merge a pull request, or close an issue.',
    `Implement issue ${issueUrl || issueId}: ${issueTitle}`,
    body,
    `Follow the repository AGENTS.md and any implementation workflow it defines; otherwise implement the issue directly. Stop at a committed, locally validated branch. Write the required ImplementArtifact to ${artifactPath}.`,
    `Fleet run: ${runId}; immutable base: ${baseSha}.`,
  ].filter(Boolean).join('\n\n');
}

export function buildDispatchInputs(options = {}) {
  const artifactPath = options.artifactPath
    || `.agents/skills/platform/artifacts/implement/${safePathSegment(options.issueId)}.json`;
  return {
    run_id: String(options.runId ?? ''),
    issue_id: String(options.issueId ?? ''),
    issue_title: String(options.issueTitle ?? ''),
    issue_url: String(options.issueUrl ?? ''),
    branch: validateFleetBranch(options.branch),
    base_sha: String(options.baseSha ?? ''),
    artifact_path: artifactPath,
    prompt: buildPrompt({ ...options, artifactPath }),
    worker_profile: validateWorkerProfilePath(options.workerProfile || DEFAULT_WORKER_PROFILE),
    model: String(options.model ?? ''),
  };
}

export function collectArtifactPath(destination, issueId) {
  return path.join(destination, `${safePathSegment(issueId)}.json`);
}

export function validateCollectedArtifact(file, issueId) {
  const errors = [];
  if (!fs.existsSync(file)) return [`no ImplementArtifact downloaded at ${file}`];
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return [`downloaded ImplementArtifact is not valid JSON: ${error.message}`];
  }
  if (value.status !== 'completed') errors.push('status must be completed');
  if (value.validation?.acceptanceCriteriaMet !== true) errors.push('validation.acceptanceCriteriaMet must be true');
  if (String(value.issueId ?? value.issue ?? issueId) !== String(issueId)) {
    errors.push(`artifact issue identity does not match ${issueId}`);
  }
  return errors;
}

function pollRun(options, workflow, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const payload = gh([
      'run', 'list',
      '--repo', options.repo,
      '--workflow', workflow,
      '--event', 'workflow_dispatch',
      '--limit', '20',
      '--json', 'databaseId,displayTitle',
    ]);
    const workflowRunId = parseRunId(payload, options.runId, options.issueId);
    if (workflowRunId) return workflowRunId;
    if (Date.now() >= deadline) return null;
    spawnSync('sleep', ['3']);
  }
}

function resolveRef(options) {
  if (options.ref) return options.ref;
  try {
    const name = gh([
      'repo', 'view', options.repo,
      '--json', 'defaultBranchRef',
      '--jq', '.defaultBranchRef.name',
    ]).trim();
    return name || DEFAULT_REF;
  } catch {
    return DEFAULT_REF;
  }
}

function dispatch(options) {
  requireOptions(options, ['repo', 'stateDir', 'runId', 'issueId', 'branch', 'baseSha', 'ownershipToken']);
  const workflow = options.workflow ?? DEFAULT_WORKFLOW;
  const ref = resolveRef(options);
  const issueTitle = options.issueTitle ?? process.env.FLEET_ISSUE_TITLE ?? '';
  const issueUrl = options.issueUrl ?? process.env.FLEET_ISSUE_URL ?? '';
  const issueBody = options.issueBody ?? process.env.FLEET_ISSUE_BODY ?? '';
  const artifactPath = options.artifactPath
    || `.agents/skills/platform/artifacts/implement/${safePathSegment(options.issueId)}.json`;
  const workerProfile = validateWorkerProfilePath(options.workerProfile || DEFAULT_WORKER_PROFILE);
  const branch = validateFleetBranch(options.branch);
  const model = options.model ?? process.env.FLEET_MODEL ?? '';
  const resourceId = `gha:${options.runId}:${options.issueId}`;
  const existing = readMarker(options.stateDir, resourceId);
  if (existing && (
    existing.repo !== options.repo
    || existing.branch !== branch
    || existing.baseSha !== options.baseSha
    || existing.workerProfile !== workerProfile
  )) {
    fail('a dispatch marker for this issue exists with different repository, branch, base, or worker inputs; release it explicitly before retrying');
  }

  if (existing?.workflowRunId) {
    return {
      resourceId,
      ownershipToken: existing.ownershipToken,
      branch: validateFleetBranch(existing.branch),
      workflowRunId: String(existing.workflowRunId),
    };
  }

  if (existing && !existing.workflowRunId) {
    const found = pollRun(options, workflow, 10_000);
    if (found) {
      existing.workflowRunId = found;
      existing.status = 'dispatched';
      existing.updatedAt = now();
      writeMarker(options.stateDir, existing);
      return {
        resourceId,
        ownershipToken: existing.ownershipToken,
        branch: validateFleetBranch(existing.branch),
        workflowRunId: found,
      };
    }
    if (existing.status !== 'dispatch-failed') {
      fail('a previous dispatch for this issue is unresolved; inspect gh run list and clean up the marker before retrying');
    }
  }

  const marker = {
    resourceId,
    ownershipToken: options.ownershipToken,
    workflowRunId: null,
    status: 'dispatching',
    repo: options.repo,
    branch,
    baseSha: options.baseSha,
    issueId: options.issueId,
    artifactPath,
    workerProfile,
    model,
    createdAt: now(),
    updatedAt: now(),
  };
  writeMarker(options.stateDir, marker);

  try {
    const inputs = buildDispatchInputs({
      issueId: options.issueId,
      issueTitle,
      issueUrl,
      issueBody,
      artifactPath,
      runId: options.runId,
      baseSha: options.baseSha,
      branch,
      workerProfile,
      model,
    });
    const args = ['workflow', 'run', workflow, '--repo', options.repo, '--ref', ref];
    for (const [name, value] of Object.entries(inputs)) args.push('-f', `${name}=${value}`);
    gh(args);
  } catch (error) {
    marker.status = 'dispatch-failed';
    marker.updatedAt = now();
    writeMarker(options.stateDir, marker);
    throw error;
  }

  const workflowRunId = pollRun(options, workflow, DISPATCH_TIMEOUT_MS);
  if (!workflowRunId) {
    marker.status = 'dispatch-unknown';
    marker.updatedAt = now();
    writeMarker(options.stateDir, marker);
    fail('dispatched workflow did not appear in gh run list within 90s');
  }

  marker.workflowRunId = workflowRunId;
  marker.status = 'dispatched';
  marker.updatedAt = now();
  writeMarker(options.stateDir, marker);
  return {
    resourceId,
    ownershipToken: options.ownershipToken,
    branch,
    workflowRunId,
  };
}

function runState(options) {
  const marker = readMarker(options.stateDir, options.resourceId);
  if (!marker) return { state: 'absent', marker: null };
  if (!marker.workflowRunId) {
    return { state: marker.status === 'dispatching' ? 'dispatching' : 'unknown', marker };
  }
  const payload = gh([
    'run', 'view', String(marker.workflowRunId),
    '--repo', marker.repo,
    '--json', 'status,conclusion',
  ]);
  return { state: mapRunState(JSON.parse(payload)), marker };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options.command || options.command === 'help') {
    console.log(JSON.stringify({
      ok: true,
      commands: ['provision', 'status', 'bootstrap', 'execute', 'validate', 'collect', 'cleanup'],
    }));
    return 0;
  }

  if (options.command === 'provision') {
    console.log(JSON.stringify(dispatch(options)));
    return 0;
  }

  if (options.command === 'status') {
    requireOptions(options, ['stateDir', 'resourceId']);
    const { state } = runState(options);
    console.log(JSON.stringify({ state, resourceId: options.resourceId }));
    return 0;
  }

  if (options.command === 'bootstrap') {
    console.log(JSON.stringify({ ok: true, detail: 'the GitHub Actions checkout bootstraps itself' }));
    return 0;
  }

  if (options.command === 'execute' || options.command === 'validate') {
    const { state, marker } = runState(options);
    if (!marker) fail(`no dispatched run is recorded for ${options.resourceId}`);
    if (!marker.workflowRunId) {
      fail(`dispatch for ${options.resourceId} is ${marker.status ?? 'unresolved'}; inspect gh run list`);
    }
    if (state === 'failed') fail(`workflow run ${marker.workflowRunId} failed`);
    if (state !== 'completed') {
      gh(['run', 'watch', String(marker.workflowRunId), '--repo', marker.repo, '--exit-status', '--interval', '10'], {
        timeoutMs: 6 * 60 * 60 * 1000,
      });
    }
    const confirm = runState(options);
    if (confirm.state !== 'completed') fail(`workflow run ${marker.workflowRunId} is ${confirm.state}`);
    console.log(JSON.stringify({ state: 'completed', resourceId: options.resourceId }));
    return 0;
  }

  if (options.command === 'collect') {
    requireOptions(options, ['stateDir', 'resourceId', 'dest']);
    const { state, marker } = runState(options);
    if (!marker) fail(`no dispatched run is recorded for ${options.resourceId}`);
    if (state !== 'completed') fail(`cannot collect a run in state ${state}`);

    git(['fetch', 'origin', `+refs/heads/${marker.branch}:refs/remotes/origin/${marker.branch}`]);
    const commitSha = git(['rev-parse', `refs/remotes/origin/${marker.branch}`]).trim();

    fs.mkdirSync(options.dest, { recursive: true });
    gh([
      'run', 'download', String(marker.workflowRunId),
      '--repo', marker.repo,
      '-n', DEFAULT_ARTIFACT,
      '-D', options.dest,
    ]);

    const artifact = collectArtifactPath(options.dest, marker.issueId);
    const errors = validateCollectedArtifact(artifact, marker.issueId);
    if (errors.length) fail(`collected artifact is invalid: ${errors.join('; ')}`);
    console.log(JSON.stringify({ branch: marker.branch, commitSha, implementArtifactPath: artifact }));
    return 0;
  }

  if (options.command === 'cleanup') {
    requireOptions(options, ['stateDir', 'resourceId', 'ownershipToken']);
    const marker = readMarker(options.stateDir, options.resourceId);
    if (!marker) {
      console.log(JSON.stringify({ ok: true, cleaned: false, detail: 'no marker to release' }));
      return 0;
    }
    if (marker.ownershipToken !== options.ownershipToken) {
      fail('ownership token does not match the dispatched run; refusing cleanup');
    }
    if (!marker.workflowRunId) {
      fail('dispatch is unresolved; refusing cleanup until the workflow run is identified or cancelled manually');
    }
    const { state } = runState(options);
    if (state === 'running' || state === 'unknown') {
      gh(['run', 'cancel', String(marker.workflowRunId), '--repo', marker.repo]);
    }
    fs.unlinkSync(markerPath(options.stateDir, options.resourceId));
    console.log(JSON.stringify({ ok: true, cleaned: true, resourceId: options.resourceId, workflowRunId: marker.workflowRunId, cancelledRun: state === 'running' || state === 'unknown' }));
    return 0;
  }

  fail(`Unknown command: ${options.command}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}
