import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSkillGraphIndex,
  manifestSkillSource,
  memoryGraphStore,
} from '../skill-graph-index.mjs';

const manifest = [
  { path: '.agents/skills/test/alpha/SKILL.md', dirPath: '.agents/skills/test/alpha', domain: 'test', dirName: 'alpha', text: '---\ncapabilities: [artifact]\ndescription: artifact producer\n---\n' },
  { path: '.agents/skills/test/beta/SKILL.md', dirPath: '.agents/skills/test/beta', domain: 'test', dirName: 'beta', text: '---\ncapabilities: [artifact]\ndescription: artifact consumer\n---\nnextConsumer: `alpha`\n' },
];

test('Skill Graph Index exposes deep lifecycle and retrieval interface', () => {
  const index = createSkillGraphIndex({ source: manifestSkillSource(manifest), store: memoryGraphStore() });
  assert.equal(index.diagnostics().status, 'empty');
  const refreshed = index.refresh();
  assert.equal(refreshed.nodeCount, 2);
  assert.equal(refreshed.edgeCount, 2);
  assert.equal(index.find('alpha', { limit: 1 }).top1, 'alpha');
  assert.equal(index.neighbors('unknown').exists, false);
});

test('Skill Graph Index rejects invalid options at its interface', () => {
  const index = createSkillGraphIndex({ source: manifestSkillSource(manifest), store: memoryGraphStore() });
  assert.deepEqual(index.find('artifact', { limit: 0 }), {
    status: 'invalid-options',
    error: 'limit must be a positive integer',
  });
});
