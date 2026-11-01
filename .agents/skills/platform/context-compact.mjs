// Deterministic context selection with provenance, freshness and hard-retain semantics.
function tokens(text) {
  return Math.max(1, Math.ceil(String(text ?? '').length / 4));
}
function validDate(value) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.valueOf();
}
export function compactContext(items, { maxTokens = 4000, now = Date.now(), allowSensitive = false } = {}) {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new RangeError('maxTokens must be a positive integer');
  if (!Array.isArray(items)) throw new TypeError('items must be an array');
  const normalized = items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new TypeError('context item must be an object');
    const id = String(item.id ?? 'item-' + index);
    const text = String(item.text ?? '');
    const priority = Number.isFinite(item.priority) ? Number(item.priority) : 0;
    const expiresAt = validDate(item.expiresAt);
    const revoked = item.revoked === true;
    const sensitive = item.sensitive === true;
    const mustRetain = item.mustRetain === true;
    const provenance = typeof item.provenance === 'string' && item.provenance.trim() ? item.provenance.trim() : null;
    const freshness = validDate(item.freshness) ?? 0;
    return { id, text, priority, expiresAt, revoked, sensitive, mustRetain, provenance, freshness, estimatedTokens: tokens(text), index };
  });
  const dropped = [];
  const eligible = [];
  for (const item of normalized) {
    if (item.revoked) { dropped.push({ id: item.id, reason: 'revoked' }); continue; }
    if (item.expiresAt !== null && item.expiresAt <= now) { dropped.push({ id: item.id, reason: 'expired' }); continue; }
    if (item.sensitive && !allowSensitive) { dropped.push({ id: item.id, reason: 'sensitive' }); continue; }
    eligible.push(item);
  }
  const required = eligible.filter(x => x.mustRetain);
  const requiredTokens = required.reduce((sum, x) => sum + x.estimatedTokens, 0);
  if (requiredTokens > maxTokens) {
    throw new Error('must-retain context exceeds budget');
  }
  const selected = [...required];
  let used = requiredTokens;
  const optional = eligible.filter(x => !x.mustRetain).sort((a,b) =>
    (b.priority - a.priority) || (b.freshness - a.freshness) || a.id.localeCompare(b.id) || (a.index - b.index)
  );
  for (const item of optional) {
    if (!item.provenance) { dropped.push({ id: item.id, reason: 'missing-provenance' }); continue; }
    if (used + item.estimatedTokens <= maxTokens) {
      selected.push(item); used += item.estimatedTokens;
    } else dropped.push({ id: item.id, reason: 'budget' });
  }
  selected.sort((a,b) => a.index - b.index);
  dropped.sort((a,b) => a.id.localeCompare(b.id) || a.reason.localeCompare(b.reason));
  return {
    selected: selected.map(({ index, ...rest }) => rest),
    dropped,
    estimatedTokens: used,
    maxTokens,
  };
}
