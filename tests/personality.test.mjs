import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JARVIS_IDENTITY, JARVIS_PERSONALITY_INSTRUCTIONS } from '../packages/providers/personality.mjs';
import { JARVIS_SYSTEM_INSTRUCTIONS } from '../packages/providers/system-instructions.mjs';
import { createAIResponseRouter } from '../packages/providers/ai-router.mjs';
import { truthfulActionReply } from '../packages/core/action-reply.mjs';
import { createServer } from '../apps/local-server/server.mjs';

const quiet = { info() {}, warn() {} };
const reply = text => JSON.stringify({ type: 'reply', reply: text });

async function withServer(memoryFilePath, options, run) {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const app = createServer({ port, accessCode: 'personality-test', memoryFilePath, logger: quiet,
    googleApiKey: 'test', googleModel: 'test', openrouterApiKey: '', openaiApiKey: '', openaiEnabled: false,
    generateReply: async () => reply('Recebido.'), ...options });
  await new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${port}`;
  const request = async (path, body, headers = {}) => {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const authenticate = async () => {
    const login = await request('/api/login', { code: 'personality-test' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const session = await request('/api/session', undefined, { Cookie: cookie });
    return { Cookie: cookie, 'X-Jarvis-CSRF': session.body.csrf };
  };
  try { await run({ request, authenticate }); }
  finally { await app.close(); }
}

async function withMemory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-personality-'));
  try { await run(join(directory, 'memory.json')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('identidade fixa separa Jarvis, operador Mateus e seu criador', () => {
  assert.deepEqual(JARVIS_IDENTITY, { name: 'Jarvis', operator: 'Mateus', creator: 'Mateus' });
  assert.equal(Object.isFrozen(JARVIS_IDENTITY), true);
  assert.match(JARVIS_PERSONALITY_INSTRUCTIONS, /Seu nome é Jarvis/);
  assert.match(JARVIS_PERSONALITY_INSTRUCTIONS, /operador é Mateus, que criou e desenvolveu/);
  assert.match(JARVIS_PERSONALITY_INSTRUCTIONS, /nunca confunda o nome do assistente com o nome do usuário/);
  assert.match(JARVIS_PERSONALITY_INSTRUCTIONS, /Jarbas.*propostas para o assistente/);
  assert.match(JARVIS_PERSONALITY_INSTRUCTIONS, /Mudanças reais de nome exigem alteração na configuração\/código/);
});

test('persona define humor ocasional, sobriedade e prioridades sem mudar contrato JSON', () => {
  for (const rule of [/Humor seco e ironia leve são ocasionais/, /adote um tom sério e direto/,
    /Discorde educadamente/, /Não copie falas ou bordões/, /não termine toda resposta oferecendo ajuda/]) {
    assert.match(JARVIS_PERSONALITY_INSTRUCTIONS, rule);
  }
  const sections = ['REGRAS TÉCNICAS E SEGURANÇA', 'EXECUÇÃO E RESPOSTAS VERDADEIRAS', 'IDENTIDADE FIXA', 'PRIORIDADE E CONTEXTO'];
  for (let index = 1; index < sections.length; index++) {
    assert.ok(JARVIS_SYSTEM_INSTRUCTIONS.indexOf(sections[index - 1]) < JARVIS_SYSTEM_INSTRUCTIONS.indexOf(sections[index]));
  }
  assert.match(JARVIS_SYSTEM_INSTRUCTIONS, /1\. segurança.*2\. execução.*3\. identidade.*4\. fatos.*5\. contexto.*6\. mensagem/);
  assert.match(JARVIS_SYSTEM_INSTRUCTIONS, /"type":"action","action":"nome_exato","params"/);
  assert.match(JARVIS_SYSTEM_INSTRUCTIONS, /nunca uma reply fingindo que executou/);
});

test('Gemini e fallback recebem a mesma persona com memória e histórico separados', async () => {
  const requests = [];
  const router = createAIResponseRouter({ geminiApiKey: 'test', geminiModel: 'test', geminiFallbackModels: [],
    openrouterApiKey: 'test', openrouterModel: 'test', logger: quiet,
    geminiProvider: { generateResponse: async request => { requests.push(request); throw Object.assign(new Error('offline'), { status: 503 }); } },
    openrouterProvider: { generateResponse: async request => { requests.push(request); return reply('Recebido.'); } } });
  const history = [{ role: 'user', text: 'E se eu te chamar de Jarbas?' }, { role: 'model', text: 'Continuo sendo Jarvis.' }];
  const memoryContext = '\n\nFato local: projeto atual é Jarvis';
  assert.equal((await router.generateResponse({ message: 'Tá bom.', history, memoryContext })).provider, 'openrouter');
  assert.equal(requests[0].systemPrompt, JARVIS_SYSTEM_INSTRUCTIONS + memoryContext);
  assert.equal(requests[0].systemPrompt, requests[1].systemPrompt);
  assert.deepEqual(requests[0].messages, requests[1].messages);
  assert.equal(requests[0].systemPrompt.split('IDENTIDADE FIXA').length - 1, 1);
  assert.equal(requests[0].messages.length, 3);
  assert.equal(JARVIS_IDENTITY.operator, 'Mateus');
});

test('Jarbas permanece no histórico sem modificar identidade; limpar, logout e reinício preservam fatos', async () => {
  await withMemory(async memoryFilePath => {
    const calls = [];
    const options = { generateReply: async request => { calls.push(request); return reply('Recebido.'); } };
    let permanent;
    await withServer(memoryFilePath, options, async ({ request, authenticate }) => {
      const headers = await authenticate();
      await request('/api/chat', { message: 'lembra que meu projeto atual é Jarvis' }, headers);
      permanent = await readFile(memoryFilePath, 'utf8');
      await request('/api/chat', { message: 'E se eu te chamar de Jarbas?' }, headers);
      await request('/api/chat', { message: 'Tá bom.' }, headers);
      assert.ok(calls.at(-1).history.some(message => message.text.includes('Jarbas')));
      assert.match(calls.at(-1).systemPrompt, /Seu nome é Jarvis/);
      assert.match(calls.at(-1).systemPrompt, /operador é Mateus/);
      assert.match(calls.at(-1).systemPrompt, /nunca responda "Tudo bem, Jarbas"/);
      assert.match(calls.at(-1).systemPrompt, /projeto atual: "Jarvis"/);
      await request('/api/chat/clear', {}, headers);
      await request('/api/chat', { message: 'Quem é você?' }, headers);
      assert.deepEqual(calls.at(-1).history, []);
      assert.match(calls.at(-1).systemPrompt, /Seu nome é Jarvis/);
      await request('/api/logout', {}, headers);
      const nextHeaders = await authenticate();
      await request('/api/chat', { message: 'Quem sou eu?' }, nextHeaders);
      assert.deepEqual(calls.at(-1).history, []);
      assert.equal(await readFile(memoryFilePath, 'utf8'), permanent);
    });
    await withServer(memoryFilePath, options, async ({ request, authenticate }) => {
      const headers = await authenticate();
      assert.deepEqual((await request('/api/chat', undefined, headers)).body.messages, []);
      const fact = await request('/api/chat', { message: 'qual é meu projeto atual?' }, headers);
      assert.equal(fact.body.reply, 'projeto atual é Jarvis.');
      assert.equal(fact.body.source, 'local_memory');
      assert.equal(await readFile(memoryFilePath, 'utf8'), permanent);
    });
  });
});

test('resposta não afirma sucesso sem verificação ou com resultado de falha contraditório', () => {
  const success = 'Pesquisando Pink Floyd no YouTube.';
  for (const result of [undefined, { ok: false }, { ok: true }, { ok: true, status: 'launched', verified: false },
    { ok: true, status: 'completed', verified: false }, { ok: true, status: 'failed', verified: true }]) {
    assert.doesNotMatch(truthfulActionReply(result, success), /(?:^|\s)(?:Pesquisando|Tocando|concluí|abri)(?=$|\s|[.!?])/iu);
  }
  assert.equal(truthfulActionReply({ ok: true, status: 'completed', verified: true }, success), success);
});

test('busca contextual executa antes de responder e reconhece ausência de verificação e falha', async () => {
  await withMemory(async memoryFilePath => {
    const actions = [];
    let fail = false;
    await withServer(memoryFilePath, { generateReply: async () => assert.fail('Comando local não deve chamar IA'),
      executeAction: async (action, params) => {
        actions.push({ action, params });
        return fail ? { ok: false, message: 'Pesquisando Pink Floyd no YouTube.' }
          : { ok: true, status: 'launched', verified: false, message: 'Pesquisando Pink Floyd no YouTube.' };
      } }, async ({ request, authenticate }) => {
      const headers = await authenticate();
      await request('/api/chat', { message: 'abra o YouTube' }, headers);
      const search = await request('/api/chat', { message: 'agora pesquisa por Pink Floyd' }, headers);
      assert.equal(search.body.source, 'local_action');
      assert.match(search.body.reply, /não consegui confirmar/);
      assert.deepEqual(actions.at(-1), { action: 'search_youtube', params: { query: 'Pink Floyd' } });
      fail = true;
      const failure = await request('/api/chat', { message: 'agora pesquisa por Queen' }, headers);
      assert.equal(failure.status, 503);
      assert.doesNotMatch(JSON.stringify(failure.body), /Pesquisando|Tocando/);
    });
  });
});

test('ações vindas da IA ou da memória não confirmam execução sem evidência', async () => {
  await withMemory(async memoryFilePath => {
    const actions = [];
    await withServer(memoryFilePath, {
      generateReply: async () => JSON.stringify({ type: 'action', action: 'search_youtube', params: { query: 'Pink Floyd' } }),
      executeAction: async (action, params) => { actions.push({ action, params }); return { ok: true, message: 'Tocando Pink Floyd.' }; },
    }, async ({ request, authenticate }) => {
      const headers = await authenticate();
      const generated = await request('/api/chat', { message: 'Encontre vídeos dessa banda' }, headers);
      assert.equal(generated.body.source, 'local_action');
      assert.match(generated.body.reply, /não consegui confirmar/);
      await request('/api/chat', { message: 'minha música favorita é Pink Floyd' }, headers);
      const remembered = await request('/api/chat', { message: 'toca minha música favorita' }, headers);
      assert.match(remembered.body.reply, /não consegui confirmar/);
      assert.deepEqual(actions, [
        { action: 'search_youtube', params: { query: 'Pink Floyd' } },
        { action: 'play_youtube', params: { query: 'Pink Floyd' } },
      ]);
    });
  });
});
