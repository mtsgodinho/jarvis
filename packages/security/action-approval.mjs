import { randomBytes } from 'node:crypto';
import { validateLocalAction, localActionConfirmation } from '../contracts/local-actions.mjs';
import { findChromeProfile } from '../core/chrome-profiles.mjs';

export function canonicalAction(action, params = {}) {
  if (action === 'open_chrome') {
    if (!params || typeof params !== 'object' || Array.isArray(params) ||
        Object.keys(params).some(key => key !== 'profileName')) return null;
    if (params.profileName === undefined) return { action, params: {} };
    if (typeof params.profileName !== 'string') return null;
    const profile = findChromeProfile(params.profileName);
    return profile ? { action, params: { profileName: profile.name } } : null;
  }
  return validateLocalAction(action, params);
}

// Proposals contain canonical arguments only. Decisions never accept replacement arguments.
export function createActionApprovals({ now = Date.now, ttl = 60000, limit = 100 } = {}) {
  const records = new Map();
  function get(id, owner) {
    const item = records.get(id);
    if (!item || item.owner !== owner) throw new Error('APPROVAL_NOT_FOUND');
    if (item.state === 'pending' && now() >= item.expiresAt) item.state = 'expired';
    return item;
  }
  const snapshot = item => { const { owner, ...visible } = item; return structuredClone(visible); };
  return {
    create(owner, action, params, message) {
      const canonical = canonicalAction(action, params);
      if (!canonical) throw new Error('ACTION_NOT_ALLOWED');
      for (const [id, item] of records) if (item.expiresAt <= now() && item.state !== 'executing') records.delete(id);
      if (records.size >= limit) throw new Error('APPROVAL_LIMIT');
      const item = { id: randomBytes(24).toString('hex'), owner, kind: 'desktop.action',
        ...canonical, message, description: action === 'open_chrome'
          ? `Abrir Chrome${canonical.params.profileName ? ` no perfil ${canonical.params.profileName}` : ''}`
          : localActionConfirmation(action, canonical.params),
        state: 'pending', expiresAt: now() + ttl };
      records.set(item.id, item);
      return snapshot(item);
    },
    has(id) { return records.has(id); },
    list(owner) { return [...records.values()].filter(item => item.owner === owner).map(item => snapshot(get(item.id, owner))); },
    decide(id, owner, decision) {
      const item = get(id, owner);
      if (item.state !== 'pending') throw new Error('APPROVAL_NOT_PENDING');
      if (!['approve', 'reject'].includes(decision)) throw new Error('INVALID_DECISION');
      item.state = decision === 'approve' ? 'executing' : 'rejected';
      return snapshot(item);
    },
    finish(id, owner, result) {
      const item = get(id, owner);
      if (item.state !== 'executing') throw new Error('APPROVAL_NOT_EXECUTING');
      item.state = result.ok ? 'completed' : 'failed';
      item.execution = { status: result.status, verified: result.verified === true };
      return snapshot(item);
    },
    clear(owner) { for (const [id, item] of records) if (item.owner === owner) records.delete(id); },
    clearAll() { records.clear(); },
  };
}
