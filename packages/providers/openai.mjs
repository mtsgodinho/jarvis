import OpenAI from 'openai';
import { DEFAULT_PROVIDER_TIMEOUTS_MS, resolveProviderTimeoutMs } from './timeouts.mjs';

export const DEFAULT_OPENAI_MODEL = 'gpt-6-sol';
export const AI_PROVIDER_TIMEOUT_MS = DEFAULT_PROVIDER_TIMEOUTS_MS.openai;

export async function generateOpenAIResponse({ messages, systemPrompt, apiKey, model, signal,
  timeoutMs = resolveProviderTimeoutMs('openai'), clientFactory = options => new OpenAI(options) }) {
  const client = clientFactory({
    apiKey,
    timeout: timeoutMs,
    maxRetries: 0,
    logLevel: 'off',
  });
  const response = await client.responses.create({
    model,
    instructions: systemPrompt,
    input: [{ role: 'developer', content: 'Responda em JSON.' }, ...messages],
    max_output_tokens: 512,
    text: { format: { type: 'json_object' } },
  }, { signal });
  if ((response.status && response.status !== 'completed') ||
      typeof response.output_text !== 'string' || !response.output_text.trim()) {
    const error = new Error('EMPTY_RESPONSE');
    error.code = 'EMPTY_RESPONSE';
    throw error;
  }
  return response.output_text.trim();
}
