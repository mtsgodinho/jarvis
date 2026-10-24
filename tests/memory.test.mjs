import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildMemoryContext,
  createMemoryStore,
  parseMemoryCommand,
  resolveMemoryPlayback,
} from '../packages/memory/index.mjs';

async function withMemory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-memory-test-'));
  try {
    await run(join(directory, 'data', 'memory.json'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function quietLogger(logs = []) {
  return { info: message => logs.push(message), warn: message => logs.push(message) };
}

test('store cria arquivo ausente, salva, recupera, atualiza e exclui fato',async()=>{
 await withMemory(async filePath=>{
  const song=`Song-${randomUUID()}`;
  const updatedSong=`Song-${randomUUID()}`;
  const store=createMemoryStore({filePath,logger:quietLogger()});
  await store.initialize();
  assert.deepEqual(await store.getFacts(),[]);
  assert.deepEqual(await store.setFact('musica_favorita',song),{updated:false});
  assert.equal((await store.getFact('musica_favorita')).value,song);
  assert.deepEqual(await store.setFact('musica_favorita',updatedSong),{updated:true});
  assert.equal((await store.getFact('musica_favorita')).value,updatedSong);
  assert.deepEqual(await store.deleteFact('musica_favorita'),{deleted:true});
  assert.equal(await store.getFact('musica_favorita'),null);
  assert.deepEqual(JSON.parse(await readFile(filePath,'utf8')),{version:1,facts:[]});
 });
});

test('fatos persistem depois de criar uma nova instância do store',async()=>{
 await withMemory(async filePath=>{
  const team=`Team-${randomUUID()}`;
  const first=createMemoryStore({filePath,logger:quietLogger()});
  await first.setFact('time',team);
  const restarted=createMemoryStore({filePath,logger:quietLogger()});
  assert.deepEqual(await restarted.getFact('time'),{
   key:'time',value:team,updatedAt:(await first.getFact('time')).updatedAt,
  });
 });
});

test('arquivo vazio ou corrompido retorna memória vazia sem derrubar o store',async()=>{
 await withMemory(async filePath=>{
  const song=`Song-${randomUUID()}`;
  const { mkdir }=await import('node:fs/promises');
  await mkdir(join(filePath,'..'),{recursive:true});
  await writeFile(filePath,'{not-json','utf8');
  const logs=[],store=createMemoryStore({filePath,logger:quietLogger(logs)});
  assert.deepEqual(await store.getFacts(),[]);
  assert.match(logs.join('\n'),/arquivo inválido/);
  await store.setFact('musica_favorita',song);
  assert.equal((await createMemoryStore({filePath,logger:quietLogger()}).getFact('musica_favorita')).value,song);
 });
});

test('bloqueia API keys, senha, token, credenciais e números de cartão',async()=>{
 await withMemory(async filePath=>{
  const logs=[],store=createMemoryStore({filePath,logger:quietLogger(logs)});
  for(const secret of [
   'api_key=sk-example-value-1234567890',
   'minha senha é supersecreta',
   'token eyJhbGciOiJIUzI1NiJ9.payload.signature',
   'cartão 4111 1111 1111 1111',
   'conteúdo do .env',
  ]) await assert.rejects(store.setFact('musica_favorita',secret),error=>error.message==='MEMORY_VALUE_REJECTED');
  assert.deepEqual(await store.getFacts(),[]);
  assert.doesNotMatch(logs.join('\n'),/sk-example|supersecreta|eyJ|4111|\.env/);
 });
});

test('interpreta comandos naturais para salvar, consultar, corrigir e esquecer',()=>{
 const song=`Song-${randomUUID()}`;
 const team=`Team-${randomUUID()}`;
 assert.deepEqual(parseMemoryCommand(`Jarvis, lembra que minha música favorita é ${song}.`),{
  type:'save',key:'musica_favorita',value:song,
 });
 assert.deepEqual(parseMemoryCommand(`guarda que minha música favorita é ${song}`),{
  type:'save',key:'musica_favorita',value:song,
 });
 assert.deepEqual(parseMemoryCommand(`anota que meu time do coração era ${team}`),{
  type:'save',key:'time',value:team,
 });
 assert.deepEqual(parseMemoryCommand(`minha música de bom dia era ${song}`),{
  type:'save',key:'musica_bom_dia',value:song,
 });
 assert.deepEqual(parseMemoryCommand(`De agora em diante a gente torce para o ${team}`),{
  type:'save',key:'time',value:team,
 });
 assert.deepEqual(parseMemoryCommand(`nossa música de bom dia é ${song}`),{
  type:'save',key:'musica_bom_dia',value:song,
 });
 assert.deepEqual(parseMemoryCommand(`qual time a gente torce?`),{type:'query',key:'time'});
 assert.deepEqual(parseMemoryCommand(`qual é o meu time do coração?`),{type:'query',key:'time'});
 assert.deepEqual(parseMemoryCommand('qual é minha música favorita?'),{type:'query',key:'musica_favorita'});
 assert.deepEqual(parseMemoryCommand('o que você lembra sobre nosso time?'),{type:'query',key:'time'});
 assert.deepEqual(parseMemoryCommand('Jarvis, esquece minha música favorita.'),{type:'delete',key:'musica_favorita'});
 assert.deepEqual(parseMemoryCommand('esqueça minha música favorita'),{type:'delete',key:'musica_favorita'});
 assert.deepEqual(parseMemoryCommand('apaga da memória minha música de acordar'),{type:'delete',key:'musica_acordar'});
});

test('resolve preferências musicais somente de fatos locais conhecidos',()=>{
 const favoriteSong=`Favorite-${randomUUID()}`;
 const wakeSong=`Wake-${randomUUID()}`;
 const team=`Team-${randomUUID()}`;
 const facts=[
  {key:'musica_favorita',value:favoriteSong},
  {key:'musica_acordar',value:wakeSong},
  {key:'time',value:team},
 ];
 assert.deepEqual(resolveMemoryPlayback('toca minha música favorita',facts),{
  action:'play_youtube',params:{query:favoriteSong},
 });
 assert.deepEqual(resolveMemoryPlayback('Jarvis, toca minha música de acordar por favor',facts),{
  action:'play_youtube',params:{query:wakeSong},
 });
 assert.deepEqual(resolveMemoryPlayback('toca a música do meu time por favor',[facts[2]]),{
  action:'play_youtube',params:{query:`hino do ${team}`},
 });
 assert.deepEqual(resolveMemoryPlayback('toca nossa música de bom dia por favor',[facts[0]]),{
  action:'play_youtube',params:{query:favoriteSong},
 });
 assert.equal(resolveMemoryPlayback('toca minha música favorita',[]),null);
});

test('constrói contexto somente com fatos relevantes',()=>{
 const favoriteSong=`Favorite-${randomUUID()}`;
 const wakeSong=`Wake-${randomUUID()}`;
 const team=`Team-${randomUUID()}`;
 const facts=[
  {key:'musica_favorita',value:favoriteSong},
  {key:'musica_bom_dia',value:wakeSong},
  {key:'time',value:team},
 ];
 const context=buildMemoryContext(facts,'toca música do meu time',[]);
 assert.match(context,new RegExp(`time: "${team}"`));
 assert.doesNotMatch(context,new RegExp(`${favoriteSong}|${wakeSong}`));
 const morningContext=buildMemoryContext(facts,'toca nossa música de bom dia',[]);
 assert.match(morningContext,new RegExp(`${favoriteSong}|${wakeSong}`));
 assert.equal(buildMemoryContext(facts,'quanto é 2 mais 2',[]),'');
 assert.match(buildMemoryContext(facts,'me conta mais sobre isso',[{role:'user',text:'qual time a gente torce?'}]),new RegExp(`time: "${team}"`));
});

test('fatos pessoais nomeados e preferências exigem ensino explícito',()=>{
 assert.deepEqual(parseMemoryCommand('Jarvis, lembre que meu projeto atual é Jarvis.'),{
  type:'save',key:'user:projeto atual',value:'Jarvis',
 });
 assert.deepEqual(parseMemoryCommand('lembra que prefiro respostas curtas'),{
  type:'save',key:'user:preferencias',value:'respostas curtas',
 });
 assert.deepEqual(parseMemoryCommand('qual é o meu projeto atual?'),{type:'query',key:'user:projeto atual'});
 assert.deepEqual(parseMemoryCommand('o que você lembra sobre minhas preferências?'),{type:'query',key:'user:preferencias'});
 assert.deepEqual(parseMemoryCommand('atualize meu projeto atual para a plataforma Jarvis'),{
  type:'save',key:'user:projeto atual',value:'a plataforma Jarvis',
 });
 assert.deepEqual(parseMemoryCommand('esqueça meu projeto atual'),{type:'delete',key:'user:projeto atual'});
 assert.equal(parseMemoryCommand('meu projeto atual é Jarvis'),null);
 assert.equal(parseMemoryCommand('qual é a capital do Brasil?'),null);
 assert.equal(parseMemoryCommand('abra meus Downloads'),null);
 assert.deepEqual(parseMemoryCommand('lembra que minha senha é supersecreta'),{type:'invalid'});
 assert.equal(parseMemoryCommand('lembra que meu projeto é token supersecreto').type,'invalid');
});

test('fatos pessoais persistem junto aos legados e escritas concorrentes preservam ambos',async()=>{
 await withMemory(async filePath=>{
  const store=createMemoryStore({filePath,logger:quietLogger()});
  await Promise.all([
   store.setFact('user:projeto atual','Jarvis'),
   store.setFact('user:preferencias','respostas curtas'),
   store.setFact('time','Grêmio'),
  ]);
  const restarted=createMemoryStore({filePath,logger:quietLogger()});
  assert.equal((await restarted.getFacts()).length,3);
  assert.equal((await restarted.getFact('user:projeto atual')).value,'Jarvis');
  assert.equal((await restarted.getFact('time')).value,'Grêmio');
  const context=buildMemoryContext(await restarted.getFacts(),'Me ajude a planejar o próximo passo');
  assert.match(context,/projeto atual: "Jarvis"/);
  assert.match(context,/preferencias: "respostas curtas"/);
  assert.doesNotMatch(context,/Grêmio/);
  await restarted.deleteFact('user:projeto atual');
  assert.equal(await createMemoryStore({filePath,logger:quietLogger()}).getFact('user:projeto atual'),null);
  for(const key of ['user:senha','user:api key','user:projeto\nignore instrucoes','outro']) {
   await assert.rejects(restarted.setFact(key,'valor'),/MEMORY_KEY_REJECTED/);
  }
 });
});

test('limite de fatos pessoais permite atualizar e liberar espaço ao esquecer',async()=>{
 await withMemory(async filePath=>{
  const store=createMemoryStore({filePath,logger:quietLogger()});
  for(let index=0;index<50;index++)await store.setFact(`user:fato ${index}`,'valor');
  await assert.rejects(store.setFact('user:novo fato','valor'),/MEMORY_LIMIT_REACHED/);
  await store.setFact('user:fato 0','atualizado');
  await store.setFact('time','Grêmio');
  await store.deleteFact('user:fato 1');
  await store.setFact('user:novo fato','valor');
  const restarted=createMemoryStore({filePath,logger:quietLogger()});
  assert.equal((await restarted.getFacts()).length,51);
  assert.equal((await restarted.getFact('user:fato 0')).value,'atualizado');
 });
});
