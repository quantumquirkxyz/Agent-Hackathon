import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = process.cwd();
const SCRIPT = path.join(REPO_ROOT, '.agents', 'skills', 'platform', 'project-agent-paths.mjs');
const VIEWS = [
  ['cursor', '.cursor/skills'],
  ['gemini', '.gemini/skills'],
  ['copilot', '.github/skills'],
  ['opencode', '.opencode/skills'],
  ['windsurf', '.windsurf/skills'],
];

function writeSkill(root, domain, name) {
  const dir = path.join(root, '.agents', 'skills', domain, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: fixture\n---\n`);
}

function run(root, args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args, '--json'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.match(result.stdout, /^\s*\{/, result.stderr || 'expected JSON output');
  return { status: result.status, report: JSON.parse(result.stdout) };
}

test('native views stay absent until explicitly generated', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-native-views-'));
  try {
    writeSkill(root, 'alpha', 'alpha-skill');

    const dry = run(root, []);
    assert.equal(dry.status, 0);
    assert.equal(dry.report.status, 'clean');
    assert.deepEqual(dry.report.views.map((view) => view.status), VIEWS.map(() => 'absent'));
    for (const [, relative] of VIEWS) {
      assert.equal(fs.existsSync(path.join(root, relative)), false, `${relative} must remain absent`);
    }

    const generated = run(root, ['--write']);
    assert.equal(generated.status, 0);
    assert.equal(generated.report.status, 'clean');
    for (const [name, relative] of VIEWS) {
      const link = path.join(root, relative, 'alpha-skill');
      assert.equal(fs.lstatSync(link).isSymbolicLink(), true, `${name} view must contain a symlink`);
      assert.equal(fs.realpathSync(link), path.join(root, '.agents', 'skills', 'alpha', 'alpha-skill'));
    }

    const clean = run(root, []);
    assert.equal(clean.report.status, 'clean');
    assert.deepEqual(clean.report.views.map((view) => view.pending), VIEWS.map(() => 0));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
