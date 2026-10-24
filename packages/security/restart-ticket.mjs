import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const RESTART_COOKIE = 'jarvis_resume';
export const clearRestartCookie = `${RESTART_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/resume; Max-Age=0`;

export function createRestartTickets({ secret, generation, now = Date.now } = {}) {
  const consumed = new Set();
  const enabled = typeof secret === 'string' && secret.length >= 32 && Number.isSafeInteger(generation) && generation > 0;
  const signature = value => createHmac('sha256', secret).update(value).digest('base64url');
  return {
    enabled,
    issue() {
      if (!enabled) return null;
      const data = Buffer.from(JSON.stringify({
        generation: generation + 1, expiresAt: now() + 60000, nonce: randomBytes(24).toString('hex'),
      })).toString('base64url');
      return `${RESTART_COOKIE}=${data}.${signature(data)}; HttpOnly; SameSite=Strict; Path=/api/resume; Max-Age=60`;
    },
    consume(token) {
      if (!enabled || typeof token !== 'string' || token.length > 1024) return false;
      try {
        const [data, provided, extra] = token.split('.');
        if (extra || !data || !provided) return false;
        const expected = signature(data);
        if (provided.length !== expected.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return false;
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
        if (payload.generation !== generation || !Number.isFinite(payload.expiresAt) ||
            payload.expiresAt <= now() || payload.expiresAt > now() + 60000 ||
            !/^[a-f0-9]{48}$/.test(payload.nonce) || consumed.has(payload.nonce)) return false;
        consumed.add(payload.nonce);
        return true;
      } catch { return false; }
    },
  };
}
