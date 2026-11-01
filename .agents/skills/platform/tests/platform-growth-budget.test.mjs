import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const PLATFORM_DIR = path.join(REPO_ROOT, '.agents', 'skills', 'platform');
const BUDGET_PATH = path.join(REPO_ROOT, 'policy', 'platform-growth-budget.json');

function measurePlatformLoc(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += measurePlatformLoc(full);
    } else if (entry.name.endsWith('.mjs')) {
      total += fs.readFileSync(full, 'utf8').split('\n').length;
    }
  }
  return total;
}

test('platform tooling stays inside its published growth budget', () => {
  const budget = JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8'));
  const measured = measurePlatformLoc(PLATFORM_DIR);

  assert.equal(typeof budget.maxLoc, 'number', 'budget must declare a numeric maxLoc');
  assert.ok(budget.maxLoc > 0, 'budget must declare a positive maxLoc');
  assert.match(budget.remediation, /\S/, 'budget must declare what to do when exceeded');
  assert.ok(Array.isArray(budget.reviewTriggers) && budget.reviewTriggers.length > 0,
    'budget must declare event-based review triggers');
  assert.equal('reviewBy' in budget, false,
    'growth budgets use event-based triggers instead of a date that silently expires');

  assert.ok(
    measured <= budget.maxLoc,
    `platform tooling is ${measured} LOC, over the ${budget.maxLoc} budget. ${budget.remediation}`
  );
});

test('the recorded measurement is not stale by more than the budget headroom', () => {
  const budget = JSON.parse(fs.readFileSync(BUDGET_PATH, 'utf8'));
  const measured = measurePlatformLoc(PLATFORM_DIR);

  // measuredLoc is a snapshot, not a gate. Guard it so a long drift between the
  // recorded number and reality forces a refresh of the budget file.
  const drift = Math.abs(measured - budget.measuredLoc);
  assert.ok(
    drift <= budget.maxLoc * 0.25,
    `recorded measuredLoc ${budget.measuredLoc} drifted ${drift} LOC from ${measured}; refresh the budget snapshot`
  );
});
