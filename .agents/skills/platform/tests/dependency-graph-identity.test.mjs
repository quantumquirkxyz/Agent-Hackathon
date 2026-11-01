import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const SCRIPT = path.join(REPO_ROOT, '.agents', 'skills', 'platform', 'dependency-graph.mjs');

function writeSkill(root, domain, name, dependencies = []) {
  const dir = path.join(root, '.agents', 'skills', domain, name);
  fs.mkdirSync(dir, { recursive: true });
  const dependencyBlock = dependencies.length
    ? `dependencies:\n${dependencies.map((dependency) => `  - ${dependency}`).join('\n')}\n`
    : '';
  fs.writeFileSync(path.join(dir, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    `category: ${domain}`,
    'description: synthetic graph identity fixture',
    dependencyBlock.trimEnd(),
    '---',
    `# ${name}`,
    '',
  ].filter(Boolean).join('\n'));
}

test('dependency graph reports basename collisions and resolves exact path IDs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-dependency-graph-'));
  writeSkill(root, 'alpha', 'duplicate');
  writeSkill(root, 'beta', 'duplicate');
  writeSkill(root, 'consumer', 'consumer', [
    'duplicate',
    '.agents/skills/beta/duplicate',
  ]);

  const result = spawnSync('node', [SCRIPT, '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));

  assert.deepEqual(report.duplicateNames, [{
    name: 'duplicate',
    ids: [
      '.agents/skills/alpha/duplicate',
      '.agents/skills/beta/duplicate',
    ],
  }]);
  assert.deepEqual(report.unresolvedDependencies, [{
    skill: '.agents/skills/consumer/consumer',
    dependency: 'duplicate',
  }]);
  const consumer = report.nodes.find((node) => node.id === '.agents/skills/consumer/consumer');
  assert.deepEqual(consumer.dependencies, ['.agents/skills/beta/duplicate']);
});
