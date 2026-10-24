export const DEFAULT_PROVIDER_TIMEOUTS_MS = Object.freeze({
  gemini: 4000,
  openrouter: 8000,
  openai: 6000,
});

const PROVIDER_TIMEOUT_ENV = Object.freeze({
  gemini: 'GEMINI_TIMEOUT_MS',
  openrouter: 'OPENROUTER_TIMEOUT_MS',
  openai: 'OPENAI_TIMEOUT_MS',
});

const MIN_PROVIDER_TIMEOUT_MS = 1000;
const MAX_PROVIDER_TIMEOUT_MS = 30000;

export function resolveProviderTimeoutMs(provider, configuredValue) {
  const defaultValue = DEFAULT_PROVIDER_TIMEOUTS_MS[provider];
  if (!defaultValue) throw new Error('UNKNOWN_AI_PROVIDER');

  const value = configuredValue ?? process.env[PROVIDER_TIMEOUT_ENV[provider]];
  if (value === undefined || value === null || String(value).trim() === '') return defaultValue;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= MIN_PROVIDER_TIMEOUT_MS && parsed <= MAX_PROVIDER_TIMEOUT_MS
    ? parsed
    : defaultValue;
}