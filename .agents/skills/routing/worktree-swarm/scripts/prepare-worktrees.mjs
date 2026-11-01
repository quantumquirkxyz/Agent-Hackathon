#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const ISSUE_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/;

function result(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(error, skipped = []) {
  result({ ok: false, error, skipped, created: [] });
  process.exitCode = 1;
}

async function git(args, cwd) {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 1024 * 1024 * 4 });
  return stdout.trim();
}

async function commandExists(command) {
  try { await exec('which', [command]); return true; } catch { return false; }
}

function parseArgs(args) {
  const urls = [];
  let base;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--base') base = args[++i];
    else if (args[i] === '--help' || args[i] === '-h') return { help: true };
    else urls.push(args[i]);
  }
  return { base, urls };
}

function usage() {
  return 'Usage: prepare-worktrees.mjs --base <branch> <https://github.com/<owner>/<repo>/issues/<number>> [...]';
}

function slug(title) {
  return title.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '') || 'issue';
}

function originRepository(remote) {
  const value = remote.replace(/\.git$/, '').replace(/\/$/, '');
  const match = value.match(/^(?:https?:\/\/|git@)(?:github\.com[:/])([^/]+)\/([^/]+)$/i);
  if (!match) throw new Error('origin must be a GitHub repository');
  return { owner: match[1], repo: match[2] };
}

async function issue(url, cwd) {
  const { stdout } = await exec('gh', ['issue', 'view', url, '--json', 'number,title,body,state,url'], { cwd, maxBuffer: 1024 * 1024 * 4 });
  return JSON.parse(stdout);
}

function promptFor(item, worktreePath) {
  return `You are working only in this git worktree: ${worktreePath}\nBranch ${item.branch} is already checked out. Do not switch branches. Do not push. Do not touch the primary checkout or any other worktree.\n\nIssue: ${item.url}\nTitle: ${item.title}\n${item.body}\n\nImplement this issue in this worktree. Follow the repository conventions. Run the tests that cover the change. When the change is complete, commit on this branch with a conventional message that references #${item.number}. Report the branch, the commits, and anything left open.\n\nInvoke the complete workflow loop for this issue: /implement -> /review-pr -> (/plan-review-fixes -> /implement-review-fixes -> /review-pr)* -> /publish-open-pr -> /ship-subissue. Respect every gate and stop at a handoff when the next step requires authorization. Do not perform push, pull-request, merge, or issue-close side effects under worktree-swarm.`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { result({ ok: true, usage: usage() }); return; }
  if (!options.base || options.urls.length === 0) { fail(`Missing mandatory base branch or issue URL. ${usage()}`); return; }
  if (!(await commandExists('git')) || !(await commandExists('gh')) || !(await commandExists('opencode'))) { fail('Required local commands are git, gh, and opencode.'); return; }

  let root;
  try { root = await git(['rev-parse', '--show-toplevel'], process.cwd()); }
  catch { fail('Must run inside a Git repository.'); return; }

  let repository;
  try { repository = originRepository(await git(['remote', 'get-url', 'origin'], root)); }
  catch (error) { fail(error.message); return; }

  const parsed = options.urls.map((url) => ({ url, match: url.match(ISSUE_URL) }));
  const skipped = [];
  for (const item of parsed) {
    if (!item.match) skipped.push({ url: item.url, reason: 'URL must be an HTTPS GitHub issue URL, not a pull request.' });
    else if (item.match[1].toLowerCase() !== repository.owner.toLowerCase() || item.match[2].toLowerCase() !== repository.repo.toLowerCase()) skipped.push({ url: item.url, reason: 'Issue belongs to a different repository.' });
  }
  const seen = new Set();
  for (const item of parsed.filter((entry) => entry.match)) {
    const number = Number(item.match[3]);
    if (seen.has(number)) skipped.push({ url: item.url, reason: 'Duplicate issue in this execution.' });
    seen.add(number);
  }

  let baseRef;
  try {
    const local = await git(['show-ref', '--verify', '--quiet', `refs/heads/${options.base}`], root).then(() => true).catch(() => false);
    const remote = await git(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${options.base}`], root).then(() => true).catch(() => false);
    if (!local && !remote) throw new Error(`Base branch does not exist locally or as origin/${options.base}.`);
    baseRef = local ? options.base : `origin/${options.base}`;
  } catch (error) { fail(error.message, skipped); return; }

  const generatedBranches = new Set();
  const worktreeRoot = path.join(path.dirname(root), `${repository.repo}-worktrees`);
  const worktreesText = await git(['worktree', 'list', '--porcelain'], root);
  const existingPaths = new Set([...worktreesText.matchAll(/^worktree (.+)$/gm)].map((m) => path.resolve(m[1])));
  const localBranches = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], root);
  const details = [];
  for (const item of parsed) {
    if (!item.match || skipped.some((entry) => entry.url === item.url)) continue;
    try {
      const data = await issue(item.url, root);
      if (data.state !== 'OPEN') { skipped.push({ url: item.url, reason: `Issue is ${String(data.state).toLowerCase()}, not open.` }); continue; }
      const branch = `issue/${data.number}-${slug(data.title)}`;
      const target = path.join(worktreeRoot, `issue-${data.number}`);
      if (generatedBranches.has(branch)) { skipped.push({ url: item.url, reason: `Generated branch conflicts with another issue in this execution: ${branch}.` }); continue; }
      if (localBranches.split('\n').includes(branch)) { skipped.push({ url: item.url, reason: `Local branch already exists: ${branch}.` }); continue; }
      if (existingPaths.has(path.resolve(target)) || await fs.access(target).then(() => true).catch(() => false)) { skipped.push({ url: item.url, reason: `Worktree path already exists: ${target}.` }); continue; }
      generatedBranches.add(branch);
      details.push({ number: data.number, url: data.url || item.url, title: data.title, body: data.body || '', branch, path: target, base: baseRef });
    } catch (error) { skipped.push({ url: item.url, reason: `Could not read issue with gh: ${error.message}` }); }
  }
  if (skipped.length) { fail('One or more issues failed validation; no resources were created.', skipped); return; }

  const created = [];
  try {
    await fs.mkdir(worktreeRoot, { recursive: true });
    for (const item of details) {
      await exec('git', ['worktree', 'add', '-b', item.branch, item.path, item.base], { cwd: root });
      created.push(item);
    }
  } catch (error) {
    for (const item of created.reverse()) {
      await exec('git', ['worktree', 'remove', '--force', item.path], { cwd: root }).catch(() => {});
      await exec('git', ['branch', '-D', item.branch], { cwd: root }).catch(() => {});
    }
    fail(`Worktree creation failed and was rolled back: ${error.message}`); return;
  }

  const launched = created.map((item) => {
    const prompt = promptFor(item, item.path);
    const child = spawn('opencode', ['run', prompt], { cwd: item.path, detached: true, stdio: 'ignore' });
    child.unref();
    return { ...item, agentId: child.pid, prompt };
  });
  const manifestPath = path.join(worktreeRoot, 'manifest.json');
  const manifest = { ok: true, manifestPath, created: launched, skipped: [] };
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  result(manifest);
}

main().catch((error) => fail(error.message));
