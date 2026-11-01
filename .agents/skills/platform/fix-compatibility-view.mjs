#!/usr/bin/env node
// fix-compatibility-view.mjs - repair the .claude/skills compatibility view.
//
// `.claude/skills/` is a generated compatibility view: one flat symlink per
// canonical skill in `.agents/skills/`, which is the source of truth (see
// `.agents/AGENTS.md` and the root `AGENTS.md`). `scripts/sync-registry.mjs`
// only CREATES the links that are missing, so two defects accumulate in the
// view that it cannot repair:
//
//   1. absolute symlinks committed from another checkout. They resolve on the
//      machine that authored them and break on a clone into any other home
//      directory, so the view stops being portable.
//   2. dangling symlinks left behind by a domain that was renamed, merged, or
//      removed. The consumer sees a skill directory that does not exist.
//
// This script repairs both kinds and is idempotent: a second run finds nothing
// left to do and reports a clean view.
//
// Rules applied to every first-level entry of the view:
//   - symlink whose name is not a canonical skill name -> proposed for removal
//     (domain aliases and other stale entries do not belong in a flat view)
//   - symlink whose destination does not resolve, or resolves outside the
//     repository -> proposed for removal
//   - symlink whose name is canonical but whose destination is not that skill's
//     directory (for example a direct SKILL.md link) -> retargeted
//   - symlink whose destination is correct but absolute -> relative rewrite
//   - canonical skill with no entry in the view -> created
//   - anything that is not a symlink -> left intact and counted as skipped
//
// Usage:
//   node .agents/skills/platform/fix-compatibility-view.mjs [--write] [--json]
//
// Default mode is dry-run: it reports what it would do and changes nothing.
// --write applies the repairs. --json emits the machine-readable report.
//
// Exit codes: 0 = view clean or every repair applied,
//             1 = a repair could not be applied, or the view is unreadable,
//             2 = usage error. Dry-run never fails on drift: it only reports.
//
// Report fields: scanned counts first-level entries; skipped counts the entries
// left intact (correct relative links and non-symlinks); created, fixed and
// removed count APPLIED repairs, so all are 0 in dry-run; pending counts the
// repairs still to apply; dangling and absolute list the offending link names;
// actions carries every proposed or applied repair with its from/to pair.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.cwd();
const viewDir = path.join(repoRoot, '.claude', 'skills');

const HELP = `fix-compatibility-view options:
  (no flags)   dry-run: report the repairs the view needs, change nothing
  --write      apply the repairs (create missing links, retarget wrong or absolute links, remove stale ones)
  --json       emit the machine-readable report instead of the summary
  --help       show this help`;

class UsageError extends Error {}

function parseArgs(argv) {
  const flags = { write: false, json: false, help: false };
  for (const token of argv) {
    if (token === '--write') flags.write = true;
    else if (token === '--json') flags.json = true;
    else if (token === '--help' || token === '-h') flags.help = true;
    else throw new UsageError(`unknown argument: ${token}`);
  }
  return flags;
}

// Canonical (every symlink resolved) absolute path of a link destination, or
// null when the destination does not resolve. realpath is required: a link can
// name a path that only exists through another symlink (a home-directory alias
// of the repository), and resolving through it is what tells an in-repo
// destination from an out-of-repo one.
function resolveDestination(linkDir, rawTarget) {
  try {
    return fs.realpathSync(path.resolve(linkDir, rawTarget));
  } catch {
    return null;
  }
}

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

function collectCanonicalSkills(dir, out = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (fs.existsSync(path.join(full, 'SKILL.md'))) {
      if (out.has(entry.name)) {
        throw new Error(`duplicate canonical skill name: ${entry.name}`);
      }
      out.set(entry.name, fs.realpathSync(full));
    } else {
      collectCanonicalSkills(full, out);
    }
  }
  return out;
}

function scan(viewDirReal, repoRootReal, canonicalSkills) {
  const report = {
    root: path.relative(repoRoot, viewDir),
    scanned: 0,
    created: 0,
    fixed: 0,
    removed: 0,
    skipped: 0,
    dangling: [],
    absolute: [],
    actions: [],
    errors: [],
  };

  const entries = fs.readdirSync(viewDirReal, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  const seen = new Set();

  for (const entry of entries) {
    const linkPath = path.join(viewDirReal, entry.name);
    report.scanned += 1;
    seen.add(entry.name);

    if (!entry.isSymbolicLink()) {
      report.skipped += 1;
      continue;
    }

    const raw = fs.readlinkSync(linkPath);
    const absolute = path.isAbsolute(raw);
    const destination = resolveDestination(viewDirReal, raw);
    const canonical = canonicalSkills.get(entry.name);

    if (absolute) report.absolute.push(entry.name);

    if (!canonical) {
      report.actions.push({
        name: entry.name,
        action: 'remove',
        from: raw,
        to: null,
        reason: 'entry does not name a canonical skill',
        applied: false,
      });
      continue;
    }

    if (destination === null) {
      report.dangling.push(entry.name);
      report.actions.push({
        name: entry.name,
        action: 'remove',
        from: raw,
        to: null,
        reason: 'destination does not exist',
        applied: false,
      });
      continue;
    }

    if (!isInside(repoRootReal, destination)) {
      report.dangling.push(entry.name);
      report.actions.push({
        name: entry.name,
        action: 'remove',
        from: raw,
        to: null,
        reason: 'destination resolves outside the repository',
        applied: false,
      });
      continue;
    }

    const expected = path.relative(viewDirReal, canonical);
    if (destination !== canonical) {
      report.actions.push({
        name: entry.name,
        action: 'rewrite',
        from: raw,
        to: expected,
        reason: 'target is not the canonical skill directory',
        applied: false,
      });
      continue;
    }

    if (absolute) {
      report.actions.push({
        name: entry.name,
        action: 'rewrite',
        from: raw,
        to: expected,
        reason: 'absolute link retargeted to the canonical bundle path',
        applied: false,
      });
      continue;
    }

    report.skipped += 1;
  }

  for (const [name, canonical] of canonicalSkills) {
    if (seen.has(name)) continue;
    report.actions.push({
      name,
      action: 'create',
      from: null,
      to: path.relative(viewDirReal, canonical),
      reason: 'canonical skill has no compatibility-view entry',
      applied: false,
    });
  }

  return report;
}

function apply(report, viewDirReal) {
  for (const action of report.actions) {
    const linkPath = path.join(viewDirReal, action.name);
    try {
      if (action.action === 'remove') {
        fs.unlinkSync(linkPath);
        report.removed += 1;
      } else if (action.action === 'create') {
        fs.symlinkSync(action.to, linkPath);
        report.created += 1;
      } else {
        fs.unlinkSync(linkPath);
        fs.symlinkSync(action.to, linkPath);
        report.fixed += 1;
      }
      action.applied = true;
    } catch (error) {
      action.error = error?.message ?? String(error);
      report.errors.push(`${action.name}: ${action.error}`);
    }
  }
}

function finalize(report, write) {
  const pending = report.actions.filter((action) => !action.applied).length;
  let status = 'clean';
  if (report.errors.length) status = 'error';
  else if (report.actions.length === 0) status = 'clean';
  else if (pending > 0) status = 'drift';
  else status = 'repaired';

  return {
    mode: write ? 'write' : 'dry-run',
    root: report.root,
    scanned: report.scanned,
    created: report.created,
    fixed: report.fixed,
    removed: report.removed,
    skipped: report.skipped,
    pending,
    status,
    dangling: report.dangling,
    absolute: report.absolute,
    actions: report.actions,
    errors: report.errors,
  };
}

function printSummary(summary) {
  console.log(`[fix-compatibility-view] mode: ${summary.mode}`);
  console.log(`[fix-compatibility-view] view: ${summary.root} (${summary.scanned} entries, ${summary.skipped} intact, ${summary.created} created)`);
  for (const action of summary.actions) {
    const verb = action.applied ? 'applied' : 'propose';
    const target = action.to === null ? '(remove)' : action.to;
    console.log(`[fix-compatibility-view] ${verb}: ${action.name} -> ${target} [${action.reason}]`);
  }
  if (summary.errors.length) {
    for (const error of summary.errors) console.log(`[fix-compatibility-view] error: ${error}`);
  }
  console.log(`[fix-compatibility-view] status: ${summary.status} (pending ${summary.pending})`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    return 0;
  }

  // Canonicalize both the view and the repository root so the relative targets
  // written below stay correct however the caller reached the repository.
  const viewDirReal = fs.realpathSync(viewDir);
  const repoRootReal = fs.realpathSync(repoRoot);
  const canonicalSkills = collectCanonicalSkills(path.join(repoRootReal, '.agents', 'skills'));

  const report = scan(viewDirReal, repoRootReal, canonicalSkills);
  if (flags.write) apply(report, viewDirReal);

  const summary = finalize(report, flags.write);
  if (flags.json) console.log(JSON.stringify(summary, null, 2));
  else printSummary(summary);

  if (report.errors.length) return 1;
  return 0;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      if (error instanceof UsageError) {
        console.error(`[fix-compatibility-view] ${error.message}`);
        console.error(HELP);
        process.exit(2);
      }
      console.error(`[fix-compatibility-view] error: ${error?.message ?? error}`);
      process.exit(1);
    },
  );
}
