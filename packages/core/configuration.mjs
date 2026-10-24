export const DEFAULT_PORT = 8787;
export const HOST = '127.0.0.1';
export const PROJECT_ROOT = new URL('../../', import.meta.url);

export function resolvePort(value = process.env.PORT) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) {
    throw Object.assign(new Error('PORT deve ser um inteiro entre 1 e 65535.'), { code: 'INVALID_PORT' });
  }
  return Number(value);
}

export function serverOrigin(port = resolvePort()) {
  return `http://${HOST}:${resolvePort(port)}`;
}

export function configurationWarnings(env) {
  const warnings = [];
  if (Boolean(env.GOOGLE_API_KEY) !== Boolean(env.GOOGLE_MODEL)) {
    warnings.push('Gemini incompleto: configure GOOGLE_API_KEY e GOOGLE_MODEL.');
  }
  if (env.OPENAI_ENABLED && !['true', 'false'].includes(env.OPENAI_ENABLED)) {
    warnings.push('OPENAI_ENABLED deve ser true ou false; OpenAI permanecerá desabilitada.');
  }
  if (env.OPENAI_ENABLED === 'true' && !env.OPENAI_API_KEY) {
    warnings.push('OpenAI habilitada sem OPENAI_API_KEY.');
  }
  for (const name of ['GEMINI_TIMEOUT_MS', 'OPENROUTER_TIMEOUT_MS', 'OPENAI_TIMEOUT_MS']) {
    if (env[name] && (!/^\d+$/.test(env[name]) || Number(env[name]) < 1000 || Number(env[name]) > 30000)) {
      warnings.push(`${name} inválido; será usado o timeout padrão.`);
    }
  }
  return warnings;
}
