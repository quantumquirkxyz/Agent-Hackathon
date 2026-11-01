import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const RUNNER = path.join(REPO_ROOT, '.agents', 'skills', 'platform', 'evaluate-fixtures.mjs');

function run(fixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-fixture-contract-'));
  fs.writeFileSync(path.join(dir, 'fixtures.json'), JSON.stringify({ fixtures: [fixture] }));
  const result = spawnSync('node', [RUNNER, '--fixture-dir', dir, '--json'], { encoding: 'utf8' });
  return { result, report: JSON.parse(result.stdout) };
}

test('static behavioral fixtures declare that they do not execute a task', () => {
  const { result, report } = run({
    id: 'static-behavior',
    skill: 'agent-canvas',
    type: 'behavioral',
    expected: { outputContains: ['## Contract'] },
  });

  assert.equal(result.status, 0);
  assert.equal(report.status, 'pass');
  assert.equal(report.applicable, 1);
  assert.equal(report.results[0].evaluation.kind, 'static-content');
  assert.match(report.results[0].evaluation.limitation, /does not execute/);
});

test('not-applicable fixtures are excluded from the denominator, never counted as passes', () => {
  const { result, report } = run({ id: 'metadata-only' });

  assert.equal(result.status, 1);
  assert.equal(report.passed, 0);
  assert.equal(report.applicable, 0);
  assert.equal(report.skipped, 1);
  assert.equal(report.passRate, 0);
  assert.equal(report.status, 'fail');
});

test('unknown fixture types fail closed instead of being silently skipped', () => {
  const { result, report } = run({ id: 'unknown', skill: 'agent-canvas', type: 'task', expected: {} });

  assert.equal(result.status, 1);
  assert.equal(report.status, 'fail');
  assert.equal(report.failed, 0);
  assert.equal(report.results[0].status, 'error');
});
