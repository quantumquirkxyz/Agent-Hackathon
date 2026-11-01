import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  acquireIssueClaim,
  advanceAfterLanding,
  buildFleetPlan,
  detectBootstrapCommands,
  implementArtifactPath,
  releaseIssueClaim,
  ticketBody,
  ticketNumber,
  verifyWaveAncestry,
  redactEnvironment,
  normalizeImplementArtifact,
  redactSecrets,
  runCommand,
  runWithConcurrency,
  validateFleetArtifact,
  validateImplementArtifact,
} from '../../routing/parallel-issue-fleet/scripts/fleet-controller.mjs';
import {
  buildDispatchInputs,
  buildPrompt,
  collectArtifactPath,
  mapRunState,
  parseRunId,
  validateCollectedArtifact,
  validateFleetBranch,
  validateWorkerProfilePath,
} from '../../routing/parallel-issue-fleet/scripts/github-actions-provider.mjs';

const tickets = {
  schemaVersion: '2.0',
  artifactType: 'ticket',
  output: [
    { id: 11, title: 'first slice', blockedBy: [] },
    { id: 12, title: 'parallel slice', blockedBy: [] },
    { id: 13, title: 'dependent slice', blockedBy: [11, 12] },
  ],
};

test('buildFleetPlan converts a TicketArtifact into topological waves', () => {
  const artifact = buildFleetPlan(tickets, {
    runId: 'fleet-test',
    base: 'main',
    baseRevision: 'abc123',
    provider: { type: 'local-worktree' },
    concurrency: 2,
    timeoutMs: 1000,
  });

  assert.equal(artifact.artifactType, 'fleet-run');
  assert.deepEqual(artifact.waves.map((wave) => wave.issueIds), [['11', '12'], ['13']]);
  assert.equal(artifact.policy.integrationStrategy, 'land-by-wave');
  assert.equal(artifact.status, 'planned');
  assert.ok(artifact.issues.every((issue) => issue.executionState === 'not-started'));
  assert.deepEqual(validateFleetArtifact(artifact), []);
});

test('canonical TicketArtifact fields become a worker body and tracker identity', () => {
  const artifact = buildFleetPlan({
    output: [{
      title: 'Add search',
      description: 'Expose GET /search.',
      acceptanceCriteria: ['Returns 200 with results', 'Rejects empty query with 400'],
      validation: 'curl /search?q=term',
      blockedBy: [],
    }],
  }, {
    runId: 'fleet-body', base: 'main', baseRevision: 'abc123', provider: { type: 'local-worktree' },
  });

  const [issue] = artifact.issues;
  assert.match(issue.body, /## Description/);
  assert.match(issue.body, /Expose GET \/search/);
  assert.match(issue.body, /- Returns 200 with results/);
  assert.match(issue.body, /## Validation/);
  assert.equal(issue.number, null);
  assert.equal(issue.url, null);
});

test('explicit body, tracker number, and URL take precedence over derived fields', () => {
  assert.equal(ticketBody({ body: 'already complete', description: 'ignored' }), 'already complete');
  assert.equal(ticketNumber({ number: '42' }), 42);
  assert.equal(ticketNumber({ issueNumber: 7 }), 7);
  assert.equal(ticketNumber({}), null);
  assert.equal(ticketNumber({ number: 'not-a-number' }), null);

  const artifact = buildFleetPlan({
    output: [{ title: 'slice', description: 'd', acceptanceCriteria: [], validation: 'v', blockedBy: [], number: 42, url: 'https://example.test/issues/42' }],
  }, {
    runId: 'fleet-identity', base: 'main', baseRevision: 'abc123', provider: { type: 'local-worktree' },
  });
  assert.equal(artifact.issues[0].number, 42);
  assert.equal(artifact.issues[0].url, 'https://example.test/issues/42');
});

test('issue claims fence concurrent fleet runs and expire', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-fleet-claims-'));

  assert.equal(acquireIssueClaim(dir, 'run-a', '11', 60_000, 1_000_000).reused, false);
  assert.equal(acquireIssueClaim(dir, 'run-a', '11', 60_000, 1_000_000).reused, true);
  assert.throws(
    () => acquireIssueClaim(dir, 'run-b', '11', 60_000, 1_000_000),
    /claimed by run run-a/,
  );
  assert.equal(releaseIssueClaim(dir, 'run-b', '11'), false);
  assert.equal(releaseIssueClaim(dir, 'run-a', '11'), true);
  assert.equal(acquireIssueClaim(dir, 'run-b', '11', 60_000, 1_000_000).acquired, true);

  const expired = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-fleet-claims-expired-'));
  acquireIssueClaim(expired, 'run-a', '12', 1, 1_000);
  assert.equal(acquireIssueClaim(expired, 'run-b', '12', 60_000, 5_000).acquired, true);
});

function gitIn(dir, ...args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('confirm-landed verification requires each issue commit to be an ancestor of the new base', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-fleet-ancestry-'));
  gitIn(dir, 'init', '-q');
  gitIn(dir, 'config', 'user.email', 'test@example.test');
  gitIn(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base');
  gitIn(dir, 'add', '.');
  gitIn(dir, 'commit', '-qm', 'base');
  const base = gitIn(dir, 'rev-parse', 'HEAD');
  const baseBranch = gitIn(dir, 'branch', '--show-current');

  gitIn(dir, 'checkout', '-qb', 'issue');
  fs.writeFileSync(path.join(dir, 'issue.txt'), 'issue');
  gitIn(dir, 'add', '.');
  gitIn(dir, 'commit', '-qm', 'issue');
  const issueSha = gitIn(dir, 'rev-parse', 'HEAD');
  gitIn(dir, 'checkout', '-q', baseBranch);
  gitIn(dir, 'merge', '--no-ff', '--no-edit', 'issue');
  const merged = gitIn(dir, 'rev-parse', 'HEAD');

  const artifact = buildFleetPlan({ output: [{ id: 11, title: 'slice', blockedBy: [] }] }, {
    runId: 'fleet-ancestry', base: 'main', baseRevision: base, provider: { type: 'local-worktree' },
  });
  artifact.status = 'awaiting-land';
  artifact.waves[0].status = 'validated';
  artifact.issues[0].status = 'validated';
  artifact.issues[0].commitSha = issueSha;

  assert.equal(await verifyWaveAncestry(artifact, ['11'], merged, dir, 5_000), true);
  await assert.rejects(
    () => verifyWaveAncestry(artifact, ['11'], base, dir, 5_000),
    /not an ancestor/,
  );

  gitIn(dir, 'checkout', '-qb', 'side', base);
  fs.writeFileSync(path.join(dir, 'side.txt'), 'side');
  gitIn(dir, 'add', '.');
  gitIn(dir, 'commit', '-qm', 'side');
  const sideSha = gitIn(dir, 'rev-parse', 'HEAD');
  gitIn(dir, 'checkout', '-q', baseBranch);
  artifact.issues[0].commitSha = sideSha;
  await assert.rejects(
    () => verifyWaveAncestry(artifact, ['11'], merged, dir, 5_000),
    /not an ancestor/,
  );

  artifact.issues[0].commitSha = null;
  await assert.rejects(
    () => verifyWaveAncestry(artifact, ['11'], merged, dir, 5_000),
    /no commitSha/,
  );
});

test('bootstrap detection uses project lockfiles and build scripts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-fleet-bootstrap-'));
  fs.writeFileSync(path.join(dir, 'bun.lock'), '');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { build: 'node build.mjs' } }));

  assert.deepEqual(detectBootstrapCommands(dir), [
    ['bun', 'install', '--frozen-lockfile'],
    ['bun', 'run', 'build'],
  ]);
});

test('redactEnvironment exposes names but never secret values', () => {
  const redacted = redactEnvironment({ TOKEN: 'super-secret', REGION: 'eu' }, ['TOKEN']);
  assert.deepEqual(redacted, { TOKEN: '[REDACTED]', REGION: 'eu' });
  assert.doesNotMatch(JSON.stringify(redacted), /super-secret/);
});

test('runWithConcurrency never exceeds the configured limit', async () => {
  let active = 0;
  let peak = 0;
  const results = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return value * 2;
  });

  assert.equal(peak, 2);
  assert.deepEqual(results, [2, 4, 6, 8, 10]);
});

test('land-by-wave requires explicit landing before advancing', () => {
  const artifact = buildFleetPlan(tickets, {
    runId: 'fleet-land', base: 'main', baseRevision: 'abc123', provider: { type: 'local-worktree' },
  });
  artifact.status = 'awaiting-land';
  artifact.waves[0].status = 'validated';
  for (const issue of artifact.issues.filter((entry) => entry.wave === 0)) issue.status = 'validated';

  assert.throws(() => advanceAfterLanding(artifact, ['11']), /entire wave/);
  const advanced = advanceAfterLanding(artifact, ['11', '12'], 'def456');
  assert.equal(advanced.status, 'planned');
  assert.equal(advanced.currentWave, 1);
  assert.equal(advanced.waves[0].status, 'landed');
  assert.equal(advanced.source.baseRevision, 'def456');
});

test('runCommand terminates commands that exceed their timeout', async () => {
  const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
    timeoutMs: 20,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
});

test('artifact validation rejects persisted secret values and malformed resources', () => {
  const artifact = buildFleetPlan(tickets, {
    runId: 'fleet-invalid', base: 'main', baseRevision: 'abc123', provider: { type: 'local-worktree' },
  });
  artifact.secretValues = { TOKEN: 'must-not-persist' };
  artifact.resources.push({ id: 'vm-1' });
  const errors = validateFleetArtifact(artifact);
  assert.ok(errors.some((error) => error.includes('secretValues')));
  assert.ok(errors.some((error) => error.includes('ownershipToken')));
});

test('CLI dry-run persists a resumable plan without creating resources', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-fleet-cli-'));
  const ticketFile = path.join(dir, 'tickets.json');
  const stateRoot = path.join(dir, 'state');
  fs.writeFileSync(ticketFile, JSON.stringify(tickets));
  const script = '.agents/skills/routing/parallel-issue-fleet/scripts/fleet-controller.mjs';
  const result = spawnSync(process.execPath, [
    script, 'start', '--tickets', ticketFile, '--base', 'HEAD', '--run-id', 'dry-run',
    '--state-root', stateRoot, '--dry-run',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.artifact.status, 'planned');
  assert.deepEqual(output.artifact.resources, []);
  assert.ok(fs.existsSync(path.join(stateRoot, 'dry-run', 'fleet-run.json')));
});

test('CLI reconcile resolves an interrupted execution without rerunning it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-fleet-reconcile-'));
  const ticketFile = path.join(dir, 'tickets.json');
  const stateRoot = path.join(dir, 'state');
  fs.writeFileSync(ticketFile, JSON.stringify(tickets));
  const script = '.agents/skills/routing/parallel-issue-fleet/scripts/fleet-controller.mjs';
  const started = spawnSync(process.execPath, [
    script, 'start', '--tickets', ticketFile, '--base', 'HEAD', '--run-id', 'reconcile',
    '--state-root', stateRoot, '--dry-run',
  ], { encoding: 'utf8' });
  assert.equal(started.status, 0, started.stderr);

  const artifactPath = path.join(stateRoot, 'reconcile', 'fleet-run.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  artifact.issues[0].executionState = 'pending';
  artifact.issues[0].status = 'running';
  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));

  const result = spawnSync(process.execPath, [
    script, 'reconcile', '--run-id', 'reconcile', '--issue', '11',
    '--execution', 'completed', '--state-root', stateRoot,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.artifact.issues[0].executionState, 'completed');
  assert.equal(output.artifact.issues[0].status, 'validating');
  assert.ok(output.artifact.events.some((entry) => entry.type === 'fleet.execution-reconciled'));
});


test('redactSecrets removes every occurrence of an ephemeral secret value', () => {
  const text = 'token=abc123456 rejected token=abc123456';
  assert.equal(redactSecrets(text, ['abc123456']), 'token=[REDACTED] rejected token=[REDACTED]');
});

test('worker ImplementArtifact validation refuses invented gate and acceptance claims', () => {
  const base = {
    status: 'completed',
    validation: { acceptanceCriteriaMet: true, commands: [] },
    qualityGateResults: { gateIde: 'pass', gatePreCommit: 'pass', gateCi: 'pass' },
  };
  assert.deepEqual(validateImplementArtifact(base), []);
  assert.match(validateImplementArtifact({ ...base, validation: { acceptanceCriteriaMet: false } })[0], /acceptanceCriteriaMet/);
  assert.match(validateImplementArtifact({ ...base, status: 'partial' })[0], /completed/);
  assert.match(validateImplementArtifact({ ...base, qualityGateResults: { ...base.qualityGateResults, gateCi: 'maybe' } })[0], /gateCi/);
});

test('normalized artifacts record only the gates the fleet actually ran', () => {
  const normalized = normalizeImplementArtifact({
    status: 'completed',
    validation: { acceptanceCriteriaMet: true, commands: ['worker-check'] },
    qualityGateResults: { gateIde: 'pass', gatePreCommit: 'pass', gateCi: 'pass' },
  }, { commitSha: 'sha1', branch: 'fleet/x', blockedBy: [] }, {
    runId: 'run-1', gateCommands: ['node check.mjs'], localGatesPassed: true,
  });

  assert.equal(normalized.commitSha, 'sha1');
  assert.equal(normalized.branch, 'fleet/x');
  assert.deepEqual(normalized.validation.commands, ['worker-check', 'node check.mjs']);
  assert.deepEqual(normalized.qualityGateResults, { gateIde: 'skipped', gatePreCommit: 'pass', gateCi: 'skipped' });
  assert.match(normalized.riskRemaining, /Remote CI/);
});

function initRepo(root) {
  const run = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  fs.mkdirSync(root, { recursive: true });
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'fleet@example.test']);
  run(['config', 'user.name', 'Fleet Test']);
  fs.writeFileSync(path.join(root, 'README.md'), '# temp\n');
  run(['add', 'README.md']);
  run(['commit', '-m', 'chore: init']);
  return run;
}

const IMPLEMENT_ARTIFACT = {
  status: 'completed',
  changes: ['feature.txt'],
  validation: { acceptanceCriteriaMet: true, commands: ['worker-check'], skipped: [] },
  commitSha: 'worker-placeholder',
  branch: 'worker-placeholder',
  nextConsumer: 'publish-open-pr',
  blockedBy: [],
  qualityGateResults: { gateIde: 'pass', gatePreCommit: 'pass', gateCi: 'pass' },
};

test('local fleet executes and validates one issue end to end, then cleans its worktree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-fleet-e2e-local-'));
  const repo = path.join(root, 'repo');
  initRepo(repo);
  const worker = path.join(root, 'worker.mjs');
  fs.writeFileSync(worker, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { execFileSync } from 'node:child_process';",
    'const cwd = process.cwd();',
    "fs.writeFileSync(path.join(cwd, 'feature.txt'), 'done\\n');",
    "const dir = path.join(cwd, '.agents', 'skills', 'platform', 'artifacts', 'implement');",
    'fs.mkdirSync(dir, { recursive: true });',
    `fs.writeFileSync(path.join(dir, '101.json'), JSON.stringify(${JSON.stringify(IMPLEMENT_ARTIFACT)}, null, 2));`,
    "execFileSync('git', ['add', '-A'], { cwd });",
    "execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=T', 'commit', '-m', 'feat: demo'], { cwd });",
  ].join('\n'));

  const provider = path.join(root, 'provider.json');
  fs.writeFileSync(provider, JSON.stringify({
    type: 'local-worktree',
    repo,
    workspaceRoot: path.join(root, 'worktrees'),
    bootstrapCommands: [],
    qualityCommands: [],
    executeCommand: [process.execPath, worker],
  }));
  const ticketFile = path.join(root, 'tickets.json');
  fs.writeFileSync(ticketFile, JSON.stringify({ output: [{ id: 101, title: 'demo', blockedBy: [] }] }));
  const stateRoot = path.join(root, 'state');
  const script = '.agents/skills/routing/parallel-issue-fleet/scripts/fleet-controller.mjs';

  const result = spawnSync(process.execPath, [
    script, 'start', '--tickets', ticketFile, '--base', 'main',
    '--provider', provider, '--state-root', stateRoot, '--run-id', 'local-e2e',
  ], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  const { artifact } = JSON.parse(result.stdout);
  const issue = artifact.issues[0];

  assert.equal(artifact.status, 'completed');
  assert.equal(issue.status, 'validated');
  assert.equal(artifact.resources[0].status, 'cleaned');
  assert.match(issue.commitSha, /^[0-9a-f]{40}$/);
  assert.ok(fs.existsSync(issue.implementArtifactPath));

  const stored = JSON.parse(fs.readFileSync(issue.implementArtifactPath, 'utf8'));
  assert.deepEqual(stored.qualityGateResults, { gateIde: 'skipped', gatePreCommit: 'skipped', gateCi: 'skipped' });
  assert.equal(stored.commitSha, issue.commitSha, 'fleet evidence overrides the worker placeholder');

  const branch = spawnSync('git', ['rev-parse', '--verify', `refs/heads/${issue.branch}`], { cwd: repo, encoding: 'utf8' });
  assert.equal(branch.status, 0, 'the validated branch survives cleanup');
  assert.ok(!fs.existsSync(path.join(root, 'worktrees', 'issue-101')), 'the worktree is removed');
});

test('local fleet runs a portable worker profile without an agent-specific default', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-fleet-e2e-profile-'));
  const repo = path.join(root, 'repo');
  initRepo(repo);
  const outputDir = path.join(root, 'worker-output');
  const setup = path.join(root, 'setup.mjs');
  fs.writeFileSync(setup, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "fs.mkdirSync(process.env.TEST_OUTPUT_DIR, { recursive: true });",
    "fs.writeFileSync(path.join(process.env.TEST_OUTPUT_DIR, 'setup.txt'), 'ran');",
  ].join('\n'));
  const worker = path.join(root, 'profile-worker.mjs');
  fs.writeFileSync(worker, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { execFileSync } from 'node:child_process';",
    'const cwd = process.cwd();',
    "const out = process.env.TEST_OUTPUT_DIR;",
    "fs.mkdirSync(out, { recursive: true });",
    "const prompt = fs.readFileSync(0, 'utf8');",
    "fs.writeFileSync(path.join(out, 'prompt.txt'), prompt);",
    "fs.writeFileSync(path.join(out, 'model.txt'), process.env.TEST_AGENT_MODEL ?? '');",
    "fs.writeFileSync(path.join(out, 'token.txt'), process.env.TEST_AGENT_TOKEN ?? '');",
    "fs.writeFileSync(path.join(out, 'args.json'), JSON.stringify(process.argv.slice(2)));",
    "fs.writeFileSync(path.join(cwd, 'feature-profile.txt'), 'done\\n');",
    "const artifactPath = path.resolve(cwd, process.env.FLEET_IMPLEMENT_ARTIFACT);",
    "fs.mkdirSync(path.dirname(artifactPath), { recursive: true });",
    `fs.writeFileSync(artifactPath, JSON.stringify(${JSON.stringify(IMPLEMENT_ARTIFACT)}, null, 2));`,
    "execFileSync('git', ['add', '-A'], { cwd });",
    "execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=T', 'commit', '-m', 'feat: profile'], { cwd });",
  ].join('\n'));
  const profile = path.join(root, 'worker.json');
  fs.writeFileSync(profile, JSON.stringify({
    schemaVersion: '1.0',
    name: 'test-agent',
    setup: [[process.execPath, setup]],
    command: [process.execPath, worker, '--agent-flag'],
    modelArgs: ['--model', '{{model}}'],
    promptDelivery: 'stdin',
    model: 'test/model',
    modelEnv: 'TEST_AGENT_MODEL',
    env: ['TEST_AGENT_TOKEN', 'TEST_OUTPUT_DIR'],
    requiredEnv: ['TEST_AGENT_TOKEN'],
    timeoutMs: 30_000,
  }));

  const provider = path.join(root, 'provider.json');
  fs.writeFileSync(provider, JSON.stringify({
    type: 'local-worktree',
    repo,
    workspaceRoot: path.join(root, 'worktrees'),
    bootstrapCommands: [],
    qualityCommands: [],
    artifactPath: '.fleet/artifacts/{{issue.id}}.json',
    worker: { name: 'test-agent', profile, model: 'test/model' },
  }));
  const ticketFile = path.join(root, 'tickets.json');
  fs.writeFileSync(ticketFile, JSON.stringify({ output: [{ id: 401, title: 'profile slice', blockedBy: [] }] }));
  const stateRoot = path.join(root, 'state');
  const script = '.agents/skills/routing/parallel-issue-fleet/scripts/fleet-controller.mjs';

  const result = spawnSync(process.execPath, [
    script, 'start', '--tickets', ticketFile, '--base', 'main',
    '--provider', provider, '--state-root', stateRoot, '--run-id', 'profile-e2e',
  ], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, TEST_AGENT_TOKEN: 'tok-401-secret', TEST_OUTPUT_DIR: outputDir },
  });
  assert.equal(result.status, 0, result.stderr);
  const { artifact } = JSON.parse(result.stdout);
  const issue = artifact.issues[0];

  assert.equal(artifact.status, 'completed');
  assert.equal(issue.status, 'validated');
  assert.deepEqual(artifact.provider.worker, { name: 'test-agent', profile, model: 'test/model' });
  assert.ok(fs.existsSync(issue.implementArtifactPath));
  assert.ok(fs.existsSync(path.join(outputDir, 'setup.txt')), 'profile setup ran');
  assert.equal(fs.readFileSync(path.join(outputDir, 'model.txt'), 'utf8'), 'test/model');
  assert.equal(fs.readFileSync(path.join(outputDir, 'token.txt'), 'utf8'), 'tok-401-secret');
  assert.match(fs.readFileSync(path.join(outputDir, 'prompt.txt'), 'utf8'), /profile slice/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outputDir, 'args.json'), 'utf8')), [
    '--agent-flag', '--model', 'test/model',
  ]);
  assert.match(issue.execution.command.join(' '), /worker-runner\.mjs/);
  assert.doesNotMatch(issue.execution.command.join(' '), /Write the required ImplementArtifact/);
  assert.doesNotMatch(JSON.stringify(artifact), /tok-401-secret/);
  assert.match(artifact.implementArtifacts[0].sourcePath, /\.fleet[\\/]artifacts[\\/]401\.json$/);
});

test('vm-pool fleet collects the validated branch, artifact, and cleanup evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-fleet-e2e-vm-'));
  const vmWorkspace = path.join(root, 'vm-workspace');
  const marker = path.join(root, 'cleaned.txt');
  const providerScript = path.join(root, 'fake-provider.mjs');
  fs.writeFileSync(providerScript, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    'const args = process.argv.slice(2);',
    'const command = args[0];',
    "const workspace = args[args.indexOf('--workspace') + 1];",
    "const expectedBranch = args[args.indexOf('--expected-branch') + 1];",
    `const artifact = ${JSON.stringify(IMPLEMENT_ARTIFACT)};`,
    'if (command === "provision") {',
    "  if (expectedBranch !== 'fleet/vm-e2e/101-demo') process.exit(2);",
    "  fs.mkdirSync(workspace, { recursive: true });",
    "  console.log(JSON.stringify({ resourceId: 'vm-101', workspacePath: workspace, ownershipToken: 'tok-101', branch: 'fleet/vm/101' }));",
    '} else if (command === "execute") {',
    "  const dir = path.join(workspace, '.agents', 'skills', 'platform', 'artifacts', 'implement');",
    '  fs.mkdirSync(dir, { recursive: true });',
    "  fs.writeFileSync(path.join(dir, '101.json'), JSON.stringify(artifact, null, 2));",
    '} else if (command === "collect") {',
    "  console.log(JSON.stringify({ branch: 'fleet/vm/101', commitSha: 'deadbeef', implementArtifactPath: path.join(workspace, '.agents', 'skills', 'platform', 'artifacts', 'implement', '101.json') }));",
    '} else if (command === "cleanup") {',
    `  fs.writeFileSync(${JSON.stringify(marker)}, 'cleaned');`,
    '}',
  ].join('\n'));

  const cmd = (name) => [process.execPath, providerScript, name, '--workspace', vmWorkspace];
  const provider = path.join(root, 'provider.json');
  fs.writeFileSync(provider, JSON.stringify({
    type: 'vm-pool',
    name: 'fake-pool',
    commands: {
      provision: [...cmd('provision'), '--expected-branch', '{{branch}}'],
      status: cmd('status'),
      bootstrap: cmd('bootstrap'),
      execute: cmd('execute'),
      validate: cmd('validate'),
      collect: cmd('collect'),
      cleanup: cmd('cleanup'),
    },
  }));
  const ticketFile = path.join(root, 'tickets.json');
  fs.writeFileSync(ticketFile, JSON.stringify({ output: [{ id: 101, title: 'demo', blockedBy: [] }] }));
  const stateRoot = path.join(root, 'state');
  const script = '.agents/skills/routing/parallel-issue-fleet/scripts/fleet-controller.mjs';

  const result = spawnSync(process.execPath, [
    script, 'start', '--tickets', ticketFile, '--base', 'HEAD',
    '--provider', provider, '--state-root', stateRoot, '--run-id', 'vm-e2e',
  ], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  const { artifact } = JSON.parse(result.stdout);
  const issue = artifact.issues[0];

  assert.equal(artifact.status, 'completed');
  assert.equal(issue.status, 'validated');
  assert.equal(issue.branch, 'fleet/vm/101');
  assert.equal(issue.commitSha, 'deadbeef');
  assert.equal(artifact.resources[0].status, 'cleaned');
  assert.ok(fs.existsSync(marker), 'cleanup command ran');

  const stored = JSON.parse(fs.readFileSync(issue.implementArtifactPath, 'utf8'));
  assert.equal(stored.commitSha, 'deadbeef');
  assert.equal(stored.qualityGateResults.gateCi, 'skipped');
  assert.equal(stored.qualityGateResults.gatePreCommit, 'pass');
});

test('integration-branch merges independent issues and gates the converged branch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-fleet-e2e-integration-'));
  const repo = path.join(root, 'repo');
  initRepo(repo);
  const worker = path.join(root, 'worker.mjs');
  fs.writeFileSync(worker, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { execFileSync } from 'node:child_process';",
    'const cwd = process.cwd();',
    'const id = process.env.FLEET_ISSUE_ID;',
    "fs.writeFileSync(path.join(cwd, `feature-${id}.txt`), `done ${id}\\n`);",
    "const dir = path.join(cwd, '.agents', 'skills', 'platform', 'artifacts', 'implement');",
    'fs.mkdirSync(dir, { recursive: true });',
    `const artifact = { ...${JSON.stringify(IMPLEMENT_ARTIFACT)}, changes: [\`feature-\${id}.txt\`] };`,
    'fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(artifact, null, 2));',
    "execFileSync('git', ['add', '-A'], { cwd });",
    "execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=T', 'commit', '-m', `feat: ${id}`], { cwd });",
  ].join('\n'));

  const provider = path.join(root, 'provider.json');
  fs.writeFileSync(provider, JSON.stringify({
    type: 'local-worktree',
    repo,
    workspaceRoot: path.join(root, 'worktrees'),
    bootstrapCommands: [],
    qualityCommands: [],
    executeCommand: [process.execPath, worker],
  }));
  const ticketFile = path.join(root, 'tickets.json');
  fs.writeFileSync(ticketFile, JSON.stringify({
    output: [
      { id: 201, title: 'first', blockedBy: [] },
      { id: 202, title: 'second', blockedBy: [] },
    ],
  }));
  const stateRoot = path.join(root, 'state');
  const script = '.agents/skills/routing/parallel-issue-fleet/scripts/fleet-controller.mjs';

  const result = spawnSync(process.execPath, [
    script, 'start', '--tickets', ticketFile, '--base', 'main', '--strategy', 'integration-branch',
    '--provider', provider, '--state-root', stateRoot, '--run-id', 'int-e2e',
  ], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.stderr);
  const { artifact } = JSON.parse(result.stdout);

  assert.equal(artifact.status, 'completed');
  assert.equal(artifact.waves[0].status, 'integrated');
  assert.deepEqual(artifact.issues.map((issue) => issue.status), ['validated', 'validated']);
  assert.ok(artifact.integration.commits.length === 2);

  const branch = artifact.integration.branch;
  for (const id of ['201', '202']) {
    const show = spawnSync('git', ['show', `${branch}:feature-${id}.txt`], { cwd: repo, encoding: 'utf8' });
    assert.equal(show.status, 0, `integration branch contains feature-${id}`);
  }
  const tip = spawnSync('git', ['rev-parse', `refs/heads/${branch}`], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  assert.equal(tip, artifact.source.baseRevision, 'the integration branch tip becomes the next immutable base');
});


test('GitHub Actions run states map to the vm-pool lifecycle', () => {
  assert.equal(mapRunState({ status: 'queued' }), 'running');
  assert.equal(mapRunState({ status: 'in_progress' }), 'running');
  assert.equal(mapRunState({ status: 'completed', conclusion: 'success' }), 'completed');
  assert.equal(mapRunState({ status: 'completed', conclusion: 'failure' }), 'failed');
  assert.equal(mapRunState({ status: 'completed', conclusion: 'cancelled' }), 'failed');
  assert.equal(mapRunState({}), 'unknown');
});

test('dispatch matching uses the unique run-name instead of the newest run', () => {
  const payload = JSON.stringify([
    { databaseId: 1, displayTitle: 'fleet-run-a-11' },
    { databaseId: 2, displayTitle: 'fleet-run-b-11' },
    { databaseId: 3, displayTitle: 'fleet-run-b-12' },
  ]);
  assert.equal(parseRunId(payload, 'run-b', '12'), '3');
  assert.equal(parseRunId(payload, 'run-z', '12'), null);
  assert.equal(parseRunId('not-json', 'run-b', '12'), null);
});

test('the GitHub prompt carries the issue, artifact path, and a bounded body', () => {
  const prompt = buildPrompt({
    issueId: '42',
    issueTitle: 'Add search',
    issueUrl: 'https://example.test/issues/42',
    issueBody: `${'x'.repeat(70_000)}TAIL-MARKER`,
    artifactPath: '.agents/skills/platform/artifacts/implement/42.json',
    runId: 'run-1',
    baseSha: 'abc123',
  });

  assert.match(prompt, /Add search/);
  assert.match(prompt, /issues\/42/);
  assert.match(prompt, /artifacts\/implement\/42\.json/);
  assert.match(prompt, /immutable base: abc123/);
  assert.doesNotMatch(prompt, /TAIL-MARKER/);
});

test('a downloaded GitHub artifact must be completed and satisfy acceptance criteria', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-fleet-gha-artifact-'));
  const file = collectArtifactPath(dir, '77');
  assert.ok(validateCollectedArtifact(file, '77')[0].includes('no ImplementArtifact'));

  fs.writeFileSync(file, JSON.stringify({
    status: 'completed',
    validation: { acceptanceCriteriaMet: true },
  }));
  assert.deepEqual(validateCollectedArtifact(file, '77'), []);

  fs.writeFileSync(file, JSON.stringify({
    status: 'partial',
    validation: { acceptanceCriteriaMet: false },
  }));
  const errors = validateCollectedArtifact(file, '77');
  assert.ok(errors.some((error) => error.includes('status must be completed')));
  assert.ok(errors.some((error) => error.includes('acceptanceCriteriaMet')));
});

test('artifact paths cannot escape the workspace through issue ids', () => {
  const local = implementArtifactPath({}, { id: '../escape' });
  assert.equal(local, '.agents/skills/platform/artifacts/implement/_escape.json');
  assert.doesNotMatch(local, /(^|\/)\.\.(\/|$)/);
  const configured = implementArtifactPath({ artifactPath: '.fleet/{{issue.id}}.json' }, { id: '../../escape' });
  assert.equal(configured, '.fleet/_.._escape.json');
  assert.doesNotMatch(configured, /(^|\/)\.\.(\/|$)/);
  const collected = collectArtifactPath('/tmp/collected', '../escape');
  assert.equal(collected, '/tmp/collected/_escape.json');
});

test('fleet branches cannot target protected or malformed refs', () => {
  assert.equal(validateFleetBranch('fleet/run-1/issue-7'), 'fleet/run-1/issue-7');
  assert.equal(validateFleetBranch('fleet/run-1/integration'), 'fleet/run-1/integration');
  for (const invalid of ['main', 'master', 'release/1', 'fleet/', 'fleet/../main', 'fleet/a b', 'fleet/a..b', 'fleet/a\\b', 'fleet/.hidden']) {
    assert.throws(() => validateFleetBranch(invalid), /fleet branch/, invalid);
  }
});

test('worker profile paths are confined to committed CI profiles', () => {
  assert.equal(validateWorkerProfilePath('.github/fleet/worker.json'), '.github/fleet/worker.json');
  assert.throws(() => validateWorkerProfilePath('/tmp/worker.json'), /repository-relative/);
  assert.throws(() => validateWorkerProfilePath('.github/fleet/../worker.json'), /repository-relative/);
  assert.throws(() => validateWorkerProfilePath('.agents/worker.json'), /under .github\/fleet/);
  assert.throws(() => validateWorkerProfilePath('.github/fleet/worker.txt'), /\.json/);
});

test('dispatch inputs carry the worker profile and model without vendor commands', () => {
  const inputs = buildDispatchInputs({
    runId: 'r1',
    issueId: '42',
    issueTitle: 'Add search',
    issueUrl: 'https://example.test/issues/42',
    issueBody: 'Expose GET /search.',
    branch: 'fleet/r1/42',
    baseSha: 'abc123',
    artifactPath: '.fleet/42.json',
    workerProfile: '.github/fleet/worker.json',
    model: 'provider/model',
  });

  assert.equal(Object.keys(inputs).length, 10);
  assert.equal(inputs.worker_profile, '.github/fleet/worker.json');
  assert.equal(inputs.model, 'provider/model');
  assert.equal(inputs.branch, 'fleet/r1/42');
  assert.equal(inputs.artifact_path, '.fleet/42.json');
  assert.match(inputs.prompt, /Add search/);
  assert.match(inputs.prompt, /\.fleet\/42\.json/);
  assert.doesNotMatch(inputs.prompt, /\/implement/);
});

test('the GitHub workflow template is agent-neutral and ships the portable runner', () => {
  const workflow = fs.readFileSync(
    '.agents/skills/routing/parallel-issue-fleet/assets/github-actions/fleet-worker.yml',
    'utf8',
  );
  assert.match(workflow, /worker_profile/);
  assert.match(workflow, /worker-runner\.mjs/);
  assert.match(workflow, /FLEET_SECRETS_JSON/);
  assert.doesNotMatch(workflow, /opencode\s+run/i);
  assert.doesNotMatch(workflow, /OPENCODE_API_KEY/);
  assert.doesNotMatch(workflow, /ANTHROPIC_API_KEY/);
  assert.doesNotMatch(workflow, /OPENAI_API_KEY/);

  const canonical = fs.readFileSync(
    '.agents/skills/routing/parallel-issue-fleet/scripts/worker-runner.mjs',
    'utf8',
  );
  const asset = fs.readFileSync(
    '.agents/skills/routing/parallel-issue-fleet/assets/github-actions/worker-runner.mjs',
    'utf8',
  );
  assert.equal(asset, canonical);
});
