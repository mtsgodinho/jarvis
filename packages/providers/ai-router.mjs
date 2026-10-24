import { JARVIS_SYSTEM_INSTRUCTIONS } from './system-instructions.mjs';
import { resolveProviderTimeoutMs } from './timeouts.mjs';
import { abortable, throwIfAborted } from '../core/diagnostics.mjs';

const temporaryStatuses = new Set([408, 409, 425, 429]);
const recoverableNetworkCodes = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT',
]);
const timeoutNames = new Set(['APIConnectionTimeoutError', 'TimeoutError', 'RequestTimeoutError', 'AbortError']);

export class AIProviderFailure extends Error {
  constructor(code) {
    super(code);
    this.name = 'AIProviderFailure';
    this.code = code;
  }
}

function getStatus(error) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function classifyFailure(error) {
  const status = getStatus(error);
  if (status !== null && (temporaryStatuses.has(status) || status >= 500)) {
    return { temporary: true, label: `HTTP ${status}` };
  }
  if (timeoutNames.has(error?.name) || error?.code === 'EMPTY_RESPONSE' ||
      error?.code === 'INVALID_JSON_RESPONSE' || error?.code === 'INVALID_STRUCTURED_RESPONSE') {
    const label = error?.code === 'EMPTY_RESPONSE' ? 'resposta vazia'
      : error?.code === 'INVALID_JSON_RESPONSE' ? 'JSON inválido'
        : error?.code === 'INVALID_STRUCTURED_RESPONSE' ? 'JSON incompatível com o contrato' : 'timeout';
    return { temporary: true, label };
  }
  if (error?.name === 'APIConnectionError' || recoverableNetworkCodes.has(error?.code) ||
      recoverableNetworkCodes.has(error?.cause?.code)) {
    return { temporary: true, label: 'erro de rede' };
  }
  return { temporary: false, status };
}

function log(logger, level, message) {
  try {
    logger?.[level]?.(message);
  } catch {}
}

function safeFailureLabel(failure) {
  return failure.status === null ? '' : ` (HTTP ${failure.status})`;
}

function createTimeoutError() {
  const error = new Error('AI provider attempt timed out');
  error.code = 'PROVIDER_TIMEOUT';
  return error;
}

async function runProviderAttempt(timeoutMs, operation, parentSignal) {
  throwIfAborted(parentSignal);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(parentSignal.reason);
  parentSignal?.addEventListener('abort', forwardAbort, { once: true });
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(createTimeoutError());
    }, timeoutMs);
  });
  try {
    const response = await abortable(Promise.race([
      Promise.resolve().then(() => operation({ signal: controller.signal, timeoutMs })),
      timeoutPromise,
    ]), parentSignal);
    throwIfAborted(parentSignal);
    if (controller.signal.aborted) throw createTimeoutError();
    return response;
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', forwardAbort);
  }
}

function isSafePlainTextReply(text) {
  return !/[{}\[\]`]/.test(text) &&
    !/^\s*</.test(text) &&
    !/(?:<think>|\b(?:internal analysis|private reasoning|chain of thought)\b|\bI should reason\b|\breason this out privately\b)/i.test(text) &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text);
}

function normalizeProviderResponse(response, { allowPlainTextReply = false } = {}) {
  const text = typeof response === 'string' ? response : response?.text;
  if (typeof text !== 'string' || !text.trim()) {
    const error = new Error('EMPTY_RESPONSE');
    error.code = 'EMPTY_RESPONSE';
    throw error;
  }

  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  let parsed;
  try {
    parsed = JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    if (allowPlainTextReply && isSafePlainTextReply(trimmed)) {
      parsed = { type: 'reply', reply: trimmed };
    } else {
    const error = new Error('Provider output is not valid JSON');
    error.code = 'INVALID_JSON_RESPONSE';
    throw error;
    }
  }

  const isObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  const isReply = isObject && parsed.type === 'reply' && typeof parsed.reply === 'string' && parsed.reply.trim() &&
    Object.keys(parsed).length === 2 && Object.hasOwn(parsed, 'reply');
  const isAction = isObject && parsed.type === 'action' && typeof parsed.action === 'string' &&
    parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params) &&
    Object.keys(parsed).length === 3 && Object.hasOwn(parsed, 'action') && Object.hasOwn(parsed, 'params');
  if (!isReply && !isAction) {
    const error = new Error('INVALID_STRUCTURED_RESPONSE');
    error.code = 'INVALID_STRUCTURED_RESPONSE';
    throw error;
  }
  return { text: JSON.stringify(parsed), model: typeof response === 'object' ? response.model : undefined };
}

function safeModelName(model) {
  if (typeof model === 'string' && /(?:sk-|AIza|Bearer\s)/i.test(model)) return '[redacted]';
  return typeof model === 'string' ? model.replace(/[^a-zA-Z0-9._:/-]/g, '').slice(0, 100) : '';
}

export function createAIResponseRouter({
  openaiProvider,
  geminiProvider,
  openrouterProvider,
  openaiApiKey,
  openaiModel,
  openaiEnabled = false,
  openrouterApiKey,
  openrouterModel,
  geminiApiKey,
  geminiModel,
  geminiFallbackModels = [],
  geminiTimeoutMs: configuredGeminiTimeoutMs,
  openrouterTimeoutMs: configuredOpenrouterTimeoutMs,
  openaiTimeoutMs: configuredOpenaiTimeoutMs,
  logger = console,
}) {
  const geminiTimeoutMs = resolveProviderTimeoutMs('gemini', configuredGeminiTimeoutMs);
  const openrouterTimeoutMs = resolveProviderTimeoutMs('openrouter', configuredOpenrouterTimeoutMs);
  const openaiTimeoutMs = resolveProviderTimeoutMs('openai', configuredOpenaiTimeoutMs);
  const isOpenAIEnabled = openaiEnabled === true || openaiEnabled === 'true';
  const openaiConfigured = Boolean(isOpenAIEnabled && openaiApiKey && openaiModel);
  const openrouterConfigured = Boolean(openrouterApiKey && openrouterModel);
  const geminiConfigured = Boolean(geminiApiKey && geminiModel);
  const geminiModels = [...new Set([geminiModel, ...geminiFallbackModels].filter(Boolean))];
  const geminiAttemptLimit = openrouterConfigured ? 1 : 2;

  async function callGemini(messages, systemPrompt, signal) {
    if (!geminiConfigured) throw new AIProviderFailure('AI_TEMPORARILY_UNAVAILABLE');
    const attempts = geminiModels.slice(0, geminiAttemptLimit);
    for (let index = 0; index < attempts.length; index++) {
      const model = attempts[index];
      const start = Date.now();
      log(logger, 'info', `[AI] tentando Gemini: ${safeModelName(model)}`);
      try {
        const response = await runProviderAttempt(geminiTimeoutMs, ({ signal, timeoutMs }) => geminiProvider.generateResponse({
          messages,
          systemPrompt,
          apiKey: geminiApiKey,
          model,
          signal,
          timeoutMs,
        }), signal);
        const { text } = normalizeProviderResponse(response);
        log(logger, 'info', `[AI] Gemini respondeu em ${Date.now() - start}ms`);
        return { text: text.trim(), provider: 'gemini' };
      } catch (error) {
        throwIfAborted(signal);
        const failure = classifyFailure(error);
        const elapsed = Date.now() - start;
        if (error?.code === 'PROVIDER_TIMEOUT') {
          log(logger, 'warn', `[AI] Gemini timeout de ${geminiTimeoutMs}ms em ${elapsed}ms`);
          if (index === attempts.length - 1) throw new AIProviderFailure('AI_TEMPORARILY_UNAVAILABLE');
          continue;
        }
        if (!failure.temporary) {
          log(logger, 'warn', `[AI] Gemini falhou${safeFailureLabel(failure)} em ${elapsed}ms`);
          throw new AIProviderFailure('GEMINI_CONFIGURATION');
        }
        log(logger, 'warn', `[AI] Gemini falhou (${failure.label}) em ${elapsed}ms`);
        if (index === attempts.length - 1) throw new AIProviderFailure('AI_TEMPORARILY_UNAVAILABLE');
      }
    }
    throw new AIProviderFailure('AI_TEMPORARILY_UNAVAILABLE');
  }

  async function generateResponse({ message, history = [], memoryContext = '', signal }) {
    throwIfAborted(signal);
    let configurationFailure;
    const systemPrompt = memoryContext ? `${JARVIS_SYSTEM_INSTRUCTIONS}${memoryContext}` : JARVIS_SYSTEM_INSTRUCTIONS;
    const messages = [
      ...history.map(({ role, text }) => ({
        role: role === 'model' || role === 'assistant' ? 'assistant' : 'user',
        content: text,
      })),
      { role: 'user', content: message },
    ];

    let hadConfiguredProvider = false;
    if (geminiConfigured) {
      hadConfiguredProvider = true;
      try {
        return await callGemini(messages, systemPrompt, signal);
      } catch (error) {
        throwIfAborted(signal);
        if (!(error instanceof AIProviderFailure)) throw error;
        if(error.code==='GEMINI_CONFIGURATION')configurationFailure=error.code;
      }
    } else {
      log(logger, 'warn', '[AI] Gemini falhou (não configurado)');
    }

    if (openrouterConfigured) {
      hadConfiguredProvider = true;
      const start = Date.now();
      log(logger, 'info', `[AI] tentando OpenRouter: ${safeModelName(openrouterModel)}`);
      try {
        const response = await runProviderAttempt(openrouterTimeoutMs, ({ signal, timeoutMs }) => openrouterProvider.generateResponse({
          messages,
          systemPrompt,
          apiKey: openrouterApiKey,
          model: openrouterModel,
          logger,
          signal,
          timeoutMs,
        }), signal);
        const normalized = normalizeProviderResponse(response, { allowPlainTextReply: true });
        const effectiveModel = safeModelName(normalized.model || openrouterModel);
        log(logger, 'info', `[AI] OpenRouter respondeu: ${effectiveModel || 'modelo não informado'} em ${Date.now() - start}ms`);
        return { text: normalized.text, provider: 'openrouter' };
      } catch (error) {
        throwIfAborted(signal);
        const failure = classifyFailure(error);
        if (error?.code === 'PROVIDER_TIMEOUT') {
          log(logger, 'warn', `[AI] OpenRouter timeout de ${openrouterTimeoutMs}ms em ${Date.now() - start}ms`);
        } else if (!failure.temporary) {
          configurationFailure='OPENROUTER_CONFIGURATION';
          log(logger, 'warn', `[AI] OpenRouter falhou${safeFailureLabel(failure)} em ${Date.now() - start}ms`);
        } else {
          log(logger, 'warn', `[AI] OpenRouter falhou (${failure.label}) em ${Date.now() - start}ms`);
        }
      }
    } else {
      log(logger, 'warn', '[AI] OpenRouter indisponível (não configurado)');
    }

    if (!isOpenAIEnabled) {
      log(logger, 'info', '[AI] OpenAI desabilitada');
    } else if (openaiConfigured) {
      hadConfiguredProvider = true;
      log(logger, 'info', `[AI] tentando OpenAI: ${safeModelName(openaiModel)}`);
      const start = Date.now();
      try {
        const response = await runProviderAttempt(openaiTimeoutMs, ({ signal, timeoutMs }) => openaiProvider.generateResponse({
          messages,
          systemPrompt,
          apiKey: openaiApiKey,
          model: openaiModel,
          signal,
          timeoutMs,
        }), signal);
        const { text } = normalizeProviderResponse(response);
        log(logger, 'info', '[AI] OpenAI respondeu');
        return { text: text.trim(), provider: 'openai' };
      } catch (error) {
        throwIfAborted(signal);
        const failure = classifyFailure(error);
        if (error?.code === 'PROVIDER_TIMEOUT') {
          log(logger, 'warn', `[AI] OpenAI timeout de ${openaiTimeoutMs}ms em ${Date.now() - start}ms`);
        } else if (!failure.temporary) {
          configurationFailure='OPENAI_CONFIGURATION';
          log(logger, 'warn', `[AI] OpenAI falhou${safeFailureLabel(failure)}`);
        } else {
          log(logger, 'warn', `[AI] OpenAI falhou (${failure.label})`);
        }
      }
    } else {
      log(logger, 'warn', '[AI] OpenAI indisponível (não configurada)');
    }

    throw new AIProviderFailure(configurationFailure || (hadConfiguredProvider ? 'AI_TEMPORARILY_UNAVAILABLE' : 'AI_NOT_CONFIGURED'));
  }

  return {
    generateResponse,
    status: { openaiConfigured, openaiEnabled: isOpenAIEnabled, openrouterConfigured, geminiConfigured },
  };
}
