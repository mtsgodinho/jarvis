export const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
import { DEFAULT_PROVIDER_TIMEOUTS_MS } from './timeouts.mjs';

export const AI_PROVIDER_TIMEOUT_MS = DEFAULT_PROVIDER_TIMEOUTS_MS.openrouter;

function log(logger, level, message) {
  try {
    logger?.[level]?.(message);
  } catch {}
}

function safeIdentifier(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return 'não informado';
  const raw = String(value);
  if (/(?:sk-or-v1-|sk-|AIza)[A-Za-z0-9_-]{8,}|Bearer\s+\S+/i.test(raw)) return '[redacted]';
  const safe = raw.replace(/[^a-zA-Z0-9._:/-]/g, '').slice(0, 120);
  return safe || 'não informado';
}

function isFreeRouterModel(model) {
  return typeof model === 'string' && /(?:^|[/:])free(?:$|[/:])/i.test(model);
}

function hasReasoning(data) {
  return Array.isArray(data?.choices) && data.choices.some(choice => {
    const message = choice?.message;
    return [message, choice].some(source => source &&
      ['reasoning', 'reasoning_content'].some(field => Object.hasOwn(source, field) && source[field] != null));
  });
}

function extractTextContent(choice) {
  const content = choice?.message?.content;
  if (typeof content === 'string') return { text: content, source: 'message.content' };
  if (Array.isArray(content)) {
    const parts = content
      .filter(part => part && typeof part === 'object' && typeof part.text === 'string' &&
        (part.type === undefined || part.type === 'text'))
      .map(part => part.text);
    if (parts.length) return { text: parts.join(''), source: 'message.content[]' };
  }
  if (typeof choice?.text === 'string') return { text: choice.text, source: 'choice.text' };
  return { text: null, source: 'missing' };
}

function responseBodyKind(text) {
  const trimmed = text.trimStart();
  if (!trimmed) return 'empty';
  if (trimmed.startsWith('{')) return 'object-like';
  if (trimmed.startsWith('[')) return 'array-like';
  if (trimmed.startsWith('<')) return 'markup-like';
  return 'text-like';
}

function buildOpenRouterRequestBody({ model, systemPrompt, messages }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    max_tokens: 1024,
  };

  if (isFreeRouterModel(model)) {
    return body;
  }

  return {
    ...body,
    provider: { require_parameters: true },
    reasoning: { effort: 'none', exclude: true },
    response_format: { type: 'json_object' },
  };
}

function logResponseShape(logger, data) {
  const choices = data?.choices;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
  const message = firstChoice?.message;
  const { text: content, source } = extractTextContent(firstChoice);
  const contentPresent = content !== undefined && content !== null;
  const contentType = contentPresent ? typeof content : 'ausente';
  const contentLength = typeof content === 'string' ? content.length : 'não textual';

  log(logger, 'info', `[AI] OpenRouter modelo efetivo: ${safeIdentifier(data?.model)}`);
  log(logger, 'info', `[AI] finish_reason: ${safeIdentifier(firstChoice?.finish_reason)}`);
  log(logger, 'info', `[AI] choices presentes: ${Array.isArray(choices)}`);
  log(logger, 'info', `[AI] choices: ${Array.isArray(choices) ? choices.length : 0}`);
  log(logger, 'info', `[AI] message presente: ${message !== undefined && message !== null}`);
  log(logger, 'info', `[AI] content presente: ${contentPresent}`);
  log(logger, 'info', `[AI] content tipo: ${contentType}`);
  log(logger, 'info', `[AI] content tamanho: ${contentLength}`);
  log(logger, 'info', `[AI] fonte do conteúdo: ${source}`);
  log(logger, 'info', `[AI] reasoning presente: ${hasReasoning(data)}`);
}

export async function generateOpenRouterResponse({
  messages,
  systemPrompt,
  apiKey,
  model = DEFAULT_OPENROUTER_MODEL,
  fetchImpl = fetch,
  logger = console,
  signal,
  timeoutMs = AI_PROVIDER_TIMEOUT_MS,
}) {
  const requestSignal = signal ?? AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetchImpl(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildOpenRouterRequestBody({ model, systemPrompt, messages })),
      signal: requestSignal,
    });
  } catch (error) {
    if (requestSignal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
    log(logger, 'warn', `[AI] OpenRouter error.code: ${safeIdentifier(error?.code)}`);
    log(logger, 'warn', `[AI] OpenRouter error.message seguro: falha de transporte (${safeIdentifier(error?.name)})`);
    throw error;
  }
  log(logger, 'info', `[AI] OpenRouter HTTP ${response.status}`);
  const contentType = safeIdentifier(response.headers?.get?.('content-type')?.split(';')[0]);
  let rawBody;
  try {
    rawBody = await response.text();
  } catch (error) {
    if (requestSignal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
    log(logger, 'warn', `[AI] OpenRouter corpo indisponível; content-type: ${contentType}`);
    const bodyError = new Error('OpenRouter response body is unavailable');
    bodyError.code = 'INVALID_API_RESPONSE';
    bodyError.status = response.status;
    throw bodyError;
  }
  log(logger, 'info', `[AI] OpenRouter content-type: ${contentType}`);
  log(logger, 'info', `[AI] OpenRouter corpo bytes: ${Buffer.byteLength(rawBody, 'utf8')}`);
  log(logger, 'info', `[AI] OpenRouter corpo formato: ${responseBodyKind(rawBody)}`);

  let data;
  try {
    data = JSON.parse(rawBody);
  } catch {
    if (requestSignal.aborted) {
      const error = new Error('OpenRouter response body read aborted');
      error.name = 'AbortError';
      throw error;
    }
    log(logger, 'warn', '[AI] OpenRouter resposta rejeitada com segurança: corpo HTTP não é JSON válido');
    const error = new Error('Invalid OpenRouter API response');
    error.code = 'INVALID_API_RESPONSE';
    error.status = response.status;
    throw error;
  }

  logResponseShape(logger, data);
  if (data?.error !== undefined && data.error !== null) {
    if (typeof data.error === 'object') {
      log(logger, 'warn', `[AI] OpenRouter error.code: ${safeIdentifier(data.error.code)}`);
      if (typeof data.error.message === 'string') {
        log(logger, 'warn', '[AI] OpenRouter error.message seguro: mensagem do provider omitida');
      }
    } else {
      log(logger, 'warn', '[AI] OpenRouter error presente com formato não padronizado');
    }
    if (response.ok) {
      log(logger, 'warn', '[AI] OpenRouter error.message seguro: mensagem do provider omitida');
      const error = new Error('OpenRouter returned an API error envelope');
      error.code = 'PROVIDER_API_ERROR';
      error.status = response.status;
      throw error;
    }
  }
  if (!response.ok) {
    log(logger, 'warn', '[AI] OpenRouter resposta rejeitada com segurança: erro HTTP');
    const error = new Error('OpenRouter request failed');
    error.status = response.status;
    throw error;
  }

  const { text } = extractTextContent(data?.choices?.[0]);
  if (typeof text !== 'string' || !text.trim()) {
    const reason = text === undefined || text === null ? 'content ausente' : typeof text !== 'string' ? 'content não textual' : 'content vazio';
    log(logger, 'warn', `[AI] OpenRouter resposta rejeitada com segurança: ${reason}`);
    const error = new Error('OpenRouter content is unavailable');
    error.code = text === undefined || text === null ? 'EMPTY_RESPONSE' : 'INVALID_STRUCTURED_RESPONSE';
    error.status = response.status;
    throw error;
  }
  return { text: text.trim(), model: typeof data.model === 'string' ? data.model : undefined };
}
