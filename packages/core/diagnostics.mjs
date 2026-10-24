// Fixed events and allowlisted metadata only. Never pass messages, params, env,
// cookies, process arguments, provider bodies or arbitrary error objects here.
export function diagnostic(event, fields = {}, logger = console) {
  const record = { time: new Date().toISOString(), event };
  for (const key of ['operationId', 'action', 'state', 'code', 'port', 'durationMs', 'exitCode', 'count', 'stage', 'exceptionType', 'hresult']) {
    if (fields[key] !== undefined) record[key] = fields[key];
  }
  try { logger.info(JSON.stringify(record)); } catch {}
}

export function operationError(code) {
  return Object.assign(new Error(code), { code });
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || operationError('CANCELLED');
}

export async function abortable(promise, signal) {
  throwIfAborted(signal);
  if (!signal) return promise;
  let abort;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        abort = () => reject(signal.reason || operationError('CANCELLED'));
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
