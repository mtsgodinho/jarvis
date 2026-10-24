export class APIError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function createApiClient({ fetchImpl = globalThis.fetch, getCsrf = () => '' } = {}) {
  return async function request(path, data, { timeoutMs = 6000, signal, requestId } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const response = await fetchImpl(path, {
        method: data === undefined ? 'GET' : 'POST',
        credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: data === undefined ? {} : {
          'Content-Type': 'application/json', 'X-Jarvis-CSRF': getCsrf(),
          ...(requestId ? { 'X-Jarvis-Request-Id': requestId } : {}),
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      let result;
      try { result = await response.json(); }
      catch {
        if (controller.signal.aborted) throw new Error('ABORTED');
        throw new APIError('INVALID_RESPONSE', 'Resposta inválida do servidor. Verifique o endereço exibido pelo launcher.', response.status);
      }
      if (!response.ok) throw new APIError(result.code || 'REQUEST_FAILED', result.error || 'Falha na solicitação.', response.status);
      return result;
    } catch (error) {
      if (timedOut) throw new APIError('TIMEOUT', 'Tempo limite excedido. A operação pode estar sendo encerrada; não repita automaticamente.');
      if (signal?.aborted) throw new APIError('CANCELLED', 'Operação cancelada.');
      if (error instanceof APIError) throw error;
      throw new APIError('SERVER_UNAVAILABLE', 'Servidor local indisponível. Verifique se o launcher está aberto e use o endereço informado por ele.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  };
}
