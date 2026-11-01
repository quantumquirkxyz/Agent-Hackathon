// Pure, fail-closed policy decision for agent tool actions.
export const ACTION_TYPES = Object.freeze(['read', 'local-write', 'remote-write', 'deploy', 'merge', 'destructive']);
export const TRUST_LEVELS = Object.freeze(['trusted', 'untrusted']);
const privileged = new Set(['remote-write', 'deploy', 'merge', 'destructive']);

export function authorizeAction(request, grant = {}) {
  const deny = reason => ({ allowed: false, reason });
  if (!request || typeof request !== 'object' || Array.isArray(request)) return deny('invalid-request');
  const { action, resource, origin = 'untrusted' } = request;
  if (!ACTION_TYPES.includes(action)) return deny('unknown-action');
  if (typeof resource !== 'string' || !resource.trim()) return deny('missing-resource');
  if (!TRUST_LEVELS.includes(origin)) return deny('invalid-origin');
  if (!grant || typeof grant !== 'object' || Array.isArray(grant)) return deny('invalid-grant');
  if (!Array.isArray(grant.actions) || !grant.actions.includes(action)) return deny('missing-permission');
  if (!Array.isArray(grant.resources) || !grant.resources.includes(resource)) return deny('resource-not-allowed');
  if (origin === 'untrusted' && action !== 'read') return deny('untrusted-write');
  if (privileged.has(action)) {
    if (grant.approved !== true || grant.approvalId === undefined || typeof grant.approvalId !== 'string' || grant.approvalId.trim() === '') return deny('approval-required');
    if (typeof grant.approvedAction !== 'string' || grant.approvedAction !== action || grant.approvedResource !== resource) return deny('approval-mismatch');
  }
  return { allowed: true, reason: 'authorized' };
}
