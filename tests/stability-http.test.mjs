import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createServer } from '../apps/local-server/server.mjs';

const quiet = { info() {}, warn() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture(options, run) {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const app = createServer({requireActionApproval:false,
    port, accessCode: 'stability-fixture', logger: quiet,
    googleApiKey: '', googleModel: '', openrouterApiKey: '', openaiApiKey: '', openaiEnabled: false,
    memoryStore: { initialize: async () => {}, getFacts: async () => [] },
    executeAction: async () => ({ ok: true, status: 'launched', verified: false }),
    ...options,
  });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${port}`;
  const call = async (path, data, headers = {}) => {
    const response = await fetch(origin + path, {
      method: data === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5000),
      headers: { ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const login = await call('/api/login', { code: 'stability-fixture' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const session = await call('/api/session', undefined, { Cookie: cookie });
  const auth = { Cookie: cookie, 'X-Jarvis-CSRF': session.body.csrf };
  try { await run({ call, auth, app, origin }); }
  finally { await app.close(); }
}

test('health é público e mínimo; sessão, origem e falha interna têm códigos distintos', async () => {
  await fixture({ memoryStore: { initialize: async () => {}, getFacts: async () => [] } }, async ({ call, auth }) => {
    const health = await call('/api/health');
    assert.equal(health.body.ok, true);
    assert.deepEqual(Object.keys(health.body).sort(), ['instanceId', 'ok', 'state']);
    assert.equal((await call('/api/status')).body.code, 'SESSION_INVALID');
    assert.equal((await call('/api/chat', { message: 'Oi' }, { ...auth, Origin: 'http://evil.example' })).body.code, 'ORIGIN_INVALID');
    assert.equal((await call('/api/chat', { message: 'Oi' }, { Cookie: auth.Cookie })).body.code, 'CSRF_INVALID');
    assert.equal((await call('/api/chat', { message: 'Oi' }, auth)).body.code, 'AI_NOT_CONFIGURED');
  });
});

test('HTTP deduplica ação concluída pelo ID e recusa reuso com outra mensagem', async () => {
  let calls = 0;
  await fixture({ executeAction: async () => { calls++; return { ok: true, status: 'launched', verified: false }; } },
    async ({ call, auth }) => {
      const headers = { ...auth, 'X-Jarvis-Request-Id': 'request-fixture-0001' };
      const first = await call('/api/chat', { message: 'abra o Chrome' }, headers);
      const second = await call('/api/chat', { message: 'abra o Chrome' }, headers);
      assert.equal(first.status, 200);
      assert.deepEqual(second.body, first.body);
      assert.deepEqual(first.body.execution, { status: 'launched', verified: false });
      assert.equal(calls, 1);
      const conflict = await call('/api/chat', { message: 'abra o Spotify' }, headers);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.code, 'IDEMPOTENCY_CONFLICT');
    });
});

test('acompanha e cancela operação sem permitir ação retornada tardiamente pela IA', async () => {
  let started, complete, executed = 0, providerSignal;
  const ready = new Promise(resolve => { started = resolve; });
  await fixture({
    googleApiKey: 'fixture', googleModel: 'fixture-model',
    generateReply: request => { providerSignal = request.signal; started(); return new Promise(resolve => { complete = resolve; }); },
    executeAction: async () => { executed++; return { ok: true }; },
  }, async ({ call, auth }) => {
    const pending = call('/api/chat', { message: 'faça uma tarefa' }, auth);
    await ready;
    const status = await call('/api/actions', undefined, auth);
    assert.equal(status.body.items.length, 1);
    const busy = await call('/api/chat', { message: 'outra tarefa' }, auth);
    assert.equal(busy.body.code, 'ACTION_BUSY');
    assert.equal((await call('/api/actions/cancel', { id: status.body.items[0].id }, auth)).body.cancelled, true);
    assert.equal((await pending).body.code, 'CANCELLED');
    assert.equal(providerSignal.aborted, true);
    complete('{"type":"action","action":"open_app","params":{"app":"notepad"}}');
    await tick();
    assert.equal(executed, 0);
    assert.deepEqual((await call('/api/chat', undefined, auth)).body.messages, []);
  });
});

test('logout aborta IA e não restaura histórico nem executa ação tardia', async () => {
  let started, complete;
  const ready = new Promise(resolve => { started = resolve; });
  await fixture({
    googleApiKey: 'fixture', googleModel: 'fixture-model',
    generateReply: () => { started(); return new Promise(resolve => { complete = resolve; }); },
    executeAction: async () => assert.fail('ação após logout'),
  }, async ({ call, auth }) => {
    const pending = call('/api/chat', { message: 'faça uma tarefa' }, auth);
    await ready;
    assert.equal((await call('/api/logout', {}, auth)).status, 200);
    assert.equal((await pending).body.code, 'CANCELLED');
    complete('{"type":"action","action":"open_app","params":{"app":"notepad"}}');
    await tick();
    assert.equal((await call('/api/chat', undefined, auth)).status, 401);
  });
});

test('prazo total termina adapter travado e retorno ok:false não vira confirmação', async () => {
  await fixture({ operationTimeoutMs: 30, executeAction: () => new Promise(() => {}) }, async ({ call, auth }) => {
    const response = await call('/api/chat', { message: 'abra o Chrome' }, auth);
    assert.equal(response.status, 504);
    assert.equal(response.body.code, 'TIMEOUT');
  });
  await fixture({ executeAction: async () => ({ ok: false }) }, async ({ call, auth }) => {
    const response = await call('/api/chat', { message: 'abra o Chrome' }, auth);
    assert.equal(response.status, 503);
    assert.equal(response.body.reply, undefined);
  });
});

test('erro de credencial/modelo permanece distinguível da indisponibilidade', async () => {
  await fixture({
    googleApiKey: 'fixture', googleModel: 'fixture-model',
    generateReply: async () => { throw Object.assign(new Error('body-private-fixture'), { status: 401 }); },
  }, async ({ call, auth }) => {
    const response = await call('/api/chat', { message: 'Oi' }, auth);
    assert.equal(response.status, 502);
    assert.equal(response.body.code, 'GEMINI_CONFIGURATION');
    assert.doesNotMatch(JSON.stringify(response.body), /body-private-fixture/);
  });
});

test('restart coloca backend em drenagem, cancela trabalho e bloqueia novas ações', async () => {
  let started, restarts = 0;
  const ready = new Promise(resolve => { started = resolve; });
  await fixture({
    supervised: true, requestRestart: () => { restarts++; return true; },
    googleApiKey: 'fixture', googleModel: 'fixture-model',
    generateReply: () => { started(); return new Promise(() => {}); },
  }, async ({ call, auth }) => {
    const pending = call('/api/chat', { message: 'Oi' }, auth);
    await ready;
    assert.equal((await call('/api/admin/restart', {}, auth)).status, 202);
    assert.equal((await pending).body.code, 'CANCELLED');
    assert.equal((await call('/api/chat', { message: 'abra o Chrome' }, auth)).body.code, 'SERVER_STOPPING');
    assert.equal((await call('/api/admin/restart', {}, auth)).status, 503);
    assert.equal(restarts, 1);
    assert.equal((await call('/api/health')).body.state, 'restarting');
  });
});
