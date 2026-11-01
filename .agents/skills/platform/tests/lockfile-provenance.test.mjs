import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lock = JSON.parse(fs.readFileSync('skills-lock.json', 'utf8'));

// Contract documented in docs/how-to/release.md#lockfile-provenance and enforced
// by validate-skills.mjs: authored skills are pinned by hash and declare a local
// origin; imported skills must name the upstream revision they came from.
test('every lockfile entry declares a valid provenance shape', () => {
  const entries = Object.entries(lock.skills ?? {});
  assert.ok(entries.length > 0, 'lockfile must pin at least one skill');

  for (const [name, entry] of entries) {
    assert.match(String(entry?.hash ?? ''), /^[a-f0-9]{64}$/, `${name}: hash must be sha256 hex`);
    assert.ok(['local', 'upstream'].includes(entry?.sourceType), `${name}: sourceType must be local|upstream`);
    assert.ok(
      typeof entry?.revision === 'string' && entry.revision.trim() !== '',
      `${name}: revision must be non-empty`
    );
    if (entry.sourceType === 'local') {
      assert.equal(entry.revision, 'working-tree', `${name}: local entries use revision "working-tree"`);
    }
  }
});

test('the release guide documents the same convention the validator enforces', () => {
  const guide = fs.readFileSync('docs/how-to/release.md', 'utf8');
  assert.match(guide, /## Lockfile provenance/, 'the convention needs a named section');
  assert.match(guide, /revision: "working-tree"/, 'the section must state the local revision value');
  assert.match(guide, /sourceType/, 'the section must name the provenance field');
});
