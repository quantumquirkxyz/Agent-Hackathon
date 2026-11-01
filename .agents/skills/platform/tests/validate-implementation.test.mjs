import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const SCRIPT = path.join(
  REPO_ROOT,
  '.agents',
  'skills',
  'delivery',
  'implement',
  'scripts',
  'validate-implementation.sh',
);

const ISSUE_ID = '9999';

// The harness compares its branch argument with the branch checked out in the
// repository it runs in, so the fixtures run from this worktree and pass the
// current branch. A detached HEAD reports "HEAD" on both sides and still matches.
function currentBranch() {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `git rev-parse failed: ${result.stderr}`);
  return result.stdout.trim();
}

const BRANCH = currentBranch();

function artifact(qualityGateResults) {
  return {
    status: 'completed',
    branch: BRANCH,
    nextConsumer: 'publish-open-pr',
    validation: { acceptanceCriteriaMet: true },
    qualityGateResults,
  };
}

// Each case writes its artifact into its own directory and points the harness at
// it with ARTIFACT_DIR, so the real artifact directory is never touched.
function runValidator(contents) {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-implement-validate-'));
  try {
    if (contents !== undefined) {
      fs.writeFileSync(path.join(artifactDir, `${ISSUE_ID}.json`), contents, 'utf8');
    }
    const result = spawnSync('bash', [SCRIPT, ISSUE_ID, BRANCH], {
      cwd: REPO_ROOT,
      env: { ...process.env, ARTIFACT_DIR: artifactDir },
      encoding: 'utf8',
    });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  } finally {
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
}

describe('validate-implementation.sh reads the schema vocabulary', () => {
  test('a passing artifact with gateCi: "pass" validates', () => {
    const result = runValidator(
      JSON.stringify(artifact({ gateIde: 'pass', gatePreCommit: 'pass', gateCi: 'pass' })),
    );
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /PASS: gate-ci passed/);
    assert.match(result.output, /PASS: branch matches/);
  });

  test('gateCi: "fail" is rejected with the failing value', () => {
    const result = runValidator(
      JSON.stringify(artifact({ gateIde: 'pass', gatePreCommit: 'pass', gateCi: 'fail' })),
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /FAIL: gate-ci must pass \(current: fail\)/);
  });

  test('a missing gateCi key is rejected as unknown', () => {
    const result = runValidator(
      JSON.stringify(artifact({ gateIde: 'pass', gatePreCommit: 'pass' })),
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /FAIL: gate-ci must pass \(current: unknown\)/);
  });

  test('the legacy gateCI spelling cannot satisfy the gate', () => {
    const result = runValidator(
      JSON.stringify(artifact({ gateIde: 'pass', gatePreCommit: 'pass', gateCI: 'passed' })),
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /FAIL: gate-ci must pass \(current: unknown\)/);
  });

  test('a missing artifact fails before the gate check', () => {
    const result = runValidator(undefined);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /FAIL: artifact missing/);
  });
});

describe('validate-implementation.sh keeps its default artifact directory', () => {
  test('ARTIFACT_DIR is optional in the script source', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8');
    assert.match(
      source,
      /ARTIFACT_DIR="\$\{ARTIFACT_DIR:-\.agents\/skills\/platform\/artifacts\/implement\}"/,
      'the default must stay .agents/skills/platform/artifacts/implement',
    );
  });
});
