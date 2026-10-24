import { decide } from '../security/policy.mjs';
export function dispatch(action) {
  const decision = decide(action);
  if (decision === 'deny') return { ok: false, code: 'DENIED' };
  if (decision === 'approval') return { ok: false, code: 'NOT_IMPLEMENTED', approvalRequired: true };
  return { ok: true, mode: 'skeleton', externalActions: false };
}
