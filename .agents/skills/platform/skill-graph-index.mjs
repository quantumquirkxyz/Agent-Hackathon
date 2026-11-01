// Deep module for skill-graph lifecycle, sources, persistence, and retrieval.
// Callers should use this interface instead of assembling graph internals.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildGraphFromSkills,
  collectSkills,
  graphPath,
  rank,
  neighbors,
  skillsFromManifest,
} from './skill-graph.mjs';

function fingerprint(skills) {
  return createHash('sha256')
    .update(JSON.stringify(skills.map(({ path, name, domain, capabilities, dependencies, compatibility, description, body }) => ({
      path, name, domain, capabilities, dependencies, compatibility, description, body,
    }))))
    .digest('hex');
}

export function filesystemSkillSource(root) {
  return { load: () => collectSkills(root) };
}

export function manifestSkillSource(manifest) {
  return { load: () => skillsFromManifest(manifest) };
}

export function memoryGraphStore(initial = null) {
  let value = initial;
  return {
    load: () => value,
    save: (graph) => { value = graph; },
  };
}

export function fileGraphStore(root) {
  return {
    load: () => {
      const file = graphPath(root);
      if (!existsSync(file)) return null;
      try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
    },
    save: (graph) => {
      const file = graphPath(root);
      mkdirSync(join(root, '.agents', 'skills', 'platform', 'graph'), { recursive: true });
      const persisted = { ...graph };
      delete persisted.generatedAt;
      writeFileSync(file, `${JSON.stringify(persisted, null, 2)}\n`);
      return file;
    },
  };
}

export function createSkillGraphIndex({ root = '.', source, store, fresh = false } = {}) {
  const graphSource = source ?? filesystemSkillSource(root);
  const graphStore = store ?? fileGraphStore(root);
  let graph = !fresh ? graphStore.load() : null;
  let sourceFingerprint = null;
  let refreshed = false;

  const refresh = () => {
    const skills = graphSource.load();
    graph = buildGraphFromSkills(skills);
    sourceFingerprint = fingerprint(skills);
    graphStore.save(graph);
    refreshed = true;
    return diagnostics();
  };

  const ensureGraph = () => {
    if (!graph) refresh();
    return graph;
  };

  const find = (query, options = {}) => {
    const limit = options.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      return { status: 'invalid-options', error: 'limit must be a positive integer' };
    }
    return rank(ensureGraph(), query, options);
  };

  const diagnostics = () => {
    const current = graph;
    return {
      status: current ? 'ready' : 'empty',
      refreshed,
      sourceFingerprint,
      nodeCount: current ? Object.keys(current.nodes).length : 0,
      edgeCount: current ? (current.edges || []).length : 0,
      graphVersion: current?.version ?? null,
    };
  };

  return Object.freeze({
    refresh,
    find,
    neighbors: (skill) => neighbors(ensureGraph(), skill),
    diagnostics,
  });
}
