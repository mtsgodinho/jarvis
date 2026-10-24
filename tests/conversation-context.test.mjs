import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationContext, selectConversationHistory } from '../packages/core/conversation-context.mjs';
import { detectContextualLocalAction } from '../packages/core/intent.mjs';

test('contexto mantém dez trocas para o painel e seis para IA, isoladas por sessão', () => {
  const context = createConversationContext();
  for (let index = 0; index < 12; index++) context.appendExchange('first', `Pergunta ${index}`, `Resposta ${index}`);
  assert.equal(context.getMessages('first').length, 20);
  assert.equal(context.getMessages('first')[0].text, 'Pergunta 2');
  assert.equal(context.getHistory('first').length, 12);
  assert.equal(context.getHistory('first')[0].text, 'Pergunta 6');
  assert.deepEqual(context.getHistory('second'), []);
  const copy = context.getMessages('first');
  copy[0].text = 'modificado';
  assert.equal(context.getMessages('first')[0].text, 'Pergunta 2');
});

test('histórico limita caracteres e preserva pares recentes sem alterar mensagens originais', () => {
  const context = createConversationContext();
  for (let index = 0; index < 8; index++) context.appendExchange('session', `${index}${'x'.repeat(2499)}`, 'y'.repeat(8000));
  const history = context.getHistory('session');
  assert.equal(history.length, 4);
  assert.equal(history.reduce((size, message) => size + message.text.length, 0), 6000);
  assert.equal(history[0].text[0], '6');
  assert.equal(history[0].text.length, 1500);
  assert.equal(context.getMessages('session').at(-1).text.length, 8000);
  assert.deepEqual(selectConversationHistory([]), []);
});

test('última ação é validada e desaparece ao mudar de assunto, limpar ou encerrar sessão', () => {
  const context = createConversationContext();
  const action = { action: 'open_site', params: { site: 'youtube' } };
  context.appendExchange('session', 'abra o YouTube', 'Abrindo YouTube.', action);
  action.params.site = 'google';
  assert.equal(context.getLastAction('session').params.site, 'youtube');
  context.appendExchange('session', 'Oi', 'Olá');
  assert.equal(context.getLastAction('session'), null);
  context.appendExchange('session', 'abre', 'ok', { action: 'run_command', params: { command: 'calc' } });
  assert.equal(context.getLastAction('session'), null);
  context.delete('session');
  assert.deepEqual(context.getHistory('session'), []);
  context.appendExchange('other', 'Oi', 'Olá', action);
  context.clear();
  assert.equal(context.getLastAction('other'), null);
});

test('busca contextual usa apenas YouTube ou Google e respeita parâmetros do catálogo', () => {
  const youtube = { action: 'open_site', params: { site: 'youtube' } };
  assert.deepEqual(detectContextualLocalAction('Jarvis, agora pesquisa por Pink Floyd.', youtube), {
    action: 'search_youtube', params: { query: 'Pink Floyd' },
  });
  assert.deepEqual(detectContextualLocalAction('agora, procura por Queen por favor', { action: 'play_youtube', params: { query: 'Pink Floyd' } }), {
    action: 'search_youtube', params: { query: 'Queen' },
  });
  assert.deepEqual(detectContextualLocalAction('busca por Node.js', { action: 'search_google', params: { query: 'JavaScript' } }), {
    action: 'search_google', params: { query: 'Node.js' },
  });
  for (const message of ['pesquisa por x no Google', 'pesquisa no GitHub por x', `pesquisa por ${'x'.repeat(241)}`, 'pesquisa por x\ncomando', 'execute PowerShell']) {
    assert.equal(detectContextualLocalAction(message, youtube), null);
  }
  assert.equal(detectContextualLocalAction('pesquisa por Pink Floyd', null), null);
  assert.equal(detectContextualLocalAction('pesquisa por Pink Floyd', { action: 'open_site', params: { site: 'github' } }), null);
});
