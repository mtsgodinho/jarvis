import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { DEFAULT_PORT, resolvePort, serverOrigin, configurationWarnings } from '../packages/core/configuration.mjs';
import { preflight } from '../scripts/start.mjs';
import { processEnvironment } from '../packages/security/process-environment.mjs';
import { createRestartTickets } from '../packages/security/restart-ticket.mjs';
import { createOperations } from '../packages/core/operations.mjs';
import { createProcessManager } from '../packages/desktop/processes.mjs';
import { operationError } from '../packages/core/diagnostics.mjs';
import { createAIResponseRouter } from '../packages/providers/ai-router.mjs';
import { runDesktopAction } from '../packages/desktop/index.mjs';

const quiet = { info() {}, warn() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('porta centralizada recusa configuração inválida sem mudar silenciosamente de porta', () => {
  assert.equal(DEFAULT_PORT, 8787);
  assert.equal(resolvePort(''), DEFAULT_PORT);
  assert.equal(resolvePort('8789'), 8789);
  assert.equal(serverOrigin(8788), 'http://127.0.0.1:8788');
  for (const value of ['abc', '-1', '0', '65536', '8787.5', ' 8787', Infinity]) {
    assert.throws(() => resolvePort(value), error => error.code === 'INVALID_PORT');
  }
});

test('preflight distingue Node antigo e dependência ausente sem instalar ou importar SDK', async () => {
  await assert.rejects(preflight({ version: '20.0.0', resolve: () => {} }), { code: 'NODE_VERSION' });
  await assert.rejects(preflight({ version: '22.0.0', resolve: name => {
    if (name === 'openai') throw new Error('private error must not escape');
  } }), error => error.code === 'DEPENDENCY_MISSING' && error.message.includes('openai') && !error.message.includes('private'));
  await preflight({ version: '22.0.0', resolve: () => 'present' });
  const warnings = configurationWarnings({
    GOOGLE_API_KEY: 'fixture-value-not-real', OPENAI_ENABLED: 'invalid-fixture', GEMINI_TIMEOUT_MS: '999999',
  }).join('\n');
  assert.match(warnings, /Gemini incompleto/);
  assert.doesNotMatch(warnings, /fixture-value|invalid-fixture|999999/);
});

test('ambiente de subprocessos é allowlist, sem chaves, tokens, preload ou duplicatas de PATH', () => {
  const env = {
    Path: 'system-path', PATH: 'duplicate', SystemRoot: 'C:\\Windows', TEMP: 'temp-path',
    USERPROFILE: 'home', APPDATA: 'roaming', LOCALAPPDATA: 'local', ProgramFiles: 'programs',
    OPENAI_API_KEY: 'fixture', GOOGLE_API_KEY: 'fixture', OPENROUTER_API_KEY: 'fixture',
    JARVIS_ACCESS_CODE: 'fixture', JARVIS_RESTART_SECRET: 'fixture', AWS_SECRET_ACCESS_KEY: 'fixture',
    LIVEKIT_API_SECRET: 'fixture', NODE_OPTIONS: '--require unsafe', HTTP_PROXY: 'credential-bearing-proxy',
  };
  assert.deepEqual(processEnvironment(env), {
    Path: 'system-path', SystemRoot: 'C:\\Windows', TEMP: 'temp-path',
    USERPROFILE: 'home', APPDATA: 'roaming', LOCALAPPDATA: 'local', ProgramFiles: 'programs',
  });
  const backend = processEnvironment(env, { backend: true });
  assert.equal(backend.GOOGLE_API_KEY, 'fixture');
  assert.equal(backend.NODE_OPTIONS, undefined);
  assert.equal(backend.JARVIS_ACCESS_CODE, undefined);
});

test('ticket de restart exige assinatura, geração seguinte, expiração e uso único', () => {
  const secret = 'restart-test-only-'.repeat(3);
  let now = 100000;
  const issuer = createRestartTickets({ secret, generation: 1, now: () => now });
  const receiver = createRestartTickets({ secret, generation: 2, now: () => now });
  const cookie = issuer.issue();
  assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\/api\/resume; Max-Age=60/);
  const token = cookie.split(';')[0].split('=')[1];
  assert.equal(issuer.consume(token), false);
  assert.equal(createRestartTickets({ secret: 'different-test-secret'.repeat(3), generation: 2, now: () => now }).consume(token), false);
  assert.equal(receiver.consume(`${token}x`), false);
  assert.equal(receiver.consume(token), true);
  assert.equal(receiver.consume(token), false);
  assert.equal(createRestartTickets({ secret, generation: 3, now: () => now }).consume(token), false);
  now += 60001;
  assert.equal(createRestartTickets({ secret, generation: 2, now: () => now }).consume(token), false);
  assert.equal(createRestartTickets().issue(), null);
});

test('operações deduplicam por sessão/id, recusam conflito e mantêm resultado estruturado', async () => {
  const operations = createOperations({ logger: quiet });
  let resolve, calls = 0;
  const work = async ({ setAction }) => {
    calls++; setAction('open_chrome');
    await new Promise(done => { resolve = done; });
    return { status: 200, body: { ok: true } };
  };
  const first = operations.run('owner', 'request', 'same', work);
  const duplicate = operations.run('owner', 'request', 'same', work);
  await tick();
  assert.equal(calls, 1);
  assert.equal(operations.list('owner')[0].action, 'open_chrome');
  assert.deepEqual(operations.list('other'), []);
  await assert.rejects(operations.run('owner', 'request', 'different', work), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(operations.run('owner', 'another', 'same', work), { code: 'ACTION_BUSY' });
  resolve();
  assert.deepEqual(await first, await duplicate);
  assert.deepEqual(await operations.run('owner', 'request', 'same', work), await first);
  assert.equal(calls, 1);
  assert.deepEqual(operations.list('owner'), []);
  operations.stop();
});

test('timeout/cancelamento invalidam operações e respostas tardias', async () => {
  const operations = createOperations({ timeoutMs: 30, logger: quiet });
  let signal;
  const timed = operations.run('owner', 'timeout', 'message', async context => {
    signal = context.signal;
    return new Promise(() => {});
  });
  await assert.rejects(timed, { code: 'TIMEOUT' });
  assert.equal(signal.aborted, true);
  const cancelled = operations.run('owner', 'cancelled', 'message', () => new Promise(() => {}));
  const rejection = assert.rejects(cancelled, { code: 'CANCELLED' });
  operations.cancel('owner');
  await rejection;
  operations.stop();
  await assert.rejects(operations.run('owner', 'new', 'message', () => {}), { code: 'SERVER_STOPPING' });
});

function mockProcess({ hanging = false, exitCode = 0 } = {}) {
  const child = new EventEmitter();
  child.unref = () => {};
  child.kills = [];
  child.kill = signal => { child.kills.push(signal); queueMicrotask(() => child.emit('close', null)); return true; };
  queueMicrotask(() => { child.emit('spawn'); if (!hanging) child.emit('close', exitCode); });
  return child;
}

test('processo auxiliar só confirma ao encerrar e recebe ambiente sanitizado', async () => {
  const manager = createProcessManager({ logger: quiet });
  let child, options;
  const pending = manager.run('fixture-exe', [], {
    env: { SystemRoot: 'C:\\Windows', GOOGLE_API_KEY: 'fixture' },
    spawnProcess: (_exe, _args, opts) => { options = opts; child = mockProcess({ hanging: true }); return child; },
  });
  let settled = false;
  pending.then(() => { settled = true; });
  await tick();
  assert.equal(settled, false);
  assert.equal(manager.size, 1);
  assert.equal(options.detached, false);
  assert.equal(options.shell, false);
  assert.equal(options.env.GOOGLE_API_KEY, undefined);
  child.emit('close', 0);
  assert.deepEqual(await pending, { ok: true, status: 'completed', verified: true });
  assert.equal(manager.size, 0);
});

test('timeout mata somente o auxiliar criado e não bloqueia indefinidamente', async () => {
  const manager = createProcessManager({ logger: quiet });
  let child;
  await assert.rejects(manager.run('fixture-exe', [], {
    timeoutMs: 25,
    spawnProcess: () => { child = mockProcess({ hanging: true }); return child; },
  }), { code: 'PROCESS_TIMEOUT' });
  assert.deepEqual(child.kills, ['SIGKILL']);
  assert.equal(manager.size, 0);
});

test('shutdown encerra auxiliar pendente, mas não mata aplicativo entregue ao usuário', async () => {
  const manager = createProcessManager({ logger: quiet });
  let app, helper;
  assert.deepEqual(await manager.run('fixture-app', [], {
    handoff: true, spawnProcess: () => { app = mockProcess({ hanging: true }); return app; },
  }), { ok: true, status: 'launched', verified: false });
  const pending = manager.run('fixture-helper', [], {
    spawnProcess: () => { helper = mockProcess({ hanging: true }); return helper; },
  });
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  await manager.stop();
  await rejected;
  assert.equal(helper.kills.length, 1);
  assert.equal(app.kills.length, 0);
});

test('helper Node inofensivo real é encerrado pelo timeout sem janela ou comandos Windows', async () => {
  const manager = createProcessManager({ logger: quiet });
  let child;
  await assert.rejects(manager.run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    timeoutMs: 150,
    spawnProcess: (...args) => { child = spawn(...args); return child; },
  }), { code: 'PROCESS_TIMEOUT' });
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.equal(manager.size, 0);
});

test('cancelamento de IA propaga abort e impede fallback e ação tardia', async () => {
  let request, finish;
  const controller = new AbortController();
  const router = createAIResponseRouter({
    geminiApiKey: 'fixture', geminiModel: 'fixture-model', openrouterApiKey: 'fixture', openrouterModel: 'fixture-model',
    geminiProvider: { generateResponse: input => { request = input; return new Promise(resolve => { finish = resolve; }); } },
    openrouterProvider: { generateResponse: () => assert.fail('fallback depois do cancelamento') },
    logger: quiet,
  });
  const pending = router.generateResponse({ message: 'fixture', signal: controller.signal });
  await tick();
  controller.abort(operationError('CANCELLED'));
  await assert.rejects(pending, { code: 'CANCELLED' });
  assert.equal(request.signal.aborted, true);
  finish('{"type":"action","action":"open_app","params":{"app":"notepad"}}');
  await tick();
});

test('cancelamento de busca YouTube não abre resultados como fallback', async () => {
  const controller = new AbortController();
  let fetching;
  const started = new Promise(resolve => { fetching = resolve; });
  const pending = runDesktopAction('play_youtube', {
    query: 'fixture', platform: 'win32', exists: () => true,
    fetchPage: () => { fetching(); return new Promise(() => {}); },
    spawnProcess: () => assert.fail('não deve abrir o navegador após cancelamento'),
  }, { signal: controller.signal });
  await started;
  controller.abort(operationError('CANCELLED'));
  await assert.rejects(pending, { code: 'CANCELLED' });
});
