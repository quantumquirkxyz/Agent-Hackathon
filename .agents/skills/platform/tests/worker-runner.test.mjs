import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildWorkerEnvironment,
  readWorkerProfile,
  renderWorkerArgs,
  resolveWorkerProfile,
  runWorker,
  validateWorkerProfile,
} from '../../routing/parallel-issue-fleet/scripts/worker-runner.mjs';

const RUNNER = fileURLToPath(new URL(
  '../../routing/parallel-issue-fleet/scripts/worker-runner.mjs',
  import.meta.url,
));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-worker-runner-'));
  const agent = path.join(root, 'agent.mjs');
  const setup = path.join(root, 'setup.mjs');
  fs.writeFileSync(agent, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    'const cwd = process.cwd();',
    'const args = process.argv.slice(2);',
    "fs.writeFileSync(path.join(cwd, 'argv.json'), JSON.stringify(args));",
    "fs.writeFileSync(path.join(cwd, 'env.json'), JSON.stringify({",
    "  TEST_TOKEN: process.env.TEST_TOKEN ?? null,",
    "  OTHER_SECRET: process.env.OTHER_SECRET ?? null,",
    "  GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? null,",
    "  MY_AGENT_MODEL: process.env.MY_AGENT_MODEL ?? null,",
    "  FLEET_MODEL: process.env.FLEET_MODEL ?? null,",
    '}));',
    "let stdin = '';",
    'try { stdin = fs.readFileSync(0, "utf8"); } catch { /* ignored */ }',
    "fs.writeFileSync(path.join(cwd, 'stdin.txt'), stdin);",
    "const promptIndex = args.indexOf('--prompt-file');",
    'if (promptIndex >= 0) {',
    '  const prompt = fs.readFileSync(args[promptIndex + 1], "utf8");',
    "  fs.writeFileSync(path.join(cwd, 'prompt.txt'), prompt);",
    '}',
  ].join('\n'));
  fs.writeFileSync(setup, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "fs.writeFileSync(path.join(process.cwd(), 'setup.json'), JSON.stringify(process.argv.slice(2)));",
  ].join('\n'));
  return { root, agent, setup };
}

function run(root, profile, extra = []) {
  const profileFile = path.join(root, 'worker.json');
  fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2));
  const promptFile = path.join(root, 'prompt-input.txt');
  fs.writeFileSync(promptFile, 'Implement the thing.\n');
  const result = spawnSync(process.execPath, [
    RUNNER,
    '--profile', profileFile,
    '--workspace', root,
    '--prompt-file', promptFile,
    '--artifact', '.agents/skills/platform/artifacts/implement/1.json',
    '--run-id', 'run-1',
    '--issue-id', '1',
    '--issue-title', 'demo',
    '--base-revision', 'abc123',
    ...extra,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      TEST_TOKEN: 'secret-token',
      OTHER_SECRET: 'must-not-leak',
      GITHUB_TOKEN: 'must-not-leak',
    },
  });
  return { result, profileFile, promptFile };
}

test('argv delivery runs setup, model args, and an allowlisted environment', () => {
  const { root, agent, setup } = fixture();
  const { result } = run(root, {
    schemaVersion: '1.0',
    name: 'fake',
    setup: [[process.execPath, setup, '{{workspace}}']],
    command: [process.execPath, agent, '{{modelArgs}}', '{{prompt}}'],
    promptDelivery: 'argv',
    modelArgs: ['--model', '{{model}}'],
    model: 'provider/model',
    modelEnv: 'MY_AGENT_MODEL',
    env: ['TEST_TOKEN'],
    requiredEnv: ['TEST_TOKEN'],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'setup.json'), 'utf8')), [root]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'argv.json'), 'utf8')), [
    '--model', 'provider/model', 'Implement the thing.\n',
  ]);
  const env = JSON.parse(fs.readFileSync(path.join(root, 'env.json'), 'utf8'));
  assert.equal(env.TEST_TOKEN, 'secret-token');
  assert.equal(env.OTHER_SECRET, null);
  assert.equal(env.GITHUB_TOKEN, null);
  assert.equal(env.MY_AGENT_MODEL, 'provider/model');
  assert.equal(env.FLEET_MODEL, 'provider/model');
  assert.equal(fs.readFileSync(path.join(root, 'stdin.txt'), 'utf8'), '');
});

test('an empty --model keeps the profile model', () => {
  const { root, agent } = fixture();
  const { result } = run(root, {
    schemaVersion: '1.0',
    command: [process.execPath, agent, '{{modelArgs}}', '{{prompt}}'],
    promptDelivery: 'argv',
    modelArgs: ['--model', '{{model}}'],
    model: 'provider/model',
    modelEnv: 'MY_AGENT_MODEL',
  }, ['--model', '']);

  assert.equal(result.status, 0, result.stderr);
  const env = JSON.parse(fs.readFileSync(path.join(root, 'env.json'), 'utf8'));
  assert.equal(env.MY_AGENT_MODEL, 'provider/model');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'argv.json'), 'utf8')), [
    '--model', 'provider/model', 'Implement the thing.\n',
  ]);
});

test('stdin delivery pipes the prompt without putting it in argv', () => {
  const { root, agent } = fixture();
  const { result } = run(root, {
    schemaVersion: '1.0',
    command: [process.execPath, agent],
    promptDelivery: 'stdin',
    env: ['TEST_TOKEN'],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'argv.json'), 'utf8')), []);
  assert.equal(fs.readFileSync(path.join(root, 'stdin.txt'), 'utf8'), 'Implement the thing.\n');
});

test('file delivery passes a readable prompt file', () => {
  const { root, agent } = fixture();
  const { result } = run(root, {
    schemaVersion: '1.0',
    command: [process.execPath, agent, '--prompt-file', '{{promptFile}}'],
    promptDelivery: 'file',
    env: ['TEST_TOKEN'],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'prompt.txt'), 'utf8'), 'Implement the thing.\n');
});

test('FLEET_SECRETS_JSON injects only names the profile allows', () => {
  const { root, agent } = fixture();
  const profileFile = path.join(root, 'worker.json');
  fs.writeFileSync(profileFile, JSON.stringify({
    schemaVersion: '1.0',
    command: [process.execPath, agent],
    promptDelivery: 'argv',
    env: ['TEST_TOKEN'],
  }));
  const promptFile = path.join(root, 'prompt-input.txt');
  fs.writeFileSync(promptFile, 'prompt\n');
  const result = spawnSync(process.execPath, [
    RUNNER,
    '--profile', profileFile,
    '--workspace', root,
    '--prompt-file', promptFile,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      TEST_TOKEN: '',
      FLEET_SECRETS_JSON: JSON.stringify({ TEST_TOKEN: 'json-secret', OTHER_SECRET: 'nope' }),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const env = JSON.parse(fs.readFileSync(path.join(root, 'env.json'), 'utf8'));
  assert.equal(env.TEST_TOKEN, 'json-secret');
  assert.equal(env.OTHER_SECRET, null);
});

test('missing required credentials fail closed without printing the value', () => {
  const { root, agent } = fixture();
  const profileFile = path.join(root, 'worker.json');
  fs.writeFileSync(profileFile, JSON.stringify({
    schemaVersion: '1.0',
    command: [process.execPath, agent],
    promptDelivery: 'argv',
    requiredEnv: ['MISSING_AGENT_KEY'],
  }));
  const promptFile = path.join(root, 'prompt-input.txt');
  fs.writeFileSync(promptFile, 'prompt\n');
  const result = spawnSync(process.execPath, [
    RUNNER, '--profile', profileFile, '--workspace', root, '--prompt-file', promptFile,
  ], { cwd: root, encoding: 'utf8', env: { ...process.env, MISSING_AGENT_KEY: '' } });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MISSING_AGENT_KEY/);
  assert.ok(!fs.existsSync(path.join(root, 'argv.json')));
});

test('profile validation rejects unsafe or ambiguous commands', () => {
  assert.deepEqual(validateWorkerProfile({
    command: ['agent', '{{modelArgs}}', '{{prompt}}'],
    modelArgs: ['--model', '{{model}}'],
  }), []);
  assert.match(validateWorkerProfile({ command: [] }).join(' '), /command/);
  assert.match(validateWorkerProfile({ command: ['  '] }).join(' '), /non-empty executable/);
  assert.match(validateWorkerProfile({ command: ['agent'], setup: [['  ']] }).join(' '), /non-empty executable/);
  assert.match(validateWorkerProfile({
    command: ['agent'],
    env: ['FLEET_SECRETS_JSON'],
  }).join(' '), /reserved/);
  assert.match(validateWorkerProfile({
    command: ['agent'],
    requiredEnv: ['GITHUB_TOKEN'],
  }).join(' '), /reserved/);
  assert.match(validateWorkerProfile({ command: ['agent'], promptDelivery: 'shell' }).join(' '), /promptDelivery/);
  assert.match(validateWorkerProfile({
    command: ['agent', '{{promptFile}}'],
    promptDelivery: 'argv',
  }).join(' '), /promptFile/);
  assert.match(validateWorkerProfile({
    command: ['agent'],
    promptDelivery: 'file',
  }).join(' '), /promptFile/);
  assert.match(validateWorkerProfile({
    command: ['agent', '{{prompt}}', '{{prompt}}'],
    promptDelivery: 'stdin',
  }).join(' '), /prompt/);
  assert.match(validateWorkerProfile({
    command: ['agent', '--x={{modelArgs}}'],
    modelArgs: ['--model', '{{model}}'],
  }).join(' '), /complete argv element/);
});

test('renderWorkerArgs expands modelArgs at the requested position', () => {
  const args = renderWorkerArgs({
    command: ['agent', '{{modelArgs}}', '--message', '{{prompt}}'],
    modelArgs: ['--model', '{{model}}'],
  }, { prompt: 'do it', model: 'm1', workspace: '/w' });
  assert.deepEqual(args, ['agent', '--model', 'm1', '--message', 'do it']);

  const noModel = renderWorkerArgs({
    command: ['agent', '{{modelArgs}}', '--message', '{{prompt}}'],
    modelArgs: ['--model', '{{model}}'],
  }, { prompt: 'do it', model: '', workspace: '/w' });
  assert.deepEqual(noModel, ['agent', '--message', 'do it']);
});

test('buildWorkerEnvironment exposes names but not the secrets JSON blob', () => {
  const env = buildWorkerEnvironment({
    env: ['TEST_TOKEN'],
    modelEnv: 'AGENT_MODEL',
  }, {
    PATH: '/bin',
    TEST_TOKEN: 'value',
    FLEET_SECRETS_JSON: JSON.stringify({ TEST_TOKEN: 'value' }),
  }, {
    model: 'm1',
    workspace: '/w',
    promptFile: '/tmp/p',
    runId: 'r1',
    issueId: '1',
  });

  assert.equal(env.PATH, '/bin');
  assert.equal(env.TEST_TOKEN, 'value');
  assert.equal(env.AGENT_MODEL, 'm1');
  assert.equal(env.FLEET_MODEL, 'm1');
  assert.equal(env.FLEET_PROMPT_FILE, '/tmp/p');
  assert.equal(env.FLEET_SECRETS_JSON, undefined);
  assert.throws(() => buildWorkerEnvironment({
    env: ['GITHUB_TOKEN'],
  }, { GITHUB_TOKEN: 'repo-token' }), /reserved/);
});

test('resolveWorkerProfile applies an explicit model override', () => {
  const { root } = fixture();
  const file = path.join(root, 'worker.json');
  fs.writeFileSync(file, JSON.stringify({
    schemaVersion: '1.0',
    command: ['agent', '{{prompt}}'],
    model: 'base-model',
  }));
  const { profile, profilePath } = resolveWorkerProfile({ profile: 'worker.json', model: 'override' }, { baseDir: root });
  assert.equal(profile.model, 'override');
  assert.equal(profilePath, file);
});

test('file delivery refuses a missing prompt file', async () => {
  const { root } = fixture();
  const profileFile = path.join(root, 'worker.json');
  fs.writeFileSync(profileFile, JSON.stringify({
    schemaVersion: '1.0',
    command: [process.execPath, '-e', '0', '{{promptFile}}'],
    promptDelivery: 'file',
  }));
  await assert.rejects(
    runWorker(readWorkerProfile(profileFile).profile, {
      workspace: root,
      prompt: 'hello',
      promptFile: path.join(root, 'missing.txt'),
    }),
    /prompt file does not exist/,
  );
});

test('dry-run redacts a prompt embedded in a larger argv element', () => {
  const { root, agent } = fixture();
  const profileFile = path.join(root, 'worker.json');
  fs.writeFileSync(profileFile, JSON.stringify({
    schemaVersion: '1.0',
    command: [process.execPath, agent, '--message={{prompt}}'],
    promptDelivery: 'argv',
  }));
  const promptFile = path.join(root, 'prompt-input.txt');
  fs.writeFileSync(promptFile, 'embedded secret\n');
  const result = spawnSync(process.execPath, [
    RUNNER,
    '--profile', profileFile,
    '--workspace', root,
    '--prompt-file', promptFile,
    '--dry-run',
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.ok(output.command.some((part) => part === '--message=[PROMPT]'));
  assert.ok(!JSON.stringify(output).includes('embedded secret'));
});

test('dry-run resolves the command without executing the agent', () => {
  const { root, agent } = fixture();
  const profileFile = path.join(root, 'worker.json');
  fs.writeFileSync(profileFile, JSON.stringify({
    schemaVersion: '1.0',
    command: [process.execPath, agent, '{{prompt}}'],
    promptDelivery: 'argv',
  }));
  const promptFile = path.join(root, 'prompt-input.txt');
  fs.writeFileSync(promptFile, 'secret prompt\n');
  const result = spawnSync(process.execPath, [
    RUNNER,
    '--profile', profileFile,
    '--workspace', root,
    '--prompt-file', promptFile,
    '--dry-run',
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.ok(output.command.includes('[PROMPT]'));
  assert.ok(!JSON.stringify(output).includes('secret prompt'));
  assert.ok(!fs.existsSync(path.join(root, 'argv.json')));
});
