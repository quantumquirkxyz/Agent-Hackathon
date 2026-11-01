#!/usr/bin/env node
// dependency-graph.mjs - Builds skill dependency graph, detects cycles, identifies central skills
// Usage: node dependency-graph.mjs [--format json|mermaid|dot] [--json]

import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const skillsRoot = path.join(root, '.agents', 'skills');

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const out = {};
  let active = null;
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const key = line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/);
    if (key) {
      active = key[1];
      out[active] = key[2] === '' || key[2] === '[]' ? [] : key[2].replace(/^["']|["']$/g, '');
      continue;
    }
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && active) {
      if (!Array.isArray(out[active])) out[active] = [];
      out[active].push(item[1].replace(/^["']|["']$/g, ''));
    }
  }
  return out;
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function collectSkills(dir, out = []) {
  if (!(await exists(dir))) return out;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'platform') continue;
    const child = path.join(dir, entry.name);
    const skillMd = path.join(child, 'SKILL.md');
    if (await exists(skillMd)) {
      const text = await fs.readFile(skillMd, 'utf8');
      const fm = parseFrontmatter(text);
      out.push({
        name: entry.name,
        path: path.relative(root, child).split(path.sep).join('/'),
        id: path.relative(root, child).split(path.sep).join('/'),
        category: fm.category || 'uncategorized',
        dependencies: Array.isArray(fm.dependencies) ? fm.dependencies : [],
        sideEffects: Array.isArray(fm.sideEffects) ? fm.sideEffects : [],
        risk: fm.risk || 'low',
        trustTier: fm.trustTier || '1',
      });
    } else {
      await collectSkills(child, out);
    }
  }
  return out;
}

function detectCycles(skills) {
  const indexes = buildIndexes(skills);
  const cycles = [];

  function dfs(node, visited, recStack, path) {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const skill = indexes.byId.get(node);
    if (skill) {
      for (const dep of skill.resolvedDependencies) {
        if (!visited.has(dep)) {
          dfs(dep, visited, recStack, path);
        } else if (recStack.has(dep)) {
          const cycleStart = path.indexOf(dep);
          cycles.push(path.slice(cycleStart).concat(dep));
        }
      }
    }

    path.pop();
    recStack.delete(node);
  }

  const visited = new Set();
  for (const skill of skills) {
    if (!visited.has(skill.id)) {
      dfs(skill.id, visited, new Set(), []);
    }
  }

  return cycles;
}

function buildIndexes(skills) {
  const byId = new Map(skills.map((skill) => [skill.id, skill]));
  const byName = new Map();
  for (const skill of skills) {
    const entries = byName.get(skill.name) ?? [];
    entries.push(skill);
    byName.set(skill.name, entries);
  }
  return { byId, byName };
}

function resolveDependency(reference, indexes) {
  const normalized = String(reference).replaceAll('\\', '/').replace(/^\.\//, '');
  if (indexes.byId.has(normalized)) return normalized;
  const matches = indexes.byName.get(normalized) ?? [];
  return matches.length === 1 ? matches[0].id : null;
}

function resolveDependencies(skills) {
  const indexes = buildIndexes(skills);
  for (const skill of skills) {
    skill.resolvedDependencies = [];
    skill.unresolvedDependencies = [];
    for (const dependency of skill.dependencies) {
      const resolved = resolveDependency(dependency, indexes);
      if (resolved) skill.resolvedDependencies.push(resolved);
      else skill.unresolvedDependencies.push(dependency);
    }
  }
  return indexes;
}

function findCentralSkills(skills, topN = 10) {
  const inDegree = new Map();
  const outDegree = new Map();

  for (const s of skills) {
    inDegree.set(s.id, 0);
    outDegree.set(s.id, 0);
  }

  for (const s of skills) {
    for (const dep of s.resolvedDependencies) {
      if (inDegree.has(dep)) {
        outDegree.set(s.id, (outDegree.get(s.id) || 0) + 1);
        inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
      }
    }
  }

  const scored = skills.map(s => ({
    id: s.id,
    name: s.name,
    category: s.category,
    inDegree: inDegree.get(s.id) || 0,
    outDegree: outDegree.get(s.id) || 0,
    centrality: (inDegree.get(s.id) || 0) + (outDegree.get(s.id) || 0),
  }));

  scored.sort((a, b) => b.centrality - a.centrality);
  return scored.slice(0, topN);
}

function generateMermaid(skills) {
  const lines = ['graph TD'];
  const nodeId = (id) => `n${Buffer.from(id).toString('base64url').replaceAll('-', '_')}`;
  for (const s of skills) {
    if (s.resolvedDependencies.length === 0) {
      lines.push(`  ${nodeId(s.id)}[${s.name}]`);
    } else {
      for (const dep of s.resolvedDependencies) {
        lines.push(`  ${nodeId(dep)} --> ${nodeId(s.id)}`);
      }
    }
  }
  return lines.join('\n');
}

function generateDot(skills) {
  const lines = ['digraph skills {', '  rankdir=LR;'];
  const nodeId = (id) => `n${Buffer.from(id).toString('base64url')}`;
  for (const s of skills) {
    lines.push(`  "${nodeId(s.id)}" [label="${s.name}\\n${s.category}"];`);
    for (const dep of s.resolvedDependencies) {
      lines.push(`  "${nodeId(dep)}" -> "${nodeId(s.id)}";`);
    }
  }
  lines.push('}');
  return lines.join('\n');
}

async function main() {
  const format = process.argv.includes('--format') ? process.argv[process.argv.indexOf('--format') + 1] : 'json';
  const asJson = process.argv.includes('--json');

  const skills = await collectSkills(skillsRoot);
  const indexes = resolveDependencies(skills);
  console.log(`[dependency-graph] Analyzing ${skills.length} skills...`);

  const cycles = detectCycles(skills);
  const central = findCentralSkills(skills);
  const incoming = new Set(skills.flatMap((skill) => skill.resolvedDependencies));
  const orphans = skills.filter(s => s.resolvedDependencies.length === 0 && !incoming.has(s.id));

  const result = {
    totalSkills: skills.length,
    totalDependencies: skills.reduce((sum, s) => sum + s.dependencies.length, 0),
    duplicateNames: [...indexes.byName.entries()]
      .filter(([, matches]) => matches.length > 1)
      .map(([name, matches]) => ({ name, ids: matches.map((skill) => skill.id) })),
    unresolvedDependencies: skills.flatMap((skill) => skill.unresolvedDependencies.map((dependency) => ({
      skill: skill.id,
      dependency,
    }))),
    nodes: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      path: skill.path,
      dependencies: skill.resolvedDependencies,
      unresolvedDependencies: skill.unresolvedDependencies,
    })),
    cycles: cycles.map(c => ({ path: c, length: c.length })),
    centralSkills: central,
    orphans: orphans.map(s => s.name),
    format: format === 'mermaid' ? generateMermaid(skills) : format === 'dot' ? generateDot(skills) : undefined,
  };

  if (asJson || format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (format === 'mermaid') {
    console.log(result.format);
  } else if (format === 'dot') {
    console.log(result.format);
  }

  if (cycles.length > 0) {
    console.error(`\n[WARN] ${cycles.length} cycle(s) detected:`);
    for (const c of cycles) {
      console.error(`  ${c.path.join(' -> ')}`);
    }
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
