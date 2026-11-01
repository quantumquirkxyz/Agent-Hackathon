#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { analyze, normalizeInput } from '../../../platform/dag-scheduler.mjs';
import { resolveWorkerProfile } from './worker-runner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_RUNNER = path.join(HERE, 'worker-runner.mjs');
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
const DEFAULT_STATE_ROOT = path.join(REPO_ROOT, '.scratch', 'fleet-runs');
const MAX_OUTPUT = 1024 * 1024;
const TERMINAL_ISSUE_STATES = new Set(['validated', 'failed', 'timed-out', 'blocked', 'cleaned']);
const SUPPORTED_PROVIDERS = new Set(['local-worktree', 'vm-pool']);
const SUPPORTED_STRATEGIES = new Set(['land-by-wave', 'integration-branch']);
const IMPLEMENT_ARTIFACT_DIR = path.join('.agents', 'skills', 'platform', 'artifacts', 'implement');

function now() {
  return new Date().toISOString();
}

function slug(value) {
  return String(value ?? 'issue')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'issue';
}

function safePathSegment(value) {
  const safe = String(value ?? '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '');
  return safe === '' ? '_' : safe;
}

function ticketId(ticket, index) {
  return String(ticket.id ?? ticket.number ?? ticket.key ?? index + 1);
}

export function ticketBody(source = {}) {
  if (typeof source.body === 'string' && source.body.trim()) return source.body;
  const criteria = source.acceptanceCriteria ?? source.acceptance_criteria ?? [];
  const parts = [];
  if (source.description) parts.push(`## Description\n\n${source.description}`);
  if (Array.isArray(criteria) && criteria.length) {
    parts.push(`## Acceptance criteria\n\n${criteria.map((item) => `- ${item}`).join('\n')}`);
  }
  if (source.validation) parts.push(`## Validation\n\n${source.validation}`);
  return parts.join('\n\n');
}

export function ticketNumber(source = {}) {
  const value = source.number ?? source.issueNumber ?? source.issue_number ?? null;
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function event(artifact, type, fields = {}) {
  artifact.events.push({ ts: now(), type, ...fields });
  artifact.updatedAt = now();
}

function workerSummary(worker) {
  if (!worker) return undefined;
  if (typeof worker === 'string') return { profile: worker };
  return {
    ...(worker.name ? { name: worker.name } : {}),
    ...(worker.profile ? { profile: worker.profile } : {}),
    ...(worker.model ? { model: worker.model } : {}),
    ...(!worker.name && !worker.profile ? { name: 'inline' } : {}),
  };
}

function publicProvider(provider = {}) {
  return {
    type: provider.type ?? 'local-worktree',
    ...(provider.name ? { name: provider.name } : {}),
    ...(provider.pool ? { pool: provider.pool } : {}),
    ...(provider.workspaceRoot ? { workspaceRoot: provider.workspaceRoot } : {}),
    ...(workerSummary(provider.worker) ? { worker: workerSummary(provider.worker) } : {}),
  };
}

export function buildFleetPlan(payload, options = {}) {
  const report = analyze(payload);
  if (report.errors.length) throw new Error(`Ticket DAG is invalid: ${report.errors.join('; ')}`);
  const normalized = normalizeInput(payload);
  const originals = Array.isArray(payload) ? payload : (payload.tickets ?? payload.output);
  const originalById = new Map(originals.map((ticket, index) => [ticketId(ticket, index), ticket]));
  const runId = String(options.runId ?? `fleet-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
  const strategy = options.integrationStrategy ?? 'land-by-wave';
  const provider = publicProvider(options.provider);
  if (!SUPPORTED_PROVIDERS.has(provider.type)) throw new Error(`Unsupported provider type: ${provider.type}`);
  if (!SUPPORTED_STRATEGIES.has(strategy)) throw new Error(`Unsupported integration strategy: ${strategy}`);

  const waveByIssue = new Map();
  for (const wave of report.levels) for (const issue of wave.tickets) waveByIssue.set(issue.id, wave.level);
  const issues = normalized.map((ticket, index) => {
    const source = originalById.get(ticket.id) ?? originals[index] ?? {};
    return {
      id: ticket.id,
      number: ticketNumber(source),
      title: ticket.title,
      url: source.url ?? source.issueUrl ?? source.html_url ?? null,
      body: ticketBody(source),
      blockedBy: [...ticket.blockedBy],
      wave: waveByIssue.get(ticket.id),
      status: 'pending',
      attempt: 0,
      executionState: 'not-started',
      branch: null,
      commitSha: null,
      implementArtifactPath: null,
      qualityGateResults: [],
      resourceIds: [],
      error: null,
    };
  });

  const createdAt = now();
  return {
    schemaVersion: '1.0',
    artifactType: 'fleet-run',
    runId,
    status: 'planned',
    createdAt,
    updatedAt: createdAt,
    source: {
      ticketArtifactPath: options.ticketArtifactPath ?? null,
      ticketArtifactTraceId: payload.traceId ?? null,
      base: String(options.base ?? ''),
      baseRevision: String(options.baseRevision ?? ''),
    },
    policy: {
      concurrency: Math.max(1, Number(options.concurrency ?? 2)),
      timeoutMs: Math.max(1, Number(options.timeoutMs ?? 30 * 60 * 1000)),
      integrationStrategy: strategy,
      cleanup: options.cleanup ?? 'always',
      secretEnvNames: [...new Set(options.secretEnvNames ?? [])],
    },
    provider,
    currentWave: 0,
    waves: report.levels.map((wave) => ({
      level: wave.level,
      issueIds: wave.tickets.map((ticket) => ticket.id),
      status: 'pending',
      landedIssueIds: [],
    })),
    issues,
    resources: [],
    integration: {
      branch: strategy === 'integration-branch' ? `fleet/${safePathSegment(runId)}/integration` : null,
      commits: [],
      conflicts: [],
    },
    telemetry: { traceId: crypto.randomUUID(), startedAt: null, finishedAt: null },
    cleanup: { status: 'pending', cleanedResourceIds: [], errors: [] },
    events: [{ ts: createdAt, type: 'fleet.planned', runId }],
    implementArtifacts: [],
    nextConsumer: 'parallel-issue-fleet',
    riskRemaining: 'Fleet execution has not started.',
  };
}

export function validateFleetArtifact(artifact) {
  const errors = [];
  for (const key of ['schemaVersion', 'artifactType', 'runId', 'status', 'source', 'policy', 'provider', 'waves', 'issues', 'resources', 'events']) {
    if (artifact?.[key] === undefined) errors.push(`missing required field: ${key}`);
  }
  if (artifact?.artifactType !== 'fleet-run') errors.push('artifactType must be fleet-run');
  if (artifact?.secretValues !== undefined) errors.push('secretValues must never be persisted');
  if (!Array.isArray(artifact?.waves)) errors.push('waves must be an array');
  if (!Array.isArray(artifact?.issues)) errors.push('issues must be an array');
  if (Array.isArray(artifact?.resources)) {
    artifact.resources.forEach((resource, index) => {
      if (!resource.id) errors.push(`resources[${index}] is missing id`);
      if (!resource.ownershipToken) errors.push(`resources[${index}] is missing ownershipToken`);
      if (resource.secretValues !== undefined) errors.push(`resources[${index}] must not persist secretValues`);
    });
  }
  const issueIds = new Set((artifact?.issues ?? []).map((issue) => issue.id));
  for (const wave of artifact?.waves ?? []) {
    for (const id of wave.issueIds ?? []) if (!issueIds.has(id)) errors.push(`wave ${wave.level} references unknown issue ${id}`);
  }
  if (!SUPPORTED_PROVIDERS.has(artifact?.provider?.type)) errors.push(`unsupported provider: ${artifact?.provider?.type}`);
  if (!SUPPORTED_STRATEGIES.has(artifact?.policy?.integrationStrategy)) errors.push(`unsupported integration strategy: ${artifact?.policy?.integrationStrategy}`);
  return errors;
}

export function detectBootstrapCommands(workspace) {
  const exists = (name) => fs.existsSync(path.join(workspace, name));
  const commands = [];
  let packageRunner = null;
  if (exists('bun.lock') || exists('bun.lockb')) {
    commands.push(['bun', 'install', '--frozen-lockfile']);
    packageRunner = ['bun', 'run'];
  } else if (exists('pnpm-lock.yaml')) {
    commands.push(['pnpm', 'install', '--frozen-lockfile']);
    packageRunner = ['pnpm', 'run'];
  } else if (exists('yarn.lock')) {
    commands.push(['yarn', 'install', '--immutable']);
    packageRunner = ['yarn'];
  } else if (exists('package-lock.json')) {
    commands.push(['npm', 'ci']);
    packageRunner = ['npm', 'run'];
  }
  if (exists('package.json') && packageRunner) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
      if (pkg.scripts?.build) commands.push([...packageRunner, 'build']);
    } catch { /* malformed package.json is surfaced by the install/build command later */ }
  }
  if (exists('uv.lock')) commands.push(['uv', 'sync', '--frozen']);
  else if (exists('requirements.txt')) commands.push(['python', '-m', 'pip', 'install', '-r', 'requirements.txt']);
  if (exists('Cargo.lock')) commands.push(['cargo', 'build', '--locked']);
  if (exists('go.sum')) commands.push(['go', 'mod', 'download']);
  return commands;
}

function defaultQualityCommands(workspace) {
  if (fs.existsSync(path.join(workspace, '.agents', 'skills', 'platform', 'check-all.mjs'))) {
    return [['node', '.agents/skills/platform/check-all.mjs']];
  }
  if (!fs.existsSync(path.join(workspace, 'package.json'))) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
    const runner = fs.existsSync(path.join(workspace, 'bun.lock')) ? 'bun' : 'npm';
    return ['lint', 'typecheck', 'test'].filter((name) => pkg.scripts?.[name]).map((name) => [runner, 'run', name]);
  } catch {
    return [];
  }
}

export function redactEnvironment(environment, secretNames = []) {
  const secrets = new Set(secretNames);
  return Object.fromEntries(Object.entries(environment).map(([key, value]) => [key, secrets.has(key) ? '[REDACTED]' : value]));
}

function secretValueList(secretNames = []) {
  return secretNames
    .map((name) => process.env[name])
    .filter((value) => typeof value === 'string' && value.length >= 4);
}

export function redactSecrets(text, secretValues = []) {
  let output = String(text ?? '');
  for (const value of secretValues) output = output.split(value).join('[REDACTED]');
  return output;
}

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const startedAt = now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let closed = false;
    const append = (current, chunk) => `${current}${chunk}`.slice(-MAX_OUTPUT);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk.toString()); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk.toString()); });
    child.on('error', (error) => {
      stderr = append(stderr, error.message);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 250).unref();
    }, Math.max(1, options.timeoutMs ?? 30 * 60 * 1000));
    child.on('close', (code, signal) => {
      closed = true;
      clearTimeout(timer);
      resolve({
        command: [command, ...args],
        code: timedOut ? (code || 124) : (code ?? 1),
        signal: signal ?? null,
        timedOut,
        stdout,
        stderr,
        startedAt,
        finishedAt: now(),
      });
    });
  });
}

export async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => consume()));
  return results;
}

export function advanceAfterLanding(artifact, landedIssueIds, baseRevision) {
  if (artifact.status !== 'awaiting-land') throw new Error('Fleet is not awaiting a landed wave.');
  const wave = artifact.waves[artifact.currentWave];
  const supplied = new Set(landedIssueIds.map(String));
  if (wave.issueIds.some((id) => !supplied.has(id)) || supplied.size !== wave.issueIds.length) {
    throw new Error('Landing confirmation must include the entire wave.');
  }
  if (!baseRevision) throw new Error('A new immutable base revision is required after landing a wave.');
  wave.status = 'landed';
  wave.landedIssueIds = [...wave.issueIds];
  artifact.currentWave += 1;
  artifact.source.baseRevision = baseRevision;
  artifact.status = 'planned';
  artifact.nextConsumer = 'parallel-issue-fleet';
  artifact.riskRemaining = 'The next wave has not run.';
  event(artifact, 'fleet.wave-landed', { wave: wave.level, issueIds: [...wave.issueIds], baseRevision });
  return artifact;
}

export async function verifyWaveAncestry(artifact, landedIssueIds, baseRevision, repoPath, timeoutMs = 30_000) {
  if (artifact.status !== 'awaiting-land') throw new Error('Fleet is not awaiting a landed wave.');
  const wave = artifact.waves[artifact.currentWave];
  const supplied = new Set(landedIssueIds.map(String));
  if (wave.issueIds.some((id) => !supplied.has(id)) || supplied.size !== wave.issueIds.length) {
    throw new Error('Landing confirmation must include the entire wave.');
  }
  if (!baseRevision) throw new Error('A new immutable base revision is required after landing a wave.');

  const previousBase = artifact.source.baseRevision;
  if (previousBase) {
    const descended = await runCommand('git', ['merge-base', '--is-ancestor', previousBase, baseRevision], {
      cwd: repoPath,
      timeoutMs,
    });
    if (descended.code !== 0) {
      throw new Error(`New base ${baseRevision} does not descend from the previous base ${previousBase}.`);
    }
  }

  for (const issueId of wave.issueIds) {
    const issue = artifact.issues.find((entry) => entry.id === issueId);
    if (!issue?.commitSha) throw new Error(`Issue ${issueId} has no commitSha; cannot confirm landing.`);
    const ancestor = await runCommand('git', ['merge-base', '--is-ancestor', issue.commitSha, baseRevision], {
      cwd: repoPath,
      timeoutMs,
    });
    if (ancestor.code !== 0) {
      throw new Error(`Issue ${issueId} commit ${issue.commitSha} is not an ancestor of ${baseRevision}.`);
    }
  }
  return true;
}

function runDirectory(stateRoot, runId) {
  return path.join(stateRoot, safePathSegment(runId));
}

const CLAIM_TTL_MS = 6 * 60 * 60 * 1000;

function claimFile(stateRoot, issueId) {
  return path.join(stateRoot, 'claims', `${safePathSegment(issueId)}.json`);
}

export function acquireIssueClaim(stateRoot, runId, issueId, ttlMs = CLAIM_TTL_MS, nowMs = Date.now()) {
  const file = claimFile(stateRoot, issueId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({
          issueId: String(issueId),
          runId,
          createdAt: new Date(nowMs).toISOString(),
          expiresAt: new Date(nowMs + ttlMs).toISOString(),
        }));
      } finally {
        fs.closeSync(fd);
      }
      return { acquired: true, reused: false, file };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let current;
      try {
        current = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        throw Object.assign(new Error(`issue ${issueId} has an unreadable claim at ${file}`), { blocked: true });
      }
      if (current.runId === runId) return { acquired: true, reused: true, file };
      if (Date.parse(current.expiresAt) > nowMs) {
        throw Object.assign(
          new Error(`issue ${issueId} is claimed by run ${current.runId} until ${current.expiresAt}`),
          { blocked: true },
        );
      }
      fs.unlinkSync(file);
    }
  }
  throw Object.assign(new Error(`could not acquire the claim for issue ${issueId}`), { blocked: true });
}

export function releaseIssueClaim(stateRoot, runId, issueId) {
  const file = claimFile(stateRoot, issueId);
  if (!fs.existsSync(file)) return false;
  let current;
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
  if (current.runId !== runId) return false;
  fs.unlinkSync(file);
  return true;
}

function artifactFile(stateRoot, runId) {
  return path.join(runDirectory(stateRoot, runId), 'fleet-run.json');
}

async function saveArtifact(artifact, stateRoot) {
  const errors = validateFleetArtifact(artifact);
  if (errors.length) throw new Error(`FleetRunArtifact validation failed: ${errors.join('; ')}`);
  const dir = runDirectory(stateRoot, artifact.runId);
  await fsp.mkdir(dir, { recursive: true });
  const target = artifactFile(stateRoot, artifact.runId);
  const temporary = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(temporary, target);
  return target;
}

async function loadArtifact(stateRoot, runId) {
  return JSON.parse(await fsp.readFile(artifactFile(stateRoot, runId), 'utf8'));
}

function commandSpec(spec, context) {
  if (!Array.isArray(spec) || spec.length === 0) throw new Error('Provider commands must be non-empty argument arrays.');
  const lookup = {
    'run.id': context.artifact.runId,
    'issue.id': context.issue?.id ?? '',
    'issue.title': context.issue?.title ?? '',
    'issue.url': context.issue?.url ?? '',
    'issue.body': context.issue?.body ?? '',
    'branch': context.resource?.branch || context.issue?.branch || '',
    'base.revision': context.artifact.source.baseRevision,
    'workspace.path': context.workspacePath ?? '',
    'resource.id': context.resource?.id ?? '',
    'resource.ownershipToken': context.resource?.ownershipToken ?? '',
    'worker.profile': context.artifact?.provider?.worker?.profile ?? '',
    'worker.model': context.artifact?.provider?.worker?.model ?? '',
    'artifact.path': context.artifactPath ?? '',
    'state.dir': context.runDir,
  };
  return spec.map((part) => String(part).replace(/\{\{([^}]+)}}/g, (full, key) => {
    const name = key.trim();
    if (name === 'issue.body') {
      throw new Error('use FLEET_ISSUE_BODY instead of {{issue.body}}; issue text must not be interpolated into argv');
    }
    if (!(name in lookup)) return full;
    return String(lookup[name] ?? '');
  }));
}

function parseCommandJson(result) {
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  if (!lines.length) return {};
  try { return JSON.parse(lines.at(-1)); } catch { return {}; }
}

async function git(args, cwd, timeoutMs) {
  const result = await runCommand('git', args, { cwd, timeoutMs });
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function validatedBranchRef(branch, cwd, timeoutMs) {
  const local = `refs/heads/${branch}`;
  const localResult = await runCommand('git', ['show-ref', '--verify', '--quiet', local], { cwd, timeoutMs });
  if (localResult.code === 0) return branch;
  const remote = `refs/remotes/origin/${branch}`;
  const remoteResult = await runCommand('git', ['show-ref', '--verify', '--quiet', remote], { cwd, timeoutMs });
  if (remoteResult.code === 0) return remote;
  throw new Error(`validated branch ${branch} is not present locally or in origin`);
}

async function repositoryRoot(cwd, timeoutMs) {
  return git(['rev-parse', '--show-toplevel'], cwd, timeoutMs);
}

async function providerRoot(config, timeoutMs) {
  const root = config.repo ?? config.cwd;
  return repositoryRoot(root ? path.resolve(root) : REPO_ROOT, timeoutMs);
}

function secretEnvironment(names) {
  const values = {};
  const missing = [];
  for (const name of names) {
    if (process.env[name] === undefined) missing.push(name);
    else values[name] = process.env[name];
  }
  if (missing.length) throw new Error(`Missing ephemeral secret environment variables: ${missing.join(', ')}`);
  return values;
}

export function implementArtifactPath(config, issue) {
  const template = config.artifactPath
    || path.join(IMPLEMENT_ARTIFACT_DIR, '{{issue.id}}.json');
  return String(template).replace(/\{\{issue\.id}}/g, safePathSegment(issue.id));
}

function workerPrompt(issue, artifact, workspacePath, artifactPath) {
  return [
    `Work only in ${workspacePath}. Do not switch branches or touch another workspace.`,
    `Implement issue ${issue.url || issue.id}: ${issue.title}`,
    issue.body,
    'Follow the repository AGENTS.md and any implementation workflow it defines; otherwise implement the issue directly. Stop at a committed, locally validated branch. Do not push, open or merge a pull request, or close an issue.',
    `Write the required ImplementArtifact to ${artifactPath} inside this workspace. The fleet reads and validates that file; it does not accept unrecorded gate claims.`,
    `Fleet run: ${artifact.runId}; wave: ${issue.wave}; immutable base: ${artifact.source.baseRevision}.`,
  ].filter(Boolean).join('\n\n');
}

async function provisionLocal(context, config, env, intent) {
  const root = await providerRoot(config, context.artifact.policy.timeoutMs);
  const workspaceRoot = config.workspaceRoot
    ? path.resolve(config.workspaceRoot)
    : path.join(path.dirname(root), `${path.basename(root)}-fleet-worktrees`, safePathSegment(context.artifact.runId));
  await fsp.mkdir(workspaceRoot, { recursive: true });
  const workspacePath = path.join(workspaceRoot, `issue-${safePathSegment(context.issue.id)}`);
  const branch = context.issue.branch ?? `fleet/${safePathSegment(context.artifact.runId)}/${safePathSegment(context.issue.id)}-${slug(context.issue.title)}`;
  context.issue.branch = branch;
  if (!fs.existsSync(workspacePath)) {
    const existingBranch = await runCommand('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root, env, timeoutMs: context.artifact.policy.timeoutMs });
    const args = existingBranch.code === 0
      ? ['worktree', 'add', workspacePath, branch]
      : ['worktree', 'add', '-b', branch, workspacePath, context.artifact.source.baseRevision];
    await git(args, root, context.artifact.policy.timeoutMs);
  }
  return {
    id: `worktree:${context.issue.id}`,
    type: 'local-worktree',
    ownershipToken: intent.ownershipToken,
    workspacePath,
    branch,
    status: 'ready',
    createdAt: now(),
  };
}

async function runConfiguredCommand(name, context, config, env, required = true) {
  const spec = config.commands?.[name];
  if (!spec) {
    if (required) throw new Error(`vm-pool provider requires commands.${name}`);
    return { result: null, output: {} };
  }
  const command = commandSpec(spec, context);
  const result = await runCommand(command[0], command.slice(1), {
    cwd: path.resolve(config.cwd ?? config.repo ?? REPO_ROOT),
    env: { ...process.env, ...env },
    timeoutMs: context.artifact.policy.timeoutMs,
  });
  if (result.code !== 0) throw new Error(`${name} command failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  return { result, output: parseCommandJson(result) };
}

async function provisionVm(context, config, env, intent) {
  context.resource = intent;
  const { output } = await runConfiguredCommand('provision', context, config, env);
  if (!output.resourceId) throw new Error('vm-pool provision command must emit JSON with resourceId.');
  return {
    id: String(output.resourceId),
    type: 'vm-pool',
    ownershipToken: String(output.ownershipToken ?? intent.ownershipToken),
    workspacePath: output.workspacePath ?? null,
    branch: output.branch ?? `fleet/${safePathSegment(context.artifact.runId)}/${safePathSegment(context.issue.id)}-${slug(context.issue.title)}`,
    status: 'ready',
    createdAt: now(),
  };
}

async function runCommands(commands, options) {
  const results = [];
  for (const command of commands) {
    const result = await runCommand(command[0], command.slice(1), options);
    results.push(result);
    if (result.code !== 0) break;
  }
  return results;
}

function commandSummary(result, secretValues = []) {
  return {
    command: result.command,
    code: result.code,
    timedOut: result.timedOut,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    stderrTail: redactSecrets(result.stderr.slice(-2000), secretValues),
  };
}

export function validateImplementArtifact(value) {
  const errors = [];
  if (!value || typeof value !== 'object') return ['artifact must be an object'];
  if (!['completed', 'blocked', 'partial'].includes(value.status)) errors.push('status must be completed, blocked, or partial');
  if (value.status !== 'completed') errors.push('status must be completed before publication');
  if (value.validation?.acceptanceCriteriaMet !== true) errors.push('validation.acceptanceCriteriaMet must be true');
  for (const key of ['gateIde', 'gatePreCommit', 'gateCi']) {
    if (!['pass', 'fail', 'skipped'].includes(value.qualityGateResults?.[key])) {
      errors.push(`qualityGateResults.${key} must be pass, fail, or skipped`);
    }
  }
  return errors;
}

export function normalizeImplementArtifact(value, issue, options = {}) {
  const gateCommands = options.gateCommands ?? [];
  const localGatesPassed = options.localGatesPassed === true;
  const runId = options.runId ?? '';
  return {
    ...value,
    commitSha: issue.commitSha,
    branch: issue.branch,
    blockedBy: [...issue.blockedBy],
    nextConsumer: 'publish-open-pr',
    validation: {
      ...value.validation,
      commands: [...(value.validation.commands ?? []), ...gateCommands],
      notes: [
        value.validation.notes,
        `Fleet run ${runId} verified the branch and ran local quality gates; remote CI has not run.`,
      ].filter(Boolean).join(' '),
    },
    qualityGateResults: {
      gateIde: 'skipped',
      gatePreCommit: gateCommands.length === 0 ? 'skipped' : (localGatesPassed ? 'pass' : 'fail'),
      gateCi: 'skipped',
    },
    riskRemaining: 'Remote CI, review, and publication remain required.',
  };
}

async function collectImplementArtifact(artifact, issue, stateRoot, workspacePath, providedPath = null, artifactPath = null) {
  const source = providedPath
    ? path.resolve(providedPath)
    : path.resolve(workspacePath, artifactPath ?? implementArtifactPath({}, issue));
  if (!fs.existsSync(source)) {
    throw new Error(`worker did not emit an ImplementArtifact at ${source}`);
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(source, 'utf8'));
  } catch (error) {
    throw new Error(`worker ImplementArtifact is not valid JSON: ${error.message}`);
  }
  const errors = validateImplementArtifact(value);
  if (errors.length) throw new Error(`worker ImplementArtifact is invalid: ${errors.join('; ')}`);
  const gateCommands = issue.qualityGateResults.map((gate) => gate.command.join(' '));
  const normalized = normalizeImplementArtifact(value, issue, {
    runId: artifact.runId,
    gateCommands,
    localGatesPassed: issue.qualityGateResults.every((gate) => gate.code === 0),
  });
  const issueDir = path.join(runDirectory(stateRoot, artifact.runId), 'issues', safePathSegment(issue.id));
  await fsp.mkdir(issueDir, { recursive: true });
  const target = path.join(issueDir, 'implement.json');
  await fsp.writeFile(target, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
  issue.implementArtifactPath = target;
  issue.implementArtifactSourcePath = source;
  artifact.implementArtifacts.push({
    issueId: issue.id,
    path: target,
    sourcePath: source,
    branch: issue.branch,
    commitSha: issue.commitSha,
  });
  return target;
}

async function cleanupResource(resource, context, config, env) {
  if (!resource?.ownershipToken) throw new Error('Refusing cleanup without an ownership token.');
  if (resource.status === 'cleaned') return;
  if (resource.type === 'vm-pool' && config.type !== 'vm-pool') {
    throw new Error('vm-pool resources require the matching provider configuration for cleanup');
  }
  if (resource.type === 'local-worktree') {
    const root = await providerRoot(config, context.artifact.policy.timeoutMs);
    if (resource.workspacePath && fs.existsSync(resource.workspacePath)) {
      await git(['worktree', 'remove', '--force', resource.workspacePath], root, context.artifact.policy.timeoutMs);
    }
  } else {
    await runConfiguredCommand('cleanup', { ...context, resource, workspacePath: resource.workspacePath }, config, env);
  }
  resource.status = 'cleaned';
  resource.cleanedAt = now();
  context.artifact.cleanup.cleanedResourceIds.push(resource.id);
}

async function processIssue(artifact, issue, config, stateRoot, checkpoint) {
  if (issue.status === 'validated') return issue;
  const workerBaseDir = config.repo ?? config.cwd ?? REPO_ROOT;
  const workerRuntime = artifact.provider.type === 'local-worktree' && !config.executeCommand && config.worker
    ? resolveWorkerProfile(config.worker, { baseDir: workerBaseDir })
    : null;
  if (workerRuntime) {
    artifact.provider.worker = workerSummary({
      name: workerRuntime.profile.name,
      profile: workerRuntime.profilePath ?? undefined,
      model: workerRuntime.profile.model,
    });
  }
  const workerEnvNames = [
    ...(workerRuntime?.profile.env ?? []),
    ...(workerRuntime?.profile.requiredEnv ?? []),
  ];
  const requiredSecretNames = [...new Set([
    ...artifact.policy.secretEnvNames,
    ...(workerRuntime?.profile.requiredEnv ?? []),
  ])];
  const envSecrets = secretEnvironment(requiredSecretNames);
  const secretValues = secretValueList([...new Set([
    ...requiredSecretNames,
    ...workerEnvNames,
  ])]);
  const runDir = runDirectory(stateRoot, artifact.runId);
  const artifactPath = implementArtifactPath(config, issue);
  const workerModel = workerRuntime?.profile.model
    ?? (typeof config.worker === 'object' ? config.worker?.model ?? '' : '');
  const configuredWorkerProfile = typeof config.worker === 'string'
    ? config.worker
    : config.worker?.profile ?? '';
  let claim = null;
  const env = {
    ...process.env,
    ...envSecrets,
    FLEET_RUN_ID: artifact.runId,
    FLEET_ISSUE_ID: issue.id,
    FLEET_ISSUE_TITLE: issue.title ?? '',
    FLEET_ISSUE_URL: issue.url ?? '',
    FLEET_ISSUE_BODY: issue.body ?? '',
    FLEET_BASE_REVISION: artifact.source.baseRevision,
    FLEET_IMPLEMENT_ARTIFACT: artifactPath,
    FLEET_MODEL: workerModel,
    FLEET_WORKER_PROFILE: workerRuntime?.profilePath ?? configuredWorkerProfile,
    FLEET_PROMPT_FILE: '',
  };
  const context = { artifact, issue, runDir, artifactPath, workspacePath: null, resource: null };
  let resource = issue.resourceIds
    .map((id) => artifact.resources.find((entry) => entry.id === id))
    .filter(Boolean)
    .find((entry) => entry.status !== 'cleaned');
  let reconciliationBlocked = false;
  let skipExecution = issue.executionState === 'completed';
  let workerArtifactPath = null;
  issue.attempt += 1;
  issue.status = 'provisioning';
  event(artifact, 'fleet.issue-provisioning', { issueId: issue.id, wave: issue.wave, attempt: issue.attempt });
  await checkpoint();
  try {
    claim = acquireIssueClaim(stateRoot, artifact.runId, issue.id);
    if (issue.executionState === 'pending' && artifact.provider.type === 'local-worktree') {
      throw Object.assign(new Error('local agent outcome is unknown after interruption; use reconcile before resume'), { blocked: true });
    }

    if (!resource) {
      const intent = {
        id: `pending:${issue.id}:${issue.attempt}`,
        type: artifact.provider.type,
        ownershipToken: crypto.randomUUID(),
        workspacePath: null,
        branch: issue.branch ?? `fleet/${safePathSegment(artifact.runId)}/${safePathSegment(issue.id)}-${slug(issue.title)}`,
        status: 'provisioning',
        createdAt: now(),
      };
      resource = intent;
      context.resource = intent;
      issue.resourceIds.push(intent.id);
      artifact.resources.push(intent);
      event(artifact, 'fleet.resource-intent-recorded', { issueId: issue.id, resourceId: intent.id });
      await checkpoint();
      const provisioned = artifact.provider.type === 'local-worktree'
        ? await provisionLocal(context, config, env, intent)
        : await provisionVm(context, config, env, intent);
      const oldId = intent.id;
      Object.assign(intent, provisioned);
      issue.resourceIds = issue.resourceIds.map((id) => id === oldId ? intent.id : id);
    } else if (resource.status === 'provisioning') {
      context.resource = resource;
      if (artifact.provider.type === 'local-worktree') {
        const oldId = resource.id;
        Object.assign(resource, await provisionLocal(context, config, env, resource));
        issue.resourceIds = issue.resourceIds.map((id) => id === oldId ? resource.id : id);
      } else {
        const status = await runConfiguredCommand('status', context, config, env);
        const state = String(status.output.state ?? 'unknown');
        if (state === 'absent') {
          const oldId = resource.id;
          Object.assign(resource, await provisionVm(context, config, env, resource));
          issue.resourceIds = issue.resourceIds.map((id) => id === oldId ? resource.id : id);
        } else if (['ready', 'running', 'completed'].includes(state) && status.output.resourceId) {
          const oldId = resource.id;
          Object.assign(resource, {
            id: String(status.output.resourceId),
            workspacePath: status.output.workspacePath ?? resource.workspacePath,
            branch: status.output.branch ?? resource.branch,
            status: 'ready',
          });
          issue.resourceIds = issue.resourceIds.map((id) => id === oldId ? resource.id : id);
          if (state === 'completed') {
            issue.executionState = 'completed';
            skipExecution = true;
          } else if (state === 'running') {
            throw Object.assign(new Error('remote agent is still running; retry resume after provider status changes'), { blocked: true });
          }
        } else {
          throw Object.assign(new Error(`provider could not reconcile provisioning intent (${state})`), { blocked: true });
        }
      }
    } else if (issue.executionState === 'pending' && artifact.provider.type === 'vm-pool') {
      context.resource = resource;
      const status = await runConfiguredCommand('status', context, config, env);
      const state = String(status.output.state ?? 'unknown');
      if (state === 'completed') {
        issue.executionState = 'completed';
        skipExecution = true;
      } else if (state === 'running') {
        throw Object.assign(new Error('remote agent is still running; retry resume after provider status changes'), { blocked: true });
      } else {
        throw Object.assign(new Error(`remote agent outcome is ${state}; reconcile the provider before resume`), { blocked: true });
      }
    }

    context.resource = resource;
    context.workspacePath = resource.workspacePath;
    issue.branch = resource.branch;
    issue.status = 'bootstrapping';
    event(artifact, 'fleet.issue-bootstrapping', { issueId: issue.id, resourceId: resource.id });
    await checkpoint();

    if (artifact.provider.type === 'local-worktree') {
      const bootstrap = config.bootstrapCommands ?? detectBootstrapCommands(resource.workspacePath);
      const bootstrapResults = await runCommands(bootstrap, { cwd: resource.workspacePath, env, timeoutMs: artifact.policy.timeoutMs });
      const failed = bootstrapResults.find((entry) => entry.code !== 0);
      if (failed) throw new Error(`bootstrap failed: ${failed.stderr.trim() || `exit ${failed.code}`}`);
      issue.bootstrapResults = bootstrapResults.map((result) => commandSummary(result, secretValues));
      if (!skipExecution) {
        issue.status = 'running';
        issue.executionState = 'pending';
        event(artifact, 'fleet.issue-running', { issueId: issue.id, resourceId: resource.id });
        await checkpoint();
        const prompt = workerPrompt(issue, artifact, resource.workspacePath, artifactPath);
        let executeSpec;
        if (config.executeCommand) {
          if (!Array.isArray(config.executeCommand) || config.executeCommand.length === 0) {
            throw new Error('provider.executeCommand must be a non-empty argv array');
          }
          executeSpec = config.executeCommand.map((part) => String(part)
            .replace(/\{\{prompt}}/g, prompt)
            .replace(/\{\{model}}/g, workerModel)
            .replace(/\{\{artifact}}/g, artifactPath));
        } else if (workerRuntime) {
          let profilePath = workerRuntime.profilePath;
          if (!profilePath) {
            profilePath = path.join(runDir, 'issues', safePathSegment(issue.id), 'worker-profile.json');
            await fsp.mkdir(path.dirname(profilePath), { recursive: true });
            await fsp.writeFile(profilePath, `${JSON.stringify(workerRuntime.profile, null, 2)}\n`, { mode: 0o600 });
          }
          const promptFile = path.join(runDir, 'issues', safePathSegment(issue.id), 'prompt.txt');
          await fsp.mkdir(path.dirname(promptFile), { recursive: true });
          await fsp.writeFile(promptFile, `${prompt}\n`, { mode: 0o600 });
          env.FLEET_PROMPT_FILE = promptFile;
          env.FLEET_WORKER_PROFILE = profilePath;
          const runnerArgs = [
            WORKER_RUNNER,
            '--profile', profilePath,
            '--workspace', resource.workspacePath,
            '--prompt-file', promptFile,
            '--artifact', artifactPath,
            '--run-id', artifact.runId,
            '--issue-id', issue.id,
            '--issue-title', issue.title ?? '',
            '--issue-url', issue.url ?? '',
            '--base-revision', artifact.source.baseRevision,
            '--timeout-ms', String(artifact.policy.timeoutMs),
          ];
          if (workerModel) runnerArgs.push('--model', workerModel);
          executeSpec = [process.execPath, ...runnerArgs];
        } else {
          throw new Error('No local worker configured: set provider.worker.profile (recommended) or provider.executeCommand.');
        }
        const execution = await runCommand(executeSpec[0], executeSpec.slice(1), { cwd: resource.workspacePath, env, timeoutMs: artifact.policy.timeoutMs });
        issue.execution = commandSummary(execution, secretValues);
        if (execution.timedOut) throw Object.assign(new Error('agent execution timed out'), { timedOut: true });
        if (execution.code !== 0) throw new Error(`agent execution failed: ${execution.stderr.trim() || `exit ${execution.code}`}`);
        issue.executionState = 'completed';
        await checkpoint();
      }
      issue.status = 'validating';
      const quality = config.qualityCommands ?? defaultQualityCommands(resource.workspacePath);
      const qualityResults = await runCommands(quality, { cwd: resource.workspacePath, env, timeoutMs: artifact.policy.timeoutMs });
      issue.qualityGateResults = qualityResults.map((result) => commandSummary(result, secretValues));
      const failedGate = qualityResults.find((entry) => entry.code !== 0);
      if (failedGate) throw new Error(`quality gate failed: ${failedGate.stderr.trim() || `exit ${failedGate.code}`}`);
      const status = await runCommand('git', ['status', '--porcelain'], { cwd: resource.workspacePath, timeoutMs: artifact.policy.timeoutMs });
      if (status.code !== 0) throw new Error(`git status failed: ${status.stderr.trim() || `exit ${status.code}`}`);
      if (status.stdout.trim()) {
        await git(['add', '-A'], resource.workspacePath, artifact.policy.timeoutMs);
        await git([
          '-c', 'user.name=fleet-worker',
          '-c', 'user.email=fleet-worker@users.noreply.github.com',
          'commit', '-m', `chore(fleet): record validation for issue ${issue.id}`,
        ], resource.workspacePath, artifact.policy.timeoutMs);
      }
      issue.commitSha = await git(['rev-parse', 'HEAD'], resource.workspacePath, artifact.policy.timeoutMs);
    } else {
      await runConfiguredCommand('bootstrap', context, config, env);
      if (!skipExecution) {
        issue.status = 'running';
        issue.executionState = 'pending';
        event(artifact, 'fleet.issue-running', { issueId: issue.id, resourceId: resource.id });
        await checkpoint();
        const execution = await runConfiguredCommand('execute', context, config, env);
        issue.execution = commandSummary(execution.result, secretValues);
        issue.executionState = 'completed';
        await checkpoint();
      }
      issue.status = 'validating';
      const validation = await runConfiguredCommand('validate', context, config, env);
      issue.qualityGateResults = [commandSummary(validation.result, secretValues)];
      const collected = await runConfiguredCommand('collect', context, config, env);
      if (!collected.output.branch || !collected.output.commitSha) {
        throw new Error('vm-pool collect command must emit JSON with branch and commitSha.');
      }
      issue.branch = String(collected.output.branch);
      issue.commitSha = String(collected.output.commitSha);
      if (!collected.output.implementArtifactPath) {
        throw new Error('vm-pool collect command must emit implementArtifactPath so the worker artifact can be verified.');
      }
      workerArtifactPath = String(collected.output.implementArtifactPath);
    }
    await collectImplementArtifact(artifact, issue, stateRoot, resource?.workspacePath, workerArtifactPath, artifactPath);
    issue.status = 'validated';
    event(artifact, 'fleet.issue-validated', { issueId: issue.id, branch: issue.branch, commitSha: issue.commitSha });
  } catch (error) {
    reconciliationBlocked = Boolean(error.blocked);
    issue.status = error.blocked ? 'blocked' : (error.timedOut ? 'timed-out' : 'failed');
    if (!error.blocked && !error.timedOut) issue.executionState = 'not-started';
    issue.error = redactSecrets(error.message, secretValues);
    event(artifact, 'fleet.issue-failed', { issueId: issue.id, status: issue.status, error: issue.error });
  } finally {
    const shouldCleanup = !reconciliationBlocked && (artifact.policy.cleanup === 'always' || (artifact.policy.cleanup === 'on-failure' && issue.status !== 'validated'));
    if (resource && shouldCleanup) {
      try {
        await cleanupResource(resource, context, config, env);
      } catch (error) {
        const detail = redactSecrets(error.message, secretValues);
        artifact.cleanup.errors.push({ resourceId: resource.id, error: detail });
        event(artifact, 'fleet.cleanup-failed', { resourceId: resource.id, error: detail });
      }
    }
    if (claim) releaseIssueClaim(stateRoot, artifact.runId, issue.id);
    await checkpoint();
  }
  return issue;
}

async function integrateWave(artifact, wave, config, stateRoot) {
  const root = await providerRoot(config, artifact.policy.timeoutMs);
  const branch = artifact.integration.branch;
  const integrationRoot = config.workspaceRoot
    ? path.resolve(config.workspaceRoot)
    : path.join(path.dirname(root), `${path.basename(root)}-fleet-worktrees`, safePathSegment(artifact.runId));
  const workspace = path.join(integrationRoot, 'integration');
  await fsp.mkdir(integrationRoot, { recursive: true });
  if (!fs.existsSync(workspace)) {
    const exists = await runCommand('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root, timeoutMs: artifact.policy.timeoutMs });
    const args = exists.code === 0
      ? ['worktree', 'add', workspace, branch]
      : ['worktree', 'add', '-b', branch, workspace, artifact.source.baseRevision];
    await git(args, root, artifact.policy.timeoutMs);
  }
  try {
    for (const issueId of wave.issueIds) {
      const issue = artifact.issues.find((entry) => entry.id === issueId);
      const mergeRef = await validatedBranchRef(issue.branch, workspace, artifact.policy.timeoutMs);
      const merge = await runCommand('git', ['merge', '--no-ff', '--no-edit', mergeRef], { cwd: workspace, timeoutMs: artifact.policy.timeoutMs });
      if (merge.code !== 0) {
        await runCommand('git', ['merge', '--abort'], { cwd: workspace, timeoutMs: artifact.policy.timeoutMs });
        artifact.integration.conflicts.push({ wave: wave.level, issueId, branch: issue.branch, stderr: redactSecrets(merge.stderr.slice(-2000), secretValueList(artifact.policy.secretEnvNames)) });
        throw new Error(`integration conflict for issue ${issueId}`);
      }
      artifact.integration.commits.push({ wave: wave.level, issueId, branch: issue.branch, commitSha: issue.commitSha });
    }
    const gates = config.qualityCommands ?? defaultQualityCommands(workspace);
    const results = await runCommands(gates, { cwd: workspace, env: process.env, timeoutMs: artifact.policy.timeoutMs });
    const failed = results.find((entry) => entry.code !== 0);
    if (failed) throw new Error(`integration quality gate failed: ${failed.stderr.trim() || `exit ${failed.code}`}`);
    artifact.source.baseRevision = await git(['rev-parse', 'HEAD'], workspace, artifact.policy.timeoutMs);
  } finally {
    if (fs.existsSync(workspace)) await git(['worktree', 'remove', '--force', workspace], root, artifact.policy.timeoutMs).catch(() => {});
  }
}

async function executeCurrentWave(artifact, config, stateRoot) {
  if (artifact.status === 'awaiting-land') throw new Error('Confirm the current wave as landed before resuming.');
  if (!artifact.waves.length) {
    artifact.status = 'completed';
    artifact.nextConsumer = 'publish-open-pr';
    artifact.riskRemaining = 'The ticket DAG contained no issues.';
    artifact.telemetry.finishedAt = now();
    artifact.cleanup.status = 'completed';
    event(artifact, 'fleet.completed', { branches: [] });
    await saveArtifact(artifact, stateRoot);
    return artifact;
  }
  if (artifact.currentWave >= artifact.waves.length) return artifact;
  const wave = artifact.waves[artifact.currentWave];
  const issues = wave.issueIds.map((id) => artifact.issues.find((issue) => issue.id === id));
  wave.status = 'running';
  artifact.status = 'running';
  artifact.telemetry.startedAt ??= now();
  event(artifact, 'fleet.wave-started', { wave: wave.level, issueIds: [...wave.issueIds] });
  let checkpointChain = Promise.resolve();
  const checkpoint = () => {
    checkpointChain = checkpointChain.then(() => saveArtifact(artifact, stateRoot));
    return checkpointChain;
  };
  await checkpoint();
  await runWithConcurrency(issues, artifact.policy.concurrency, (issue) => processIssue(artifact, issue, config, stateRoot, checkpoint));
  await checkpointChain;
  if (issues.some((issue) => issue.status !== 'validated')) {
    wave.status = 'blocked';
    artifact.status = 'blocked';
    artifact.nextConsumer = 'user';
    artifact.riskRemaining = 'At least one issue failed, timed out, or could not be cleaned.';
    event(artifact, 'fleet.wave-blocked', { wave: wave.level });
    await saveArtifact(artifact, stateRoot);
    return artifact;
  }
  wave.status = 'validated';
  event(artifact, 'fleet.wave-validated', { wave: wave.level });
  const lastWave = artifact.currentWave === artifact.waves.length - 1;
  if (artifact.policy.integrationStrategy === 'integration-branch') {
    try {
      await integrateWave(artifact, wave, config, stateRoot);
      wave.status = 'integrated';
      artifact.currentWave += 1;
      artifact.status = lastWave ? 'completed' : 'planned';
    } catch (error) {
      artifact.status = 'blocked';
      artifact.riskRemaining = error.message;
      event(artifact, 'fleet.integration-blocked', { wave: wave.level, error: error.message });
    }
  } else if (lastWave) {
    artifact.status = 'completed';
    artifact.currentWave += 1;
  } else {
    artifact.status = 'awaiting-land';
  }
  if (artifact.status === 'completed') {
    artifact.telemetry.finishedAt = now();
    artifact.nextConsumer = 'publish-open-pr';
    artifact.riskRemaining = 'Remote CI, review, and publication remain outside fleet authority.';
    artifact.cleanup.status = artifact.cleanup.errors.length ? 'partial' : 'completed';
    event(artifact, 'fleet.completed', { branches: artifact.implementArtifacts.map((entry) => entry.branch) });
  } else if (artifact.status === 'awaiting-land') {
    artifact.nextConsumer = 'publish-open-pr';
    artifact.riskRemaining = 'The validated wave must pass publication, review, and shipping before dependent issues start.';
    event(artifact, 'fleet.awaiting-land', { wave: wave.level });
  }
  await saveArtifact(artifact, stateRoot);
  return artifact;
}

async function cleanupFleet(artifact, config, stateRoot) {
  artifact.status = 'cleaning';
  artifact.cleanup.status = 'running';
  for (const resource of artifact.resources.filter((entry) => entry.status !== 'cleaned')) {
    const issue = artifact.issues.find((entry) => entry.resourceIds.includes(resource.id));
    const context = {
      artifact,
      issue,
      runDir: runDirectory(stateRoot, artifact.runId),
      resource,
      workspacePath: resource.workspacePath,
      artifactPath: issue ? implementArtifactPath(config, issue) : '',
    };
    try {
      await cleanupResource(resource, context, config, secretEnvironment(artifact.policy.secretEnvNames));
    } catch (error) {
      artifact.cleanup.errors.push({ resourceId: resource.id, error: error.message });
    }
  }
  artifact.cleanup.status = artifact.cleanup.errors.length ? 'partial' : 'completed';
  artifact.status = artifact.cleanup.errors.length ? 'blocked' : 'cleaned';
  event(artifact, 'fleet.cleanup-completed', { status: artifact.cleanup.status });
  await saveArtifact(artifact, stateRoot);
  return artifact;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, secretEnvNames: [], landedIssueIds: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === 'dry-run') options.dryRun = true;
    else if (key === 'help') options.help = true;
    else {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      index += 1;
      if (key === 'secret-env') options.secretEnvNames.push(value);
      else if (key === 'issues') options.landedIssueIds.push(...value.split(',').filter(Boolean));
      else options[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
  }
  return options;
}

function help() {
  return `parallel-issue-fleet controller

Commands:
  start --tickets <artifact.json> --base <branch> [--provider <config.json>] [--run-id <id>]
        [--concurrency <n>] [--timeout-ms <ms>] [--strategy land-by-wave|integration-branch]
        [--secret-env <NAME> ...] [--state-root <dir>] [--dry-run]
  resume --run-id <id> [--provider <config.json>] [--state-root <dir>]
  confirm-landed --run-id <id> --issues <id,id> --base-revision <sha> [--state-root <dir>]
  reconcile --run-id <id> --issue <id> --execution completed|failed [--state-root <dir>]
  status --run-id <id> [--state-root <dir>]
  cleanup --run-id <id> [--provider <config.json>] [--state-root <dir>]

Provider command specs are argument arrays, never shell strings. Secret values are read from the named
environment variables at execution time and are never persisted.`;
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(path.resolve(file), 'utf8'));
}

async function resolveRevision(base, config) {
  return git(['rev-parse', base], await providerRoot(config, 30_000), 30_000);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help || !options.command) {
    console.log(help());
    return 0;
  }
  const stateRoot = path.resolve(options.stateRoot ?? DEFAULT_STATE_ROOT);
  let artifact;
  let config = options.provider ? await readJson(options.provider) : { type: 'local-worktree' };
  config.type ??= 'local-worktree';

  if (options.command === 'start') {
    if (!options.tickets || !options.base) throw new Error('start requires --tickets and --base');
    const payload = await readJson(options.tickets);
    const baseRevision = await resolveRevision(options.base, config);
    artifact = buildFleetPlan(payload, {
      runId: options.runId,
      ticketArtifactPath: path.resolve(options.tickets),
      base: options.base,
      baseRevision,
      provider: config,
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      integrationStrategy: options.strategy,
      cleanup: options.cleanup,
      secretEnvNames: options.secretEnvNames,
    });
    await saveArtifact(artifact, stateRoot);
    if (!options.dryRun) artifact = await executeCurrentWave(artifact, config, stateRoot);
  } else {
    if (!options.runId) throw new Error(`${options.command} requires --run-id`);
    artifact = await loadArtifact(stateRoot, options.runId);
    if (options.command === 'resume') artifact = await executeCurrentWave(artifact, config, stateRoot);
    else if (options.command === 'confirm-landed') {
      const repoPath = await providerRoot(config, 30_000);
      await verifyWaveAncestry(artifact, options.landedIssueIds, options.baseRevision, repoPath, 30_000);
      artifact = advanceAfterLanding(artifact, options.landedIssueIds, options.baseRevision);
      await saveArtifact(artifact, stateRoot);
    } else if (options.command === 'reconcile') {
      const issue = artifact.issues.find((entry) => entry.id === String(options.issue));
      if (!issue) throw new Error(`Unknown issue: ${options.issue}`);
      if (!['completed', 'failed'].includes(options.execution)) throw new Error('reconcile requires --execution completed|failed');
      issue.executionState = options.execution === 'completed' ? 'completed' : 'not-started';
      issue.status = options.execution === 'completed' ? 'validating' : 'pending';
      issue.error = null;
      artifact.status = 'planned';
      event(artifact, 'fleet.execution-reconciled', { issueId: issue.id, outcome: options.execution });
      await saveArtifact(artifact, stateRoot);
    } else if (options.command === 'cleanup') {
      artifact = await cleanupFleet(artifact, config, stateRoot);
    } else if (options.command !== 'status') throw new Error(`Unknown command: ${options.command}`);
  }
  console.log(JSON.stringify({ ok: true, artifactPath: artifactFile(stateRoot, artifact.runId), artifact }, null, 2));
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exit(1);
    },
  );
}
