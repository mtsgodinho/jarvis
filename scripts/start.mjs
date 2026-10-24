import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolvePort, configurationWarnings, PROJECT_ROOT } from '../packages/core/configuration.mjs';
import { diagnostic } from '../packages/core/diagnostics.mjs';

export async function preflight({ version = process.versions.node, resolve = createRequire(import.meta.url).resolve } = {}) {
  if (Number(version.split('.')[0]) < 22) {
    throw Object.assign(new Error('Requer Node.js 22 ou superior.'), { code: 'NODE_VERSION' });
  }
  for (const dependency of ['dotenv', '@google/genai', 'openai']) {
    try { resolve(dependency); }
    catch { throw Object.assign(new Error(`Dependência ausente: ${dependency}. Restaure as dependências com npm ci na pasta do projeto.`), { code: 'DEPENDENCY_MISSING' }); }
  }
  for (const file of ['apps/panel/index.html', 'apps/panel/app.js', 'apps/panel/api.js',
    'apps/panel/voice-session.js', 'apps/panel/voice-speech.js', 'apps/panel/style.css']) {
    try { await access(new URL(file, PROJECT_ROOT)); }
    catch { throw Object.assign(new Error(`Arquivo necessário ausente: ${file}.`), { code: 'ASSET_MISSING' }); }
  }
}

export async function main() {
  try {
    await preflight();
    const { default: dotenv } = await import('dotenv');
    const loaded = dotenv.config({ path: fileURLToPath(new URL('.env', PROJECT_ROOT)), quiet: true });
    if (loaded.error && loaded.error.code !== 'ENOENT') {
      throw Object.assign(new Error('Não foi possível ler a configuração .env.'), { code: 'ENV_UNREADABLE' });
    }
    const port = resolvePort();
    for (const warning of configurationWarnings(process.env)) console.warn(`[CONFIG] ${warning}`);
    const { startServer } = await import('../apps/local-server/server.mjs');
    await startServer({ port });
  } catch (error) {
    const known = ['NODE_VERSION', 'DEPENDENCY_MISSING', 'ASSET_MISSING', 'INVALID_PORT', 'ENV_UNREADABLE'];
    diagnostic('startup.failed', { code: known.includes(error.code) ? error.code : 'STARTUP_FAILED' });
    console.error(known.includes(error.code) ? error.message : 'Falha ao carregar o Jarvis. Verifique Node.js e a instalação das dependências.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
