import crypto from 'node:crypto';

function encode(value) {
  return Buffer.from(value).toString('base64url');
}
function decode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}
function secretBuffer(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new Error('Approval secret must contain at least 32 bytes');
  }
  return Buffer.from(secret);
}
function signature(body, secret) {
  return crypto.createHmac('sha256', secretBuffer(secret)).update(body).digest('base64url');
}

export function issueApproval({ approvalId, tool, resource = null, expiresAt }, secret) {
  if (typeof approvalId !== 'string' || !approvalId.trim()) throw new Error('approvalId is required');
  if (typeof tool !== 'string' || !tool.trim()) throw new Error('tool is required');
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error('expiresAt must be a future epoch-millisecond integer');
  if (resource !== null && (typeof resource !== 'string' || !resource.trim())) throw new Error('resource must be null or a non-empty string');
  const payload = { v: 1, approvalId, tool, resource, expiresAt };
  const body = encode(JSON.stringify(payload));
  return body + '.' + signature(body, secret);
}

export function verifyApproval(token, { tool, resource = null, now = Date.now() }, secret) {
  try {
    if (typeof token !== 'string') return { ok: false, reason: 'missing-token' };
    const [body, supplied, extra] = token.split('.');
    if (!body || !supplied || extra !== undefined) return { ok: false, reason: 'malformed-token' };
    const expected = signature(body, secret);
    const a = Buffer.from(supplied);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'invalid-signature' };
    const payload = JSON.parse(decode(body));
    if (payload.v !== 1) return { ok: false, reason: 'unsupported-version' };
    if (!Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= now) return { ok: false, reason: 'expired' };
    if (payload.tool !== tool) return { ok: false, reason: 'tool-mismatch' };
    if ((payload.resource ?? null) !== (resource ?? null)) return { ok: false, reason: 'resource-mismatch' };
    if (typeof payload.approvalId !== 'string' || !payload.approvalId.trim()) return { ok: false, reason: 'missing-approval-id' };
    return { ok: true, approvalId: payload.approvalId, expiresAt: payload.expiresAt };
  } catch {
    return { ok: false, reason: 'verification-error' };
  }
}
