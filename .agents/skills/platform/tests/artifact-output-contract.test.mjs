import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const VALIDATOR = '.agents/skills/platform/validate-skills.mjs';
const DEBT_PATTERN = /artifactType "[^"]+" declared but outputs is empty/;

function runValidator(args = []) {
  const result = spawnSync('node', [VALIDATOR, ...args], { encoding: 'utf8' });
  assert.ok(result.stdout, `validator produced no stdout: ${result.stderr}`);
  return { status: result.status, payload: JSON.parse(result.stdout) };
}

// ADR-001 declares that a skill which names an artifactType emits a typed
// artifact. The schema tolerates `outputs: ""`, so the validator reports the
// bundle-wide gap as structured debt instead of blocking the general gate.
test('validator reports artifact-output debt without failing the default run', () => {
  const { status, payload } = runValidator();

  assert.equal(status, 0, 'default validation must not fail on artifact-output debt');
  assert.equal(payload.status, 'pass');
  assert.equal(typeof payload.artifactOutputDebt?.count, 'number');
  assert.ok(Array.isArray(payload.artifactOutputDebt.examples));
  assert.ok(
    payload.artifactOutputDebt.examples.length <= 5,
    'the debt report is sampled, not exhaustive'
  );
  for (const example of payload.artifactOutputDebt.examples) {
    assert.match(example, DEBT_PATTERN);
  }
});

test('--strict promotes artifact-output debt to errors', () => {
  const { status, payload } = runValidator(['--strict']);
  const debt = payload.artifactOutputDebt;

  if (debt.count === 0) {
    assert.equal(status, 0, 'strict mode must pass once the debt is fully paid');
    return;
  }

  assert.equal(status, 1, 'strict mode must fail while debt remains');
  assert.equal(payload.status, 'fail');
  const promoted = payload.errors.filter((message) => DEBT_PATTERN.test(message));
  assert.equal(promoted.length, debt.count, 'every debt entry must surface as an error');
});
