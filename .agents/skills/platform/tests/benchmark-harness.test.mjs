import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTaskRun } from '../benchmark-harness.mjs';

test('benchmark never treats missing task output as a pass', () => {
  assert.equal(classifyTaskRun({ exitCode: 0, report: null }), 'runner-error');
  assert.equal(classifyTaskRun({ exitCode: 1, report: undefined }), 'runner-error');
});

test('benchmark preserves explicit task outcomes', () => {
  for (const status of ['pass', 'fail', 'blocked', 'error']) {
    assert.equal(classifyTaskRun({ exitCode: status === 'pass' ? 0 : 1, report: { status } }), status);
  }
});

test('benchmark rejects unknown report statuses', () => {
  assert.equal(classifyTaskRun({ exitCode: 0, report: { status: 'not-executed' } }), 'runner-error');
});
