#!/usr/bin/env node
// docs-links.mjs - verify that relative Markdown links resolve inside the repo.
//
// The gate already audits skill frontmatter, locks, adapters, and generated
// projections, but a documentation link is only checked when a human follows
// it. This checker walks every Markdown file outside dependency/build trees,
// skips fenced blocks, inline code, external URLs, and anchors, and fails when
// a local link target does not exist or escapes the repository.
//
// Usage:
//   node .agents/skills/platform/docs-links.mjs [--json]
//
// Exit codes: 0 = every local link resolves, 1 = at least one link is broken
// or escapes the repository, 2 = usage error.

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);
const SKIP_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.venv',
  '.cache',
  '.scratch',
  '.skill-sandbox',
  'artifacts',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'venv',
]);
const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const HELP = `docs-links options:
  (no flags)   check every Markdown file and print broken links
  --json       emit the machine-readable report
  --help       show this help`;

class UsageError extends Error {}

function parseArgs(argv) {
  const flags = { json: false, help: false };
  for (const token of argv) {
    if (token === '--json') flags.json = true;
    else if (token === '--help' || token === '-h') flags.help = true;
    else throw new UsageError(`unknown argument: ${token}`);
  }
  return flags;
}

function collectMarkdownFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      collectMarkdownFiles(path.join(dir, entry.name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function stripInlineCode(line) {
  return line.replace(/`[^`]*`/g, '');
}

function localTarget(raw) {
  let target = raw.trim();
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
  if (!target || target.startsWith('#')) return null;
  if (EXTERNAL_SCHEME.test(target) || target.startsWith('//')) return null;
  const cut = target.search(/[?#]/);
  if (cut !== -1) target = target.slice(0, cut);
  if (!target) return null;
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep the undecoded value so the report still shows what the document says.
  }
  return target;
}

function resolveTarget(file, target) {
  if (target.startsWith('/')) return path.resolve(repoRoot, `.${target}`);
  return path.resolve(path.dirname(file), target);
}

function insideRepo(candidate) {
  return candidate === repoRoot || candidate.startsWith(repoRoot + path.sep);
}

function checkFile(file, links) {
  const text = fs.readFileSync(file, 'utf8');
  const relativeFile = path.relative(repoRoot, file).split(path.sep).join('/');
  let inFence = false;
  let fenceMarker = null;

  text.split(/\r?\n/).forEach((rawLine, index) => {
    // Fences must be detected before inline-code stripping: stripping turns
    // "```lang" into "`lang" and the opening fence would never match.
    const fence = rawLine.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      return;
    }
    if (inFence) return;

    const line = stripInlineCode(rawLine);
    const candidates = [];
    const inline = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
    let match;
    while ((match = inline.exec(line)) !== null) candidates.push(match[1]);

    const definition = line.match(/^\s{0,3}\[[^\]]+\]:\s*(\S+)/);
    if (definition) candidates.push(definition[1]);

    for (const candidate of candidates) {
      const target = localTarget(candidate);
      if (target === null) continue;
      links.scanned += 1;
      const resolved = resolveTarget(file, target);
      if (!insideRepo(resolved)) {
        links.missing.push({
          file: relativeFile,
          line: index + 1,
          target,
          reason: 'escapes the repository',
        });
      } else if (!fs.existsSync(resolved)) {
        links.missing.push({
          file: relativeFile,
          line: index + 1,
          target,
          reason: 'target does not exist',
        });
      }
    }
  });
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log(HELP);
    return 0;
  }

  const files = collectMarkdownFiles(repoRoot);
  const links = { scanned: 0, missing: [] };
  for (const file of files) checkFile(file, links);

  links.missing.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  const report = {
    tool: 'docs-links.mjs',
    mode: 'check',
    root: repoRoot,
    markdownFiles: files.length,
    links: links.scanned,
    broken: links.missing.length,
    status: links.missing.length === 0 ? 'pass' : 'fail',
    missing: links.missing,
    errors: [],
  };

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[docs-links] ${files.length} Markdown files, ${links.scanned} local links`);
    for (const item of links.missing) {
      console.log(`[docs-links] broken: ${item.file}:${item.line} -> ${item.target} (${item.reason})`);
    }
    console.log(`[docs-links] ${report.status === 'pass' ? 'pass' : `fail: ${report.broken} broken`}`);
  }

  return report.status === 'pass' ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`[docs-links] ${error.message}`);
    console.error(HELP);
    process.exitCode = 2;
  } else {
    console.error(`[docs-links] ${error?.stack ?? error}`);
    process.exitCode = 1;
  }
}
