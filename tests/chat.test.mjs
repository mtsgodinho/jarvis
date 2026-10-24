import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {createServer} from '../apps/local-server/server.mjs';
import { createAIResponseRouter } from '../packages/providers/ai-router.mjs';
import { DEFAULT_PROVIDER_TIMEOUTS_MS } from '../packages/providers/timeouts.mjs';

let nextPort=18789;
const structuredReply=reply=>JSON.stringify({type:'reply',reply});
async function withServer(options, run) {
 const port=nextPort++, origin=`http://127.0.0.1:${port}`, directory=await mkdtemp(join(tmpdir(),'jarvis-chat-test-'));
 const {server}=createServer({port,memoryFilePath:join(directory,'runtime','memory.json'),openaiApiKey:'',openaiEnabled:false,openrouterApiKey:'',googleApiKey:'',...options});
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 const request=async(path,data,headers={})=>{
  const response=await fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...headers},body:data===undefined?undefined:JSON.stringify(data)});
  const contentType=response.headers.get('content-type')||'';
  return {response,body:contentType.includes('application/json')?await response.json():await response.text()};
 };
 try {await run(request);} finally {
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(directory,{recursive:true,force:true});
 }
}

test('conversa Gemini exige sessão e CSRF, mantém histórico e pode ser apagada',async()=>{
 const calls=[];
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'test-model',generateReply:async request=>{calls.push(request);return structuredReply(`Resposta: ${request.message}`);}},async request=>{
    const panel=await request('/');
    assert.match(panel.response.headers.get('permissions-policy'),/microphone=\(self\)/);
  assert.equal((await request('/api/chat')).response.status,401);
  const login=await request('/api/login',{code:'chat-test'});assert.equal(login.response.status,200);
  const cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  assert.equal((await request('/api/chat',{message:'sem token'},{Cookie:cookie})).response.status,403);
  assert.equal((await request('/api/status',undefined,headers)).body.geminiConfigured,true);
  assert.equal((await request('/api/status',undefined,headers)).body.openaiConfigured,false);
  const unsafeRequest='Abra o Chrome, delete um arquivo e execute este comando.';
  assert.equal((await request('/api/chat',{message:unsafeRequest},headers)).body.reply,`Resposta: ${unsafeRequest}`);
  assert.equal((await request('/api/chat',{message:'Qual era meu pedido?'},headers)).body.reply,'Resposta: Qual era meu pedido?');
  assert.deepEqual(calls[1].history,[{role:'user',text:unsafeRequest},{role:'model',text:`Resposta: ${unsafeRequest}`}]);
  assert.deepEqual(Object.keys(calls[0]).sort(),['apiKey','history','message','model','signal','systemPrompt','timeoutMs']);
  assert.equal(calls[0].timeoutMs,DEFAULT_PROVIDER_TIMEOUTS_MS.gemini);
  assert.equal(calls[0].signal instanceof AbortSignal,true);
  assert.deepEqual((await request('/api/chat',undefined,headers)).body.messages,[
   {role:'user',text:unsafeRequest},{role:'model',text:`Resposta: ${unsafeRequest}`},
   {role:'user',text:'Qual era meu pedido?'},{role:'model',text:'Resposta: Qual era meu pedido?'},
  ]);
  assert.equal((await request('/api/chat/clear',{},headers)).response.status,200);
  assert.deepEqual((await request('/api/chat',undefined,headers)).body.messages,[]);
  await request('/api/logout',{},headers);
  assert.equal((await request('/api/chat/clear',{})).response.status,401);
 });
});

test('pergunta com pronome recebe contexto recente idêntico no Gemini e fallback OpenRouter',async()=>{
 const gemini=[],router=[];
 await withServer({accessCode:'chat-test',googleApiKey:'test',googleModel:'test',openrouterApiKey:'test',openrouterModel:'test',
  generateReply:async request=>{
   gemini.push(request);
   if(request.message.includes('ele')){const error=new Error('unavailable');error.status=503;throw error;}
   return structuredReply('Elon Musk é um empresário.');
  },
  generateOpenRouter:async request=>{router.push(request);return structuredReply('Entendi a referência a Elon Musk.');}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  await request('/api/chat',{message:'Jarvis, quem é Elon Musk?'},headers);
  const result=await request('/api/chat',{message:'Quantos anos ele tem?'},headers);
  assert.equal(result.body.source,'openrouter');
  assert.deepEqual(gemini[1].history,[{role:'user',text:'Jarvis, quem é Elon Musk?'},{role:'model',text:'Elon Musk é um empresário.'}]);
  assert.deepEqual(router[0].messages.slice(0,-1),gemini[1].history.map(({role,text})=>({role:role==='model'?'assistant':'user',content:text})));
  assert.equal(router[0].messages.at(-1).content,'Quantos anos ele tem?');
 });
});

test('buscas seguem última ação bem-sucedida e comandos explícitos têm prioridade',async()=>{
 const actions=[],calls=[];
 await withServer({accessCode:'chat-test',googleApiKey:'test',googleModel:'test',
  generateReply:async request=>{calls.push(request);return structuredReply('Conversa');},
  executeAction:async(action,params)=>{actions.push({action,params});return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  for(const message of ['Jarvis, abra o YouTube.','Agora pesquisa por Pink Floyd.','agora procura por Queen','pesquisa Beatles no Google','agora pesquisa por Led Zeppelin','diminua o volume']) {
   const result=await request('/api/chat',{message},headers);
   assert.equal(result.response.status,200,message);
   assert.equal(result.body.source,'local_action',message);
  }
  assert.deepEqual(actions,[
   {action:'open_site',params:{site:'youtube'}},
   {action:'search_youtube',params:{query:'Pink Floyd'}},
   {action:'search_youtube',params:{query:'Queen'}},
   {action:'search_google',params:{query:'Beatles'}},
   {action:'search_google',params:{query:'Led Zeppelin'}},
   {action:'volume_down',params:{}},
  ]);
  assert.equal(calls.length,0);
 });
});

test('contexto não atravessa sessões, limpeza ou logout e ignora ações que falharam',async()=>{
 const calls=[];
 await withServer({accessCode:'chat-test',googleApiKey:'test',googleModel:'test',
  generateReply:async request=>{calls.push(request);return structuredReply('Sem destino conhecido');},
  executeAction:async(action,params)=>{if(params?.site==='google')throw new Error('ACTION_FAILED');return {ok:true,status:'completed',verified:true};}},async request=>{
  const authenticate=async()=>{
   const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
   const session=await request('/api/session',undefined,{Cookie:cookie});
   return {Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  };
  const first=await authenticate(),second=await authenticate();
  await request('/api/chat',{message:'abra o YouTube'},first);
  await request('/api/chat',{message:'agora pesquisa por Pink Floyd'},second);
  assert.deepEqual(calls.at(-1).history,[]);
  await request('/api/chat/clear',{},first);
  await request('/api/chat',{message:'agora pesquisa por Pink Floyd'},first);
  assert.deepEqual(calls.at(-1).history,[]);
  await request('/api/chat',{message:'abra o YouTube'},first);
  await request('/api/logout',{},first);
  const third=await authenticate();
  assert.equal((await request('/api/chat',{message:'abra o Google'},third)).response.status,503);
  await request('/api/chat',{message:'agora pesquisa por Pink Floyd'},third);
  assert.deepEqual(calls.at(-1).history,[]);
  assert.equal(calls.length,3);
 });
});

test('histórico da IA tem orçamento de caracteres e conversa não modifica memória permanente',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'jarvis-short-context-test-'));
 const memoryFilePath=join(directory,'memory.json'),calls=[];
 try {
  await withServer({accessCode:'chat-test',memoryFilePath,googleApiKey:'test',googleModel:'test',
   generateReply:async request=>{calls.push(request);return structuredReply('Resposta longa '.repeat(600));}},async request=>{
   const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
   const session=await request('/api/session',undefined,{Cookie:cookie});
   const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
   await request('/api/chat',{message:'lembra que meu projeto atual é Jarvis'},headers);
   const permanent=await readFile(memoryFilePath,'utf8');
   for(let index=0;index<11;index++) {
    const result=await request('/api/chat',{message:`Pergunta ${index} ${'x'.repeat(2000)}`},headers);
    assert.equal(result.response.status,200);
   }
   for(const call of calls) {
    assert.ok(call.history.length<=12);
    assert.ok(call.history.reduce((total,message)=>total+message.text.length,0)<=6000);
    assert.ok(call.history.every(message=>message.text.length<=1500));
    assert.equal(call.history.length%2,0);
   }
   assert.equal((await request('/api/chat',undefined,headers)).body.messages.length,20);
   await request('/api/chat/clear',{},headers);
   assert.equal(await readFile(memoryFilePath,'utf8'),permanent);
  });
 } finally {await rm(directory,{recursive:true,force:true});}
});

test('Abra o Chrome executa apenas a ação local e não chama o Gemini',async()=>{
 const calls=[],actions=[];
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'test-model',
  generateReply:async request=>{calls.push(request);return structuredReply('Resposta Gemini');},
  executeAction:async action=>{actions.push(action);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'Abra o Chrome'},headers);
  assert.equal(result.response.status,200);
  assert.equal(result.body.reply,'Abrindo o Chrome, Mateus.');
  assert.equal(result.body.source,'local_action');
  assert.deepEqual(actions,['open_chrome']);
  assert.deepEqual(calls,[]);
  assert.deepEqual((await request('/api/chat',undefined,headers)).body.messages,[
   {role:'user',text:'Abra o Chrome'},{role:'model',text:'Abrindo o Chrome, Mateus.'},
  ]);
 });
});

test('pedido de perfil Chrome seleciona Mateus localmente sem chamar Gemini',async()=>{
 const calls=[],actions=[];
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'test-model',
  generateReply:async request=>{calls.push(request);return structuredReply('Resposta Gemini');},
  executeAction:async(...args)=>{actions.push(args);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'Abra o Chrome na conta do Mateus'},headers);
  assert.equal(result.body.reply,'Abrindo o Chrome no perfil Mateus.');
  assert.equal(result.body.source,'local_action');
  assert.deepEqual(actions,[['open_chrome',{profileName:'Mateus'}]]);
  assert.deepEqual(calls,[]);
 });
});

test('perfil Chrome desconhecido não executa ação nem chama Gemini',async()=>{
 const calls=[],actions=[];
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'test-model',
  generateReply:async request=>{calls.push(request);return structuredReply('Resposta Gemini');},
  executeAction:async action=>{actions.push(action);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'Abra o Chrome no perfil Inexistente'},headers);
  assert.match(result.body.reply,/perfil do Chrome/);
  assert.deepEqual(actions,[]);
  assert.deepEqual(calls,[]);
 });
});

test('comandos desconhecidos e texto arbitrário nunca executam ação local',async()=>{
 const calls=[],actions=[];
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'test-model',
  generateReply:async request=>{calls.push(request.message);return structuredReply(`Resposta: ${request.message}`);},
  executeAction:async action=>{actions.push(action);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  for(const message of ['Abra o Firefox','Execute PowerShell: Start-Process calc.exe']) {
   const result=await request('/api/chat',{message},headers);
   assert.equal(result.response.status,200);
   assert.equal(result.body.reply,`Resposta: ${message}`);
  }
  assert.deepEqual(calls,['Abra o Firefox','Execute PowerShell: Start-Process calc.exe']);
  assert.deepEqual(actions,[]);
 });
});

test('credenciais ausentes geram erro amigável sem chamar o provedor',async()=>{
 let called=false;
 await withServer({accessCode:'chat-test',googleApiKey:'',googleModel:'',generateReply:async()=>{called=true;return 'inesperado';}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie}),headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  assert.equal((await request('/api/status',undefined,headers)).body.geminiConfigured,false);
  const result=await request('/api/chat',{message:'Oi'},headers);
  assert.equal(result.response.status,503);
  assert.match(result.body.error,/GOOGLE_API_KEY e GOOGLE_MODEL/);
  assert.equal(called,false);
 });
});

test('falha do Gemini registra status e mensagem sem expor a chave',async()=>{
 const originalError=console.error,originalInfo=console.info,originalWarn=console.warn,logs=[];
 const capture=(...parts)=>logs.push(parts.join(' '));
 console.error=capture;console.info=capture;console.warn=capture;
 try {
  await withServer({accessCode:'chat-test',googleApiKey:'test-secret',googleModel:'test-model',generateReply:async()=>{
   const error=new Error('quota exceeded; key=test-secret');error.status=429;throw error;
  }},async request=>{
   const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
   const session=await request('/api/session',undefined,{Cookie:cookie});
   const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
   const result=await request('/api/chat',{message:'Oi'},headers);
   assert.equal(result.response.status,502);
  });
 } finally {console.error=originalError;console.info=originalInfo;console.warn=originalWarn;}
 assert.match(logs.join('\n'),/HTTP 429/);
 assert.match(logs.join('\n'),/test-model/);
 assert.doesNotMatch(logs.join('\n'),/test-secret/);
});

test('fallback do Gemini tenta modelos compatíveis em falha temporária',async()=>{
 const tried=[];
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'gemini-3.8-flash',generateReply:async request=>{
  tried.push(request.model);
  if(request.model==='gemini-3.8-flash') {const error=new Error('unavailable');error.status=503;throw error;}
  return structuredReply('Resposta pelo fallback');
 }},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'Oi'},headers);
  assert.equal(result.response.status,200);
  assert.equal(result.body.reply,'Resposta pelo fallback');
 });
 assert.deepEqual(tried,['gemini-3.8-flash','gemini-3.7-flash']);
});

test('Gemini prioriza OpenRouter sem tentar toda a cadeia de fallbacks redundantes',async()=>{
 const tried=[];
 const router=createAIResponseRouter({
  geminiApiKey:'server-secret',geminiModel:'gemini-3.8-flash',geminiFallbackModels:['gemini-3.7-flash','gemini-3.6-flash'],
  openrouterApiKey:'router-secret',openrouterModel:'openrouter/free',
  openaiEnabled:false,openaiApiKey:'',openaiModel:'',
  geminiProvider:{generateResponse:async request=>{tried.push(request.model);const error=new Error('unavailable');error.status=503;throw error;}},
  openrouterProvider:{generateResponse:async()=>({text:JSON.stringify({type:'reply',reply:'Resposta rápida pela rota'}),model:'openrouter/free'})},
  openaiProvider:{generateResponse:async()=>assert.fail('OpenAI não deve ser chamada')},
  logger:{info:()=>{},warn:()=>{}},
 });
 const result=await router.generateResponse({message:'Oi'});
 assert.equal(result.provider,'openrouter');
 assert.deepEqual(tried,['gemini-3.8-flash']);
});

test('fallback do Gemini para após duas falhas e retorna mensagem amigável',async()=>{
 const tried=[];
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'gemini-3.8-flash',generateReply:async request=>{
  tried.push(request.model);
  const error=new Error('temporarily unavailable');error.status=503;throw error;
 }},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'Oi'},headers);
  assert.equal(result.response.status,502);
  assert.match(result.body.error,/temporariamente indisponível/);
 });
 assert.deepEqual(tried,['gemini-3.8-flash','gemini-3.7-flash']);
});

test('Gemini retorna intenção estruturada e o servidor valida, executa e confirma uma ação',async()=>{
 const calls=[],actions=[];
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'test-model',
  generateReply:async request=>{calls.push(request);return JSON.stringify({type:'action',action:'search_google',params:{query:'RTX 4060'}});},
  executeAction:async(...args)=>{actions.push(args);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'Pesquise no Google por RTX 4060'},headers);
  assert.equal(result.response.status,200);
  assert.equal(result.body.reply,'Pesquisando RTX 4060 no Google.');
  assert.equal(result.body.source,'local_action');
  assert.deepEqual(actions,[['search_google',{query:'RTX 4060'}]]);
  assert.equal(calls.length,1);
  assert.deepEqual((await request('/api/chat',undefined,headers)).body.messages[1],
   {role:'model',text:'Pesquisando RTX 4060 no Google.'});
 });
});

test('Gemini com ação desconhecida ou parâmetros inválidos recebe resposta amigável sem executar',async()=>{
 const actions=[];
 const proposals=[
  {type:'action',action:'run_command',params:{command:'calc.exe'}},
  {type:'action',action:'open_folder',params:{folder:'C:\\Users\\Mateus'}},
  {type:'action',action:'open_app',params:{app:'spotify',path:'C:\\evil.exe'}},
 ];
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'test-model',
  generateReply:async()=>JSON.stringify(proposals.shift()),executeAction:async(...args)=>actions.push(args)},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  for(let index=0;index<3;index++) {
   const result=await request('/api/chat',{message:`pedido ${index}`},headers);
   assert.equal(result.response.status,200);
   assert.match(result.body.reply,/ainda não está disponível/);
  }
  assert.deepEqual(actions,[]);
 });
});

test('ação de aplicativo ausente informa qual app não foi encontrado',async()=>{
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'test-model',
  generateReply:async()=>JSON.stringify({type:'action',action:'open_app',params:{app:'spotify'}}),
  executeAction:async()=>{throw new Error('APP_NOT_FOUND');}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'Abra o Spotify'},headers);
  assert.equal(result.response.status,503);
  assert.match(result.body.error,/Spotify nos locais de instalação conhecidos/);
 });
});

test('Gemini diferencia pesquisa no YouTube de pedidos para reproduzir',async()=>{
 const proposals=new Map([
  ['pesquise Fundo da Grota no YouTube',{type:'action',action:'search_youtube',params:{query:'Fundo da Grota'}}],
  ['toque Fundo da Grota no YouTube',{type:'action',action:'play_youtube',params:{query:'Fundo da Grota'}}],
  ['coloque Fundo da Grota no YouTube',{type:'action',action:'play_youtube',params:{query:'Fundo da Grota'}}],
  ['quero ouvir Fundo da Grota no YouTube',{type:'action',action:'play_youtube',params:{query:'Fundo da Grota'}}],
 ]);
 const actions=[];
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'test-model',
  generateReply:async({message})=>JSON.stringify(proposals.get(message)),
  executeAction:async(...args)=>{actions.push(args);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  for(const [message,expected] of [
   ['pesquise Fundo da Grota no YouTube','Pesquisando Fundo da Grota no YouTube.'],
   ['toque Fundo da Grota no YouTube','Tocando Fundo da Grota no YouTube.'],
   ['coloque Fundo da Grota no YouTube','Tocando Fundo da Grota no YouTube.'],
   ['quero ouvir Fundo da Grota no YouTube','Tocando Fundo da Grota no YouTube.'],
  ]) {
   const result=await request('/api/chat',{message},headers);
   assert.equal(result.body.reply,expected);
  }
  assert.deepEqual(actions,[
   ['search_youtube',{query:'Fundo da Grota'}],
   ['play_youtube',{query:'Fundo da Grota'}],
   ['play_youtube',{query:'Fundo da Grota'}],
   ['play_youtube',{query:'Fundo da Grota'}],
  ]);
 });
});

test('resposta de play_youtube informa quando só conseguiu abrir os resultados',async()=>{
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'test-model',
  generateReply:async()=>JSON.stringify({type:'action',action:'play_youtube',params:{query:'Fundo da Grota'}}),
  executeAction:async()=>({ok:true,status:'completed',verified:true,message:'Não consegui iniciar a reprodução automaticamente; abri os resultados de Fundo da Grota no YouTube para você escolher.'})},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'toque Fundo da Grota no YouTube'},headers);
  assert.equal(result.body.reply,'Não consegui iniciar a reprodução automaticamente; abri os resultados de Fundo da Grota no YouTube para você escolher.');
  assert.doesNotMatch(result.body.reply,/Tocando/);
 });
});

test('intents simples reconhecidas localmente executam sem Gemini ou credenciais',async()=>{
 const calls=[],actions=[];
 const replies=new Map([
  ['Jarvis aumenta o volume cara','Volume aumentado.'],
  ['abaixa o volume','Volume reduzido.'],
  ['pausa a música','Alternando a reprodução.'],
  ['abra meus Downloads','Abrindo seus Downloads.'],
 ]);
 await withServer({accessCode:'chat-test',googleApiKey:'',googleModel:'',
  generateReply:async request=>{calls.push(request);return 'não deveria chamar';},
  executeAction:async(...args)=>{actions.push(args);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  for(const [message,expected] of replies) {
   const result=await request('/api/chat',{message},headers);
   assert.equal(result.response.status,200,message);
   assert.equal(result.body.reply,expected,message);
   assert.equal(result.body.source,'local_action',message);
  }
 });
 assert.deepEqual(actions,[
  ['volume_up',{}],
  ['volume_down',{}],
  ['media_play_pause',{}],
  ['open_folder',{folder:'downloads'}],
 ]);
 assert.deepEqual(calls,[]);
});

test('play, pesquisa e outras ações conhecidas funcionam com Gemini totalmente indisponível',async()=>{
 const calls=[],actions=[];
 const replies=new Map([
  ['Jarvis, toca Ace of Spades no YouTube pra mim',['play_youtube',{query:'Ace of Spades'},'Tocando Ace of Spades no YouTube.']],
  ['Jarvis, aumenta o volume, cara',['volume_up',{},'Volume aumentado.']],
  ['Jarvis, abra meus Downloads',['open_folder',{folder:'downloads'},'Abrindo seus Downloads.']],
  ['Jarvis, pause a música',['media_play_pause',{},'Alternando a reprodução.']],
  ['Jarvis, pesquise Ace of Spades no YouTube',['search_youtube',{query:'Ace of Spades'},'Pesquisando Ace of Spades no YouTube.']],
  ['Jarvis, toca Ace of Spades no YouTube',['play_youtube',{query:'Ace of Spades'},'Tocando Ace of Spades no YouTube.']],
 ]);
 await withServer({accessCode:'chat-test',googleApiKey:'server-secret',googleModel:'test-model',
  generateReply:async request=>{calls.push(request);const error=new Error('Gemini indisponível');error.status=503;throw error;},
  executeAction:async(...args)=>{actions.push(args);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  for(const [message,[action,params,expected]] of replies) {
   const result=await request('/api/chat',{message},headers);
   assert.equal(result.response.status,200,message);
   assert.equal(result.body.reply,expected,message);
   assert.equal(result.body.source,'local_action',message);
   assert.deepEqual(actions.at(-1),[action,params],message);
  }
 });
 assert.deepEqual(calls,[]);
 assert.deepEqual(actions.map(([action])=>action),[
  'play_youtube','volume_up','open_folder','media_play_pause','search_youtube','play_youtube',
 ]);
});

test('ação local reconhecida não chama nenhum provider de IA',async()=>{
 const openaiCalls=[],openrouterCalls=[],geminiCalls=[],actions=[];
 await withServer({accessCode:'chat-test',openaiApiKey:'openai-test-key',openaiModel:'gpt-6-sol',openaiEnabled:true,
  openrouterApiKey:'router-test-key',openrouterModel:'openrouter/free',
  googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  generateOpenAI:async request=>{openaiCalls.push(request);return 'inesperado';},
  generateOpenRouter:async request=>{openrouterCalls.push(request);return 'inesperado';},
  generateReply:async request=>{geminiCalls.push(request);return 'inesperado';},
  executeAction:async(...args)=>{actions.push(args);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'Jarvis, aumenta o volume.'},headers);
  assert.equal(result.body.reply,'Volume aumentado.');
  assert.equal(result.body.source,'local_action');
 });
 assert.deepEqual(actions,[['volume_up',{}]]);
 assert.deepEqual(openaiCalls,[]);
 assert.deepEqual(openrouterCalls,[]);
 assert.deepEqual(geminiCalls,[]);
});

test('Facebook abre localmente pelas variações pedidas sem chamar providers',async()=>{
 const providerCalls=[],actions=[];
 await withServer({accessCode:'chat-test',openaiEnabled:true,openaiApiKey:'openai-key',openaiModel:'test',
  openrouterApiKey:'router-key',openrouterModel:'openrouter/free',googleApiKey:'gemini-key',googleModel:'gemini-test',
  generateOpenAI:async request=>{providerCalls.push(request);return structuredReply('não deveria chamar');},
  generateOpenRouter:async request=>{providerCalls.push(request);return structuredReply('não deveria chamar');},
  generateReply:async request=>{providerCalls.push(request);return structuredReply('não deveria chamar');},
  executeAction:async(...args)=>{actions.push(args);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  for(const message of ['abra o Facebook','abra o Facebook para mim','Jarvis abre o Facebook','entra no Facebook']) {
   const result=await request('/api/chat',{message},headers);
   assert.equal(result.response.status,200,message);
   assert.equal(result.body.source,'local_action',message);
   assert.equal(result.body.reply,'Abrindo Facebook.',message);
  }
 });
 assert.deepEqual(actions,[
  ['open_site',{site:'facebook'}],
  ['open_site',{site:'facebook'}],
  ['open_site',{site:'facebook'}],
  ['open_site',{site:'facebook'}],
 ]);
 assert.deepEqual(providerCalls,[]);
});

test('Facebook só confirma depois do dispatch local ter sucesso',async()=>{
 await withServer({accessCode:'chat-test',googleApiKey:'gemini-key',googleModel:'gemini-test',
  executeAction:async()=>{throw new Error('spawn failed');}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'abra o Facebook para mim'},headers);
  assert.equal(result.response.status,503);
  assert.equal(result.body.error,'Não consegui abrir Facebook.');
 });
});

test('conversa normal usa Gemini primeiro mesmo com OpenAI configurada e desabilitada',async()=>{
 const openaiCalls=[],geminiCalls=[];
 await withServer({accessCode:'chat-test',openaiApiKey:'openai-test-key',openaiModel:'gpt-6-sol',
  googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  generateOpenAI:async request=>{openaiCalls.push(request);return '{"type":"reply","reply":"OpenAI inesperada"}';},
  generateReply:async request=>{geminiCalls.push(request);return '{"type":"reply","reply":"Olá, Mateus!"}';}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const status=await request('/api/status',undefined,headers);
  assert.equal(status.body.openaiConfigured,false);
  assert.equal(status.body.openaiEnabled,false);
  assert.equal(status.body.geminiConfigured,true);
  assert.doesNotMatch(JSON.stringify(status.body),/openai-test-key|gemini-test-key/);
  const result=await request('/api/chat',{message:'Oi, Jarvis'},headers);
  assert.equal(result.body.reply,'Olá, Mateus!');
  assert.equal(result.body.source,'gemini');
  assert.deepEqual(openaiCalls,[]);
  assert.equal(geminiCalls.length,1);
  assert.equal(geminiCalls[0].model,'gemini-test');
 });
 assert.equal(geminiCalls.length,1);
});

test('OpenRouter como fallback recebe o mesmo histórico após falha do Gemini',async()=>{
 const geminiCalls=[],openrouterCalls=[];
 await withServer({accessCode:'chat-test',googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  openrouterApiKey:'router-test-key',openrouterModel:'openrouter/free',
  generateReply:async request=>{
   geminiCalls.push(request);
   if(request.message==='O que eu disse?') {const error=new Error('temporarily unavailable');error.status=503;throw error;}
   return '{"type":"reply","reply":"Meu assunto é música."}';
  },
  generateOpenRouter:async request=>{openrouterCalls.push(request);return '{"type":"reply","reply":"Sigo com o contexto."}';}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const first=await request('/api/chat',{message:'Meu assunto é música.'},headers);
  assert.equal(first.body.source,'gemini');
  const second=await request('/api/chat',{message:'O que eu disse?'},headers);
  assert.equal(second.body.reply,'Sigo com o contexto.');
  assert.equal(second.body.source,'openrouter');
  assert.equal(openrouterCalls.length,1);
  assert.deepEqual(openrouterCalls[0].messages,[
   {role:'user',text:'Meu assunto é música.'},
   {role:'assistant',content:'Meu assunto é música.'},
   {role:'user',content:'O que eu disse?'},
  ].map(({role,content,text})=>({role,content:content??text})));
  assert.match(openrouterCalls[0].systemPrompt,/JARVIS TECH VIEW/);
 });
 assert.equal(geminiCalls.length,2);
});

test('reasoning cru de Gemini e OpenRouter nunca chega ao usuário ou histórico',async()=>{
 const leakedText='So, if the user wants to know the song, I should reason this out privately.';
 await withServer({accessCode:'chat-test',googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  openrouterApiKey:'router-test-key',openrouterModel:'openrouter/free',
  generateReply:async()=>leakedText,
  generateOpenRouter:async()=>leakedText},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'Toca uma música'},headers);
  assert.equal(result.response.status,502);
  assert.doesNotMatch(JSON.stringify(result.body),/So, if the user|reason this out privately/);
  assert.doesNotMatch(JSON.stringify((await request('/api/chat',undefined,headers)).body),/So, if the user|reason this out privately/);
 });
});

test('memória ensinada sobrevive a nova instância, consulta aliases e resolve playback',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'jarvis-memory-restart-test-'));
 const memoryFilePath=join(directory,'memory.json');
 const song=`Song-${randomUUID()}`,team=`Team-${randomUUID()}`;
 const providerCalls=[],actions=[];
 const options={memoryFilePath,googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  openrouterApiKey:'router-test-key',openrouterModel:'openrouter/free',
  generateReply:async request=>{providerCalls.push(request);return structuredReply('provider nao deveria ser chamado');},
  generateOpenRouter:async request=>{providerCalls.push(request);return structuredReply('provider nao deveria ser chamado');},
  generateOpenAI:async request=>{providerCalls.push(request);return structuredReply('provider nao deveria ser chamado');},
  executeAction:async(...args)=>{actions.push(args);return {ok:true,status:'completed',verified:true};}};
 try {
  await withServer({accessCode:'chat-test',...options},async request=>{
   const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
   const session=await request('/api/session',undefined,{Cookie:cookie});
   const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
   const taughtSong=await request('/api/chat',{message:`minha música de bom dia é ${song}`},headers);
   const taughtTeam=await request('/api/chat',{message:`meu time do coração é ${team}`},headers);
   assert.equal(taughtSong.body.source,'local_memory');
   assert.equal(taughtTeam.body.source,'local_memory');
  });

  await withServer({accessCode:'chat-test',...options},async request=>{
   const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
   const session=await request('/api/session',undefined,{Cookie:cookie});
   const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
   for(const [message,expected] of [
    [`qual é a nossa música de bom dia?`,`sua música de bom dia é ${song}.`],
    [`qual time a gente torce?`,`seu time é ${team}.`],
    [`qual é o meu time do coração?`,`seu time é ${team}.`],
   ]){
    const result=await request('/api/chat',{message},headers);
    assert.equal(result.body.source,'local_memory',message);
    assert.equal(result.body.reply,expected,message);
   }
   const playback=await request('/api/chat',{message:'Jarvis, toca nossa música de bom dia'},headers);
   assert.equal(playback.body.source,'local_action');
   assert.match(playback.body.reply,new RegExp(song));
  });
 } finally {
  await rm(directory,{recursive:true,force:true});
 }
 assert.deepEqual(providerCalls,[]);
 assert.deepEqual(actions,[['play_youtube',{query:song}]]);
});

test('contexto pessoal sobrevive a limpar conversa, logout e reinício e chega ao provedor',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'jarvis-personal-memory-test-'));
 const calls=[],actions=[];
 const options={accessCode:'chat-test',memoryFilePath:join(directory,'memory.json'),
  googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  generateReply:async request=>{calls.push(request);return structuredReply('Plano do projeto');},
  executeAction:async(...args)=>{actions.push(args);return {ok:true,status:'completed',verified:true};}};
 const authenticate=async request=>{
  const login=await request('/api/login',{code:'chat-test'});
  const cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  return {Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
 };
 try {
  await withServer(options,async request=>{
   const headers=await authenticate(request);
   for(const message of ['lembra que meu projeto atual é Jarvis','lembra que prefiro respostas curtas']) {
    const result=await request('/api/chat',{message},headers);
    assert.equal(result.response.status,200);
    assert.equal(result.body.source,'local_memory');
   }
   assert.equal((await request('/api/chat/clear',{},headers)).response.status,200);
   assert.equal((await request('/api/chat',{message:'qual é meu projeto atual?'},headers)).body.reply,'projeto atual é Jarvis.');
   assert.equal((await request('/api/logout',{},headers)).response.status,200);
   const newHeaders=await authenticate(request);
   assert.equal((await request('/api/chat',{message:'qual é minhas preferências?'},newHeaders)).body.reply,'preferencias é respostas curtas.');
  });
  await withServer(options,async request=>{
   const headers=await authenticate(request);
   const response=await request('/api/chat',{message:'Me ajude a planejar o próximo passo'},headers);
   assert.equal(response.response.status,200);
   assert.equal(calls.length,1);
   assert.deepEqual(calls[0].history,[]);
   assert.match(calls[0].systemPrompt,/projeto atual: "Jarvis"/);
   assert.match(calls[0].systemPrompt,/preferencias: "respostas curtas"/);
   const local=await request('/api/chat',{message:'toca minha música favorita é teste no YouTube'},headers);
   assert.equal(local.body.source,'local_action');
   assert.deepEqual(actions,[['play_youtube',{query:'minha música favorita é teste'}]]);
   assert.equal(calls.length,1);
   assert.equal((await request('/api/chat',{message:'atualiza meu projeto atual para Assistente'},headers)).response.status,200);
   assert.equal((await request('/api/chat',{message:'qual é meu projeto atual?'},headers)).body.reply,'projeto atual é Assistente.');
   assert.equal((await request('/api/chat',{message:'esquece meu projeto atual'},headers)).response.status,200);
   assert.match((await request('/api/chat',{message:'qual é meu projeto atual?'},headers)).body.reply,/Ainda não tenho/);
  });
 } finally {
  await rm(directory,{recursive:true,force:true});
 }
});

test('memória indisponível não impede comandos locais nem conversa com IA',async()=>{
 const actions=[],calls=[];
 const unavailable=async()=>{throw new Error('MEMORY_STORAGE_UNAVAILABLE');};
 await withServer({accessCode:'chat-test',memoryStore:{initialize:unavailable,setFact:unavailable,getFact:unavailable},
  googleApiKey:'gemini-test-key',googleModel:'gemini-test',logger:{info(){},warn(){}},
  generateReply:async request=>{calls.push(request);return structuredReply('Resposta sem memória');},
  executeAction:async(...args)=>{actions.push(args);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  assert.equal((await request('/api/chat',{message:'lembra que meu projeto atual é Jarvis'},headers)).response.status,503);
  assert.equal((await request('/api/chat',{message:'qual é meu projeto atual?'},headers)).response.status,503);
  assert.equal((await request('/api/chat',{message:'abra o Chrome'},headers)).body.source,'local_action');
  assert.equal((await request('/api/chat',{message:'Oi'},headers)).body.reply,'Resposta sem memória');
  assert.deepEqual(actions,[['open_chrome',undefined]]);
  assert.equal(calls.length,1);
  assert.doesNotMatch(calls[0].systemPrompt,/Fatos locais relevantes/);
 });
});

test('comandos naturais salvam, consultam, atualizam e esquecem memória local',async()=>{
 const providerCalls=[];
 const song=`Song-${randomUUID()}`,updatedSong=`Song-${randomUUID()}`;
 await withServer({accessCode:'chat-test',googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  generateReply:async request=>{providerCalls.push(request);return structuredReply('não deveria chamar');},
  generateOpenRouter:async request=>{providerCalls.push(request);return structuredReply('não deveria chamar');}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  for(const [message,expected] of [
  [`minha música favorita é ${song}`,'Guardei sua música favorita na memória.'],
  [`Jarvis, lembra que minha música de acordar é ${song}`,'Guardei sua música de acordar na memória.'],
  ['qual é minha música favorita?',`sua música favorita é ${song}.`],
  ['qual é minha música de acordar?',`sua música de acordar é ${song}.`],
  [`atualiza minha música favorita para ${updatedSong}`,'Atualizei sua música favorita na memória.'],
  ['o que você lembra sobre minha música favorita',`sua música favorita é ${updatedSong}.`],
   ['Jarvis, esquece minha música favorita','Esqueci sua música favorita.'],
   ['qual é minha música favorita?','Ainda não tenho sua música favorita salvo.'],
  ]) {
   const result=await request('/api/chat',{message},headers);
   assert.equal(result.response.status,200,message);
   assert.equal(result.body.source,'local_memory',message);
   assert.equal(result.body.reply,expected,message);
  }
  const exposed=await request('/runtime/data/memory.json',undefined,headers);
  assert.equal(exposed.response.status,404);
  assert.doesNotMatch(JSON.stringify((await request('/api/status',undefined,headers)).body),/runtime[\\/]data|memory\.json/);
 });
 assert.deepEqual(providerCalls,[]);
});

test('comando de memória com credencial é recusado sem salvar nem confirmar',async()=>{
 const providerCalls=[],sensitive='api_key=sk-test-secret-value-123456';
 await withServer({accessCode:'chat-test',googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  generateReply:async request=>{providerCalls.push(request);return structuredReply('não deveria chamar');}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const attempted=await request('/api/chat',{message:`lembra que minha música favorita é ${sensitive}`},headers);
  assert.equal(attempted.response.status,400);
  assert.doesNotMatch(JSON.stringify(attempted.body),/sk-test-secret-value/);
  const query=await request('/api/chat',{message:'qual é minha música favorita?'},headers);
  assert.match(query.body.reply,/Ainda não tenho/);
 });
 assert.deepEqual(providerCalls,[]);
});

test('músicas favoritas e de acordar viram play_youtube local sem providers',async()=>{
 const providerCalls=[],actions=[];
 const favoriteSong=`Song-${randomUUID()}`,wakeSong=`Song-${randomUUID()}`;
 await withServer({accessCode:'chat-test',googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  openrouterApiKey:'router-test-key',openrouterModel:'openrouter/free',
  generateReply:async request=>{providerCalls.push(request);return structuredReply('não deveria chamar');},
  generateOpenRouter:async request=>{providerCalls.push(request);return structuredReply('não deveria chamar');},
  executeAction:async(...args)=>{actions.push(args);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  for(const message of [`minha música favorita é ${favoriteSong}`,`minha música de acordar é ${wakeSong}`]) {
   assert.equal((await request('/api/chat',{message},headers)).body.source,'local_memory');
  }
  for(const [message,query] of [
  ['toca minha música favorita',favoriteSong],
  ['Jarvis, toca minha música de acordar por favor',wakeSong],
  ]) {
   const result=await request('/api/chat',{message},headers);
   assert.equal(result.response.status,200);
   assert.equal(result.body.source,'local_action');
   assert.match(result.body.reply,new RegExp(query));
  }
 });
 assert.deepEqual(actions,[
  ['play_youtube',{query:favoriteSong}],
  ['play_youtube',{query:wakeSong}],
 ]);
 assert.deepEqual(providerCalls,[]);
});

test('fatos relevantes iguais chegam ao Gemini e OpenRouter no fallback',async()=>{
 const geminiRequests=[],openrouterRequests=[];
 const team=`Team-${randomUUID()}`;
 await withServer({accessCode:'chat-test',googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  openrouterApiKey:'router-test-key',openrouterModel:'openrouter/free',
  generateReply:async request=>{
   geminiRequests.push(request);
   const error=new Error('unavailable');error.status=503;throw error;
  },
  generateOpenRouter:async request=>{
   openrouterRequests.push(request);
  return structuredReply(`Nosso time é ${team}.`);
  }},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  await request('/api/chat',{message:`de agora em diante nosso time é ${team}`},headers);
  const result=await request('/api/chat',{message:'Me conta algo sobre o nosso time.'},headers);
  assert.equal(result.response.status,200);
  assert.equal(result.body.source,'openrouter');
 });
 assert.equal(geminiRequests.length,1);
 assert.equal(openrouterRequests.length,1);
 assert.equal(geminiRequests[0].systemPrompt,openrouterRequests[0].systemPrompt);
 assert.match(openrouterRequests[0].systemPrompt,new RegExp(`time: "${team}"`));
});

test('OpenAI habilitada só recebe requisição após falha de Gemini e OpenRouter',async()=>{
 const order=[];
 await withServer({accessCode:'chat-test',openaiEnabled:true,openaiApiKey:'openai-test-key',openaiModel:'gpt-6-sol',
  openrouterApiKey:'router-test-key',openrouterModel:'openrouter/free',
  googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  generateReply:async()=>{order.push('gemini');const error=new Error('unavailable');error.status=503;throw error;},
  generateOpenRouter:async()=>{order.push('openrouter');const error=new Error('unavailable');error.status=503;throw error;},
  generateOpenAI:async()=>{order.push('openai');return '{"type":"reply","reply":"OpenAI opcional"}';}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'Oi'},headers);
  assert.equal(result.body.reply,'OpenAI opcional');
  assert.equal(result.body.source,'openai');
 });
 assert.deepEqual(order,['gemini','openrouter','openai']);
});

test('ação estruturada inválida do OpenRouter nunca é executada',async()=>{
 const actions=[];
 await withServer({accessCode:'chat-test',googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  openrouterApiKey:'router-test-key',openrouterModel:'openrouter/free',
  generateReply:async()=>{const error=new Error('unavailable');error.status=503;throw error;},
  generateOpenRouter:async()=>JSON.stringify({type:'action',action:'run_command',params:{command:'calc.exe'}}),
  executeAction:async(...args)=>actions.push(args)},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'execute calc'},headers);
  assert.equal(result.response.status,200);
  assert.match(result.body.reply,/ainda não está disponível/);
 });
 assert.deepEqual(actions,[]);
});

test('sem chave OpenAI, conversas continuam pelo Gemini',async()=>{
 const openaiCalls=[],geminiCalls=[];
 await withServer({accessCode:'chat-test',openaiApiKey:'',openaiModel:'gpt-6-sol',
  googleApiKey:'gemini-test-key',googleModel:'gemini-test',
  generateOpenAI:async request=>{openaiCalls.push(request);return structuredReply('não deveria chamar');},
  generateReply:async request=>{geminiCalls.push(request);return structuredReply('Resposta Gemini sem OpenAI.');}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const status=await request('/api/status',undefined,headers);
  assert.equal(status.body.openaiConfigured,false);
  assert.equal(status.body.geminiConfigured,true);
  const result=await request('/api/chat',{message:'Oi'},headers);
  assert.equal(result.body.reply,'Resposta Gemini sem OpenAI.');
  assert.equal(result.body.source,'gemini');
 });
 assert.deepEqual(openaiCalls,[]);
 assert.equal(geminiCalls.length,1);
});

test('falha Gemini e OpenRouter retorna erro amigável sem tentar OpenAI desabilitada',async()=>{
 const openaiCalls=[],geminiModels=[],openrouterCalls=[];
 await withServer({accessCode:'chat-test',openaiApiKey:'openai-test-key',openaiModel:'gpt-6-sol',
  openrouterApiKey:'router-test-key',openrouterModel:'openrouter/free',
  googleApiKey:'gemini-test-key',googleModel:'gemini-primary',
  generateOpenAI:async request=>{openaiCalls.push(request);const error=new Error('unavailable');error.status=503;throw error;},
  generateOpenRouter:async request=>{openrouterCalls.push(request);const error=new Error('unavailable');error.status=503;throw error;},
  generateReply:async({model})=>{geminiModels.push(model);const error=new Error('unavailable');error.status=503;throw error;}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'Oi'},headers);
  assert.equal(result.response.status,502);
  assert.match(result.body.error,/temporariamente indisponível/);
 });
 assert.deepEqual(openaiCalls,[]);
 assert.equal(openrouterCalls.length,1);
 assert.deepEqual(geminiModels,['gemini-primary']);
});

test('comandos de volume executam localmente e não chamam nenhum provider',async()=>{
 const providers=[],actions=[];
 await withServer({accessCode:'chat-test',openaiEnabled:true,openaiApiKey:'openai-key',openaiModel:'test',
  openrouterApiKey:'router-key',openrouterModel:'openrouter/free',googleApiKey:'gemini-key',googleModel:'gemini-test',
  generateReply:async request=>{providers.push(request);return structuredReply('não deveria chamar');},
  generateOpenRouter:async request=>{providers.push(request);return structuredReply('não deveria chamar');},
  generateOpenAI:async request=>{providers.push(request);return structuredReply('não deveria chamar');},
  executeAction:async(...args)=>{actions.push(args);return {ok:true,status:'completed',verified:true};}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  for(const [message,expected] of [
   ['Jarvis, volume em 50%','Volume ajustado para 50%.'],
   ['Jarvis, volume em 70%','Volume ajustado para 70%.'],
   ['coloca o volume em 30','Volume ajustado para 30%.'],
   ['volume máximo','Volume ajustado para 100%.'],
   ['aumenta o volume','Volume aumentado.'],
   ['abaixa o volume','Volume reduzido.'],
   ['diminui o volume','Volume reduzido.'],
   ['coloca no mudo','Som desativado.'],
   ['tira do mudo','Som ativado.'],
  ]){
   const result=await request('/api/chat',{message},headers);
   assert.equal(result.response.status,200,message);
   assert.equal(result.body.source,'local_action',message);
   assert.equal(result.body.reply,expected,message);
  }
  for(const message of ['volume em -1%','volume em 101%']){
   const result=await request('/api/chat',{message},headers);
   assert.equal(result.response.status,400,message);
  }
 });
 assert.deepEqual(providers,[]);
 assert.deepEqual(actions.slice(0,9),[
  ['set_volume',{percent:50}],['set_volume',{percent:70}],['set_volume',{percent:30}],['set_volume',{percent:100}],
  ['volume_up',{}],['volume_down',{}],['volume_down',{}],['mute',{}],['unmute',{}],
 ]);
 assert.equal(actions.length,9);
});

test('falha ao executar volume não confirma alteração',async()=>{
 const providers=[];
 await withServer({accessCode:'chat-test',googleApiKey:'gemini-key',googleModel:'gemini-test',
  generateReply:async request=>{providers.push(request);return structuredReply('não deveria chamar');},
  generateOpenRouter:async request=>{providers.push(request);return structuredReply('não deveria chamar');},
  executeAction:async()=>{throw new Error('VOLUME_CONTROL_FAILED');}},async request=>{
  const login=await request('/api/login',{code:'chat-test'}),cookie=login.response.headers.get('set-cookie').split(';')[0];
  const session=await request('/api/session',undefined,{Cookie:cookie});
  const headers={Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
  const result=await request('/api/chat',{message:'volume em 50%'},headers);
  assert.equal(result.response.status,503);
  assert.equal(result.body.error,'Não consegui alterar o volume.');
  assert.doesNotMatch(JSON.stringify(result.body),/Volume ajustado/);
 });
 assert.deepEqual(providers,[]);
});
