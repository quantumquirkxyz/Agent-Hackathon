import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const SCRIPT = path.join(REPO_ROOT, '.agents', 'skills', 'platform', 'docs-links.mjs');

function runChecker(cwd) {
  const result = spawnSync(process.execPath, [SCRIPT, '--json'], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    report: JSON.parse(result.stdout),
  };
}

test('docs-links reports broken local links and ignores external, anchor, and fenced examples', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quirk-docs-links-'));
  try {
    fs.mkdirSync(path.join(root, 'docs', 'img'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'target.md'), '# Target\n');
    fs.writeFileSync(path.join(root, 'docs', 'img', 'pixel.png'), 'not-a-real-png');
    fs.writeFileSync(
      path.join(root, 'docs', 'good.md'),
      [
        '# Good',
        '',
        '[target](target.md)',
        '[target fragment](target.md#section)',
        '[image](img/pixel.png)',
        '[external](https://example.com/docs)',
        '[anchor](#local)',
        '',
        '[reference]: target.md',
        '',
        '```markdown',
        '[fenced example](missing.md)',
        '```',
        '',
        'Inline example: `[inline example](missing.md)`.',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(root, 'docs', 'bad.md'),
      ['# Bad', '', '[missing](missing.md)', '[escapes](../../outside.md)', ''].join('\n'),
    );

    const first = runChecker(root);
    assert.equal(first.status, 1);
    assert.equal(first.report.status, 'fail');
    assert.equal(first.report.markdownFiles, 3);
    assert.deepEqual(
      first.report.missing.map((item) => [item.file, item.line, item.target, item.reason]),
      [
        ['docs/bad.md', 3, 'missing.md', 'target does not exist'],
        ['docs/bad.md', 4, '../../outside.md', 'escapes the repository'],
      ],
    );

    fs.writeFileSync(
      path.join(root, 'docs', 'bad.md'),
      ['# Bad', '', '[target](target.md)', ''].join('\n'),
    );

    const second = runChecker(root);
    assert.equal(second.status, 0);
    assert.equal(second.report.status, 'pass');
    assert.equal(second.report.broken, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
