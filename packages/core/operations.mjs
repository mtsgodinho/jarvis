import { createHash, randomUUID } from 'node:crypto';
import { abortable, diagnostic, operationError, throwIfAborted } from './diagnostics.mjs';

export function createOperations({ timeoutMs = 25000, logger = console } = {}) {
  const active = new Map();
  const recent = new Map();
  const workTasks = new Set();
  let closing = false;

  function prune() {
    for (const [key, record] of recent) if (record.expiresAt <= Date.now()) recent.delete(key);
  }
  function cancel(owner, id) {
    const record = active.get(owner);
    if (!record || (id && record.id !== id)) return false;
    record.controller.abort(operationError('CANCELLED'));
    return true;
  }
  return {
    list(owner) {
      const record = active.get(owner);
      return record ? [{ id: record.id, state: 'running', action: record.action, startedAt: record.startedAt }] : [];
    },
    cancel,
    clear(owner) {
      cancel(owner);
      for (const [key, record] of recent) if (record.owner === owner) recent.delete(key);
    },
    async run(owner, requestId, message, work) {
      if (closing) throw operationError('SERVER_STOPPING');
      prune();
      const key = requestId ? `${owner}:${requestId}` : null;
      const digest = createHash('sha256').update(message).digest('hex');
      const existing = key && recent.get(key);
      if (existing) {
        if (existing.digest !== digest) throw operationError('IDEMPOTENCY_CONFLICT');
        return existing.promise;
      }
      if (active.has(owner)) throw operationError('ACTION_BUSY');
      if (recent.size >= 200) throw operationError('ACTION_LIMIT');
      const record = { id: randomUUID(), owner, action: null, startedAt: Date.now(), controller: new AbortController() };
      active.set(owner, record);
      diagnostic('operation.started', { operationId: record.id }, logger);
      const timer = setTimeout(() => record.controller.abort(operationError('TIMEOUT')), timeoutMs);
      const signal = record.controller.signal;
      const task = Promise.resolve().then(() => {
        throwIfAborted(signal);
        return work({
        id: record.id, signal,
        check: () => throwIfAborted(signal),
        setAction: action => { record.action = action; },
        });
      });
      workTasks.add(task);
      task.then(() => workTasks.delete(task), () => workTasks.delete(task));
      const promise = abortable(task, signal).then(result => {
        throwIfAborted(signal);
        diagnostic('operation.finished', { operationId: record.id, state: result.status >= 400 ? 'failed' : 'completed', durationMs: Date.now() - record.startedAt }, logger);
        return { ...result, operationId: record.id };
      }, error => {
        diagnostic('operation.finished', { operationId: record.id, state: signal.aborted ? 'cancelled' : 'failed', durationMs: Date.now() - record.startedAt }, logger);
        throw error;
      }).finally(() => {
        clearTimeout(timer);
        if (active.get(owner) === record) active.delete(owner);
      });
      if (key) recent.set(key, { owner, digest, promise, expiresAt: Date.now() + 300000 });
      return promise;
    },
    stop() {
      closing = true;
      for (const owner of active.keys()) cancel(owner);
      recent.clear();
    },
    async drain() {
      // Native processes and providers honor the abort signal. Allow atomic
      // memory writes already started to finish, without waiting forever for a
      // defective adapter that ignores cancellation.
      let timer;
      try {
        await Promise.race([
          Promise.allSettled([...workTasks]),
          new Promise(resolve => { timer = setTimeout(resolve, 2000); }),
        ]);
      } finally { clearTimeout(timer); }
    },
  };
}
