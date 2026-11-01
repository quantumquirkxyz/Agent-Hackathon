import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const SCRIPT = path.join(REPO_ROOT, '.agents', 'skills', 'platform', 'fix-compatibility-view.mjs');

function run(cwd, args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  const report = args.includes('--json') ? JSON.parse(result.stdout) : null;
  return { status: result.status, stdout: result.stdout, report };
}

function writeSkill(root, domain, name) {
  const dir = path.join(root, '.agents', 'skills', domain, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test skill\n---\n`);
}

function link(root, name, target) {
  fs.symlinkSync(target, path.join(root, '.claude', 'skills', name));
}

test('fix-compatibility-view retargets file links, prunes domain aliases, and creates missing skills', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-compat-view-'));
  try {
    writeSkill(root, 'alpha', 'alpha-skill');
    writeSkill(root, 'beta', 'beta-skill');
    writeSkill(root, 'platform', 'gamma-skill');
    fs.mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true });

    link(root, 'alpha-skill', '../../.agents/skills/alpha/alpha-skill');
    link(root, 'beta-skill', '../../.agents/skills/beta/beta-skill/SKILL.md');
    link(root, 'alpha', '../../.agents/skills/alpha');
    link(root, 'dangling', '../../.agents/skills/does-not-exist');

    const dry = run(root, ['--json']);
    assert.equal(dry.status, 0);
    assert.equal(dry.report.status, 'drift');
    assert.equal(dry.report.pending, 4);
    assert.deepEqual(
      dry.report.actions.map((action) => [action.name, action.action]),
      [
        ['alpha', 'remove'],
        ['beta-skill', 'rewrite'],
        ['dangling', 'remove'],
        ['gamma-skill', 'create'],
      ],
    );

    const applied = run(root, ['--write', '--json']);
    assert.equal(applied.status, 0);
    assert.equal(applied.report.status, 'repaired');
    assert.equal(applied.report.removed, 2);
    assert.equal(applied.report.fixed, 1);
    assert.equal(applied.report.created, 1);

    assert.equal(fs.readlinkSync(path.join(root, '.claude', 'skills', 'beta-skill')), '../../.agents/skills/beta/beta-skill');
    assert.equal(fs.readlinkSync(path.join(root, '.claude', 'skills', 'gamma-skill')), '../../.agents/skills/platform/gamma-skill');
    assert.ok(!fs.existsSync(path.join(root, '.claude', 'skills', 'alpha')));
    assert.ok(!fs.existsSync(path.join(root, '.claude', 'skills', 'dangling')));

    const clean = run(root, ['--json']);
    assert.equal(clean.status, 0);
    assert.equal(clean.report.status, 'clean');
    assert.equal(clean.report.pending, 0);
    assert.equal(clean.report.scanned, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
