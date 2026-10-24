import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AIProviderFailure, createAIResponseRouter } from '../packages/providers/ai-router.mjs';
import { generateOpenRouterResponse, OPENROUTER_API_URL } from '../packages/providers/openrouter.mjs';
import { DEFAULT_PROVIDER_TIMEOUTS_MS, resolveProviderTimeoutMs } from '../packages/providers/timeouts.mjs';

const rememberedTeam=`Team-${randomUUID()}`;
const history=[{role:'user',text:`Meu time é ${rememberedTeam}.`},{role:'model',text:`Você torce para ${rememberedTeam}.`}];
const jsonReply='{"type":"reply","reply":"Resposta do provider"}';

function makeRouter({geminiError,openrouterError,openaiError,openrouterApiKey='router-test-secret',
 openaiEnabled=false,geminiApiKey='gemini-test-secret',logs=[]}={}) {
 const calls={gemini:[],openrouter:[],openai:[]};
 const router=createAIResponseRouter({
  geminiApiKey,geminiModel:'gemini-test',geminiFallbackModels:[],
  openrouterApiKey,openrouterModel:'openrouter/free',
  openaiEnabled,openaiApiKey:'openai-test-secret',openaiModel:'gpt-test',
  logger:{info:message=>logs.push(message),warn:message=>logs.push(message)},
  geminiProvider:{generateResponse:async request=>{calls.gemini.push(request);if(geminiError)throw geminiError;return jsonReply;}},
  openrouterProvider:{generateResponse:async request=>{calls.openrouter.push(request);if(openrouterError)throw openrouterError;return jsonReply;}},
  openaiProvider:{generateResponse:async request=>{calls.openai.push(request);if(openaiError)throw openaiError;return jsonReply;}},
 });
 return {router,calls};
}

function statusError(status) {
 const error=new Error('provider response details must not be logged');
 error.status=status;
 return error;
}

function apiResponse(status, data, contentType = 'application/json; charset=utf-8') {
 return {
  ok:status>=200&&status<300,
  status,
  headers:{get:name=>name.toLowerCase()==='content-type'?contentType:null},
  text:async()=>JSON.stringify(data),
 };
}

test('Gemini responde primeiro e evita OpenRouter e OpenAI',async()=>{
 const logs=[],{router,calls}=makeRouter({logs});
 const result=await router.generateResponse({message:'toca música do nosso time',history});
 assert.equal(result.provider,'gemini');
 assert.equal(calls.gemini.length,1);
 assert.equal(calls.gemini[0].timeoutMs,DEFAULT_PROVIDER_TIMEOUTS_MS.gemini);
 assert.equal(calls.gemini[0].signal instanceof AbortSignal,true);
 assert.deepEqual(calls.openrouter,[]);
 assert.deepEqual(calls.openai,[]);
 assert.deepEqual(calls.gemini[0].messages,[
  {role:'user',content:`Meu time é ${rememberedTeam}.`},
  {role:'assistant',content:`Você torce para ${rememberedTeam}.`},
  {role:'user',content:'toca música do nosso time'},
 ]);
 assert.match(calls.gemini[0].systemPrompt,/JARVIS TECH VIEW/);
 assert.match(logs.join('\n'),/Gemini respondeu/);
});

test('Gemini lento é abortado no timeout e OpenRouter responde com o mesmo contexto',async()=>{
 const logs=[],requests=[];
 let geminiAborted=false;
 const router=createAIResponseRouter({
  geminiApiKey:'gemini-secret',geminiModel:'gemini-test',geminiFallbackModels:['gemini-fallback'],
  openrouterApiKey:'router-secret',openrouterModel:'openrouter/free',
  geminiTimeoutMs:1000,openrouterTimeoutMs:1000,
  geminiProvider:{generateResponse:request=>{
   requests.push(request);
   return new Promise((resolve,reject)=>request.signal.addEventListener('abort',()=>{
    geminiAborted=true;
    reject(Object.assign(new Error('aborted'),{name:'AbortError'}));
   },{once:true}));
  }},
  openrouterProvider:{generateResponse:async request=>{requests.push(request);return jsonReply;}},
  openaiProvider:{generateResponse:async()=>assert.fail('OpenAI está desabilitada')},
  logger:{info:message=>logs.push(message),warn:message=>logs.push(message)},
 });

 const result=await router.generateResponse({message:'E qual é o segundo?',history});
 assert.equal(geminiAborted,true);
 assert.equal(requests.length,2);
 assert.equal(requests[0].timeoutMs,1000);
 assert.equal(requests[0].signal.aborted,true);
 assert.equal(requests[1].timeoutMs,1000);
 assert.deepEqual(requests[0].messages,requests[1].messages);
 assert.equal(result.provider,'openrouter');
 assert.match(logs.join('\n'),/Gemini timeout de 1000ms em \d+ms/);
});

test('OpenRouter abortado não pode entregar uma resposta tardia',async()=>{
 const logs=[];
 let openrouterSignal,completeLateResponse;
 const router=createAIResponseRouter({
  geminiApiKey:'',geminiModel:'',openrouterApiKey:'router-secret',openrouterModel:'openrouter/free',
  openrouterTimeoutMs:1000,
  geminiProvider:{generateResponse:async()=>assert.fail('Gemini sem chave')},
  openrouterProvider:{generateResponse:request=>{
   openrouterSignal=request.signal;
   return new Promise(resolve=>{completeLateResponse=resolve;});
  }},
  openaiProvider:{generateResponse:async()=>assert.fail('OpenAI está desabilitada')},
  logger:{info:message=>logs.push(message),warn:message=>logs.push(message)},
 });

 await assert.rejects(router.generateResponse({message:'Responda'}),error=>
  error instanceof AIProviderFailure&&error.code==='AI_TEMPORARILY_UNAVAILABLE');
 assert.equal(openrouterSignal.aborted,true);
 assert.match(logs.join('\n'),/OpenRouter timeout de 1000ms em \d+ms/);

 completeLateResponse(jsonReply);
 await new Promise(resolve=>setImmediate(resolve));
 assert.doesNotMatch(logs.join('\n'),/OpenRouter respondeu/);
});

test('timeouts configuráveis aceitam somente valores inteiros dentro do limite seguro',()=>{
 assert.equal(resolveProviderTimeoutMs('gemini','6000'),6000);
 assert.equal(resolveProviderTimeoutMs('openrouter','500'),DEFAULT_PROVIDER_TIMEOUTS_MS.openrouter);
 assert.equal(resolveProviderTimeoutMs('gemini','30001'),DEFAULT_PROVIDER_TIMEOUTS_MS.gemini);
});

for(const [label,makeError] of [
 ['HTTP 503',()=>statusError(503)],
 ['HTTP 429',()=>statusError(429)],
 ['HTTP 400',()=>statusError(400)],
 ['HTTP 401',()=>statusError(401)],
 ['HTTP 403',()=>statusError(403)],
 ['timeout',()=>Object.assign(new Error('timeout'),{name:'APIConnectionTimeoutError'})],
]) {
 test(`Gemini ${label} tenta OpenRouter e retorna sua resposta`,async()=>{
  const logs=[],{router,calls}=makeRouter({geminiError:makeError(),logs});
  const result=await router.generateResponse({message:'E o nosso time?',history});
  assert.equal(result.provider,'openrouter');
  assert.equal(calls.gemini.length,1);
  assert.equal(calls.openrouter.length,1);
  assert.deepEqual(calls.openrouter[0].messages,calls.gemini[0].messages);
  assert.equal(calls.openrouter[0].systemPrompt,calls.gemini[0].systemPrompt);
  assert.deepEqual(calls.openai,[]);
  assert.match(logs.join('\n'),/tentando OpenRouter: openrouter\/free/);
 });
}

test('Gemini sem API key pula para OpenRouter',async()=>{
 const logs=[],{router,calls}=makeRouter({geminiApiKey:'',logs});
 const result=await router.generateResponse({message:'Explique buracos negros em uma frase.'});
 assert.equal(result.provider,'openrouter');
 assert.deepEqual(calls.gemini,[]);
 assert.equal(calls.openrouter.length,1);
 assert.deepEqual(calls.openai,[]);
 assert.match(logs.join('\n'),/Gemini falhou \(não configurado\)/);
});

test('Gemini e OpenRouter indisponíveis sem OpenAI habilitada retornam falha amigável',async()=>{
 const logs=[],{router,calls}=makeRouter({geminiError:statusError(503),openrouterError:statusError(502),logs});
 await assert.rejects(router.generateResponse({message:'Oi'}),error=>
  error instanceof AIProviderFailure&&error.code==='AI_TEMPORARILY_UNAVAILABLE');
 assert.equal(calls.openai.length,0);
 assert.match(logs.join('\n'),/OpenAI desabilitada/);
});

test('Gemini e OpenRouter recebem o mesmo contexto local relevante',async()=>{
 const requests=[];
 const context=`\n\nFatos locais relevantes lembrados pelo Jarvis.\n- time: "${rememberedTeam}"`;
 const router=createAIResponseRouter({
  geminiApiKey:'gemini-secret',geminiModel:'gemini-test',geminiFallbackModels:[],
  openrouterApiKey:'router-secret',openrouterModel:'openrouter/free',
  openaiEnabled:false,openaiApiKey:'openai-secret',openaiModel:'gpt-test',
  geminiProvider:{generateResponse:async request=>{requests.push(request);throw statusError(503);}},
  openrouterProvider:{generateResponse:async request=>{requests.push(request);return jsonReply;}},
  openaiProvider:{generateResponse:async()=>assert.fail('OpenAI está desabilitada')},
  logger:{info:()=>{},warn:()=>{}},
 });
 await router.generateResponse({message:'toca música do meu time',history,memoryContext:context});
 assert.equal(requests.length,2);
 assert.equal(requests[0].systemPrompt,requests[1].systemPrompt);
 assert.match(requests[0].systemPrompt,new RegExp(`time: "${rememberedTeam}"`));
});

test('OpenAI só é chamada como terceiro fallback quando explicitamente habilitada',async()=>{
 const order=[];
 const router=createAIResponseRouter({
  geminiApiKey:'gemini-secret',geminiModel:'gemini-test',geminiFallbackModels:[],
  openrouterApiKey:'router-secret',openrouterModel:'openrouter/free',
  openaiEnabled:true,openaiApiKey:'openai-secret',openaiModel:'gpt-test',
  geminiProvider:{generateResponse:async()=>{order.push('gemini');throw statusError(503);}},
  openrouterProvider:{generateResponse:async()=>{order.push('openrouter');throw statusError(429);}},
  openaiProvider:{generateResponse:async()=>{order.push('openai');return jsonReply;}},
  logger:{info:()=>{},warn:()=>{}},
 });
 const result=await router.generateResponse({message:'Oi'});
 assert.equal(result.provider,'openai');
 assert.deepEqual(order,['gemini','openrouter','openai']);
});

test('chave OpenRouter ausente pula para OpenAI habilitada sem quebrar',async()=>{
 const calls=[];
 const router=createAIResponseRouter({
  geminiApiKey:'',geminiModel:'',openrouterApiKey:'',openrouterModel:'openrouter/free',
  openaiEnabled:true,openaiApiKey:'openai-secret',openaiModel:'gpt-test',
  geminiProvider:{generateResponse:async()=>assert.fail('Gemini sem chave não deve ser chamado')},
  openrouterProvider:{generateResponse:async()=>assert.fail('OpenRouter sem chave não deve ser chamado')},
  openaiProvider:{generateResponse:async()=>{calls.push('openai');return jsonReply;}},
  logger:{info:()=>{},warn:()=>{}},
 });
 assert.equal((await router.generateResponse({message:'Oi'})).provider,'openai');
 assert.deepEqual(calls,['openai']);
});

test('nenhum provider configurado retorna diagnóstico amigável sem chamadas',async()=>{
 const {router,calls}=makeRouter({geminiApiKey:'',openrouterApiKey:''});
 await assert.rejects(router.generateResponse({message:'Oi'}),error=>
  error instanceof AIProviderFailure&&error.code==='AI_NOT_CONFIGURED');
 assert.deepEqual(calls,{gemini:[],openrouter:[],openai:[]});
 assert.deepEqual(router.status,{openaiConfigured:false,openaiEnabled:false,openrouterConfigured:false,geminiConfigured:false});
});

test('logs não contêm chaves nem corpo de erro do provider',async()=>{
 const logs=[];
 const error=new Error('Authorization: Bearer router-test-secret');error.status=503;
 const {router}=makeRouter({geminiError:error,openrouterError:error,logs});
 await assert.rejects(router.generateResponse({message:'Oi'}));
 assert.doesNotMatch(logs.join('\n'),/router-test-secret|gemini-test-secret|openai-test-secret|Authorization|Bearer/);
 assert.match(logs.join('\n'),/Gemini falhou \(HTTP 503\)/);
 assert.match(logs.join('\n'),/OpenRouter falhou \(HTTP 503\)/);
});

test('resposta raw ou com campos analysis/reasoning é rejeitada sem repasse',async()=>{
 const invalidOutputs=[
  'Internal analysis: perhaps the user means a football anthem.',
  JSON.stringify({type:'reply',reply:'Resposta final',analysis:'private analysis'}),
  JSON.stringify({type:'reply',reply:'Resposta final',reasoning_content:'private reasoning'}),
  'prefácio\n{"type":"reply","reply":"extraída"}',
 ];
 for(const output of invalidOutputs) {
  const testRouter=createAIResponseRouter({
   geminiApiKey:'',geminiModel:'',openrouterApiKey:'router-test-secret',openrouterModel:'openrouter/free',
   openaiEnabled:false,openaiApiKey:'openai-test-secret',openaiModel:'gpt-test',
   geminiProvider:{generateResponse:async()=>assert.fail('Gemini sem chave não deve ser chamado')},
   openrouterProvider:{generateResponse:async()=>output},
   openaiProvider:{generateResponse:async()=>assert.fail('OpenAI está desabilitada')},
   logger:{info:()=>{},warn:()=>{}},
  });
  await assert.rejects(testRouter.generateResponse({message:'Oi'}),error=>
   error instanceof AIProviderFailure&&error.code==='AI_TEMPORARILY_UNAVAILABLE');
 }
});

test('roteador registra somente o modelo efetivo retornado pelo OpenRouter',async()=>{
 const logs=[];
 const router=createAIResponseRouter({
  geminiApiKey:'',geminiModel:'',openrouterApiKey:'router-secret',openrouterModel:'openrouter/free',
  openaiEnabled:false,openaiApiKey:'',openaiModel:'',
  geminiProvider:{generateResponse:async()=>assert.fail('Gemini sem chave')},
  openrouterProvider:{generateResponse:async()=>({text:jsonReply,model:'provider/selected-model'})},
  openaiProvider:{generateResponse:async()=>assert.fail('OpenAI desabilitada')},
  logger:{info:message=>logs.push(message),warn:message=>logs.push(message)},
 });
 assert.equal((await router.generateResponse({message:'Oi'})).provider,'openrouter');
 assert.match(logs.join('\n'),/OpenRouter respondeu: provider\/selected-model/);
});

test('provider OpenRouter usa API oficial, contexto e modo JSON em modelos suportados',async()=>{
 let request;
 const logs=[];
 const result=await generateOpenRouterResponse({
  apiKey:'router-test-secret',model:'openai/gpt-4o-mini',systemPrompt:'Instruções Jarvis',
  messages:[{role:'user',content:'contexto'},{role:'assistant',content:'lembrança'}],
  logger:{info:message=>logs.push(message),warn:message=>logs.push(message)},
  fetchImpl:async(url,options)=>{
   request={url,options};
  return apiResponse(200,{model:'provider/effective-model',choices:[{finish_reason:'stop',message:{content:jsonReply,reasoning:'never expose this'}}]});
  },
 });
 assert.deepEqual(result,{text:jsonReply,model:'provider/effective-model'});
 assert.equal(request.url,OPENROUTER_API_URL);
 assert.equal(request.options.headers.Authorization,'Bearer router-test-secret');
 const body=JSON.parse(request.options.body);
 assert.equal(body.model,'openai/gpt-4o-mini');
 assert.deepEqual(body.messages,[
  {role:'system',content:'Instruções Jarvis'},
  {role:'user',content:'contexto'},
  {role:'assistant',content:'lembrança'},
 ]);
 assert.deepEqual(body.provider,{require_parameters:true});
 assert.deepEqual(body.reasoning,{effort:'none',exclude:true});
 assert.deepEqual(body.response_format,{type:'json_object'});
 assert.equal(body.max_tokens,1024);
 assert.match(logs.join('\n'),/OpenRouter HTTP 200/);
 assert.match(logs.join('\n'),/modelo efetivo: provider\/effective-model/);
 assert.match(logs.join('\n'),/finish_reason: stop/);
 assert.match(logs.join('\n'),/choices presentes: true/);
 assert.match(logs.join('\n'),/choices: 1/);
 assert.match(logs.join('\n'),/message presente: true/);
 assert.match(logs.join('\n'),/content presente: true/);
 assert.match(logs.join('\n'),/content tipo: string/);
 assert.match(logs.join('\n'),new RegExp(`content tamanho: ${jsonReply.length}`));
 assert.match(logs.join('\n'),/reasoning presente: true/);
 assert.doesNotMatch(logs.join('\n'),/never expose this/);
});

test('modelo free do OpenRouter evita parâmetros de provider incompatíveis',async()=>{
 let request;
 const logs=[];
 const result=await generateOpenRouterResponse({
  apiKey:'router-test-secret',model:'openrouter/free',systemPrompt:'Instruções Jarvis',
  messages:[{role:'user',content:'contexto'}],
  logger:{info:message=>logs.push(message),warn:message=>logs.push(message)},
  fetchImpl:async(url,options)=>{
   request={url,options};
  return apiResponse(200,{model:'openrouter/free',choices:[{finish_reason:'stop',message:{content:jsonReply}}]});
  },
 });
 assert.deepEqual(result,{text:jsonReply,model:'openrouter/free'});
 const body=JSON.parse(request.options.body);
 assert.deepEqual(body.messages,[
  {role:'system',content:'Instruções Jarvis'},
  {role:'user',content:'contexto'},
 ]);
 assert.equal(body.model,'openrouter/free');
 assert.equal(body.max_tokens,1024);
 assert.equal(body.provider,undefined);
 assert.equal(body.reasoning,undefined);
 assert.equal(body.response_format,undefined);
 assert.match(logs.join('\n'),/OpenRouter HTTP 200/);
});

test('OpenRouter aceita content textual em blocos e no campo text compatível',async()=>{
 for(const [model,data,expected] of [
  ['openrouter/free',{model:'provider/free',choices:[{message:{content:[
   {type:'text',text:'Resposta em '},{type:'text',text:'partes.'},{type:'image_url',image_url:{url:'private-image-reference'}},
  ]}}]},'Resposta em partes.'],
  ['provider/legacy',{model:'provider/legacy',choices:[{text:'Resposta no formato text.'}]},'Resposta no formato text.'],
 ]) {
  const logs=[];
  const result=await generateOpenRouterResponse({apiKey:'router-secret',model,messages:[],systemPrompt:'',
   fetchImpl:async()=>apiResponse(200,data),logger:{info:message=>logs.push(message),warn:message=>logs.push(message)}});
  assert.equal(result.text,expected);
  assert.doesNotMatch(logs.join('\n'),/private-image-reference/);
 }
});

test('OpenRouter HTTP 200 com envelope error é rejeitado sem sucesso falso',async()=>{
 const logs=[];
 await assert.rejects(generateOpenRouterResponse({apiKey:'router-secret',model:'openrouter/free',messages:[],systemPrompt:'',
  fetchImpl:async()=>apiResponse(200,{error:{code:'no_endpoints',message:'sensitive provider detail'}}),
  logger:{info:message=>logs.push(message),warn:message=>logs.push(message)},
 }),error=>error.code==='PROVIDER_API_ERROR'&&error.status===200);
 assert.match(logs.join('\n'),/OpenRouter error.code: no_endpoints/);
 assert.match(logs.join('\n'),/choices presentes: false/);
 assert.doesNotMatch(logs.join('\n'),/sensitive provider detail|router-secret/);
});

test('abort durante a leitura do body não vira JSON inválido e segue como timeout único',async()=>{
 const logs=[];
 const router=createAIResponseRouter({
  geminiApiKey:'',geminiModel:'',openrouterApiKey:'router-secret',openrouterModel:'openrouter/free',
  openrouterTimeoutMs:1000,
  geminiProvider:{generateResponse:async()=>assert.fail('Gemini sem chave')},
  openrouterProvider:{generateResponse:request=>generateOpenRouterResponse({
   ...request,
   fetchImpl:async(_url,options)=>({ok:true,status:200,headers:{get:()=> 'application/json'},
    text:()=>new Promise((_,reject)=>options.signal.addEventListener('abort',()=>
     reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true})),
   }),
  })},
  openaiProvider:{generateResponse:async()=>assert.fail('OpenAI está desabilitada')},
  logger:{info:message=>logs.push(message),warn:message=>logs.push(message)},
 });

 await assert.rejects(router.generateResponse({message:'Explique brevemente'}),error=>
  error instanceof AIProviderFailure&&error.code==='AI_TEMPORARILY_UNAVAILABLE');
 const output=logs.join('\n');
 assert.match(output,/OpenRouter HTTP 200/);
 assert.match(output,/OpenRouter timeout de 1000ms em \d+ms/);
 assert.doesNotMatch(output,/corpo HTTP não é JSON|JSON da API inválido|choices presentes: false/);
 assert.equal((output.match(/OpenRouter timeout de 1000ms/g)||[]).length,1);
});

test('deadline do OpenRouter é limpo após sucesso e não aborta uma resposta concluída',async()=>{
 const logs=[];
 let signal;
 const router=createAIResponseRouter({
  geminiApiKey:'',geminiModel:'',openrouterApiKey:'router-secret',openrouterModel:'openrouter/free',
  openrouterTimeoutMs:1000,
  geminiProvider:{generateResponse:async()=>assert.fail('Gemini sem chave')},
  openrouterProvider:{generateResponse:request=>{
   signal=request.signal;
   return generateOpenRouterResponse({...request,fetchImpl:async()=>apiResponse(200,{
    model:'provider/fast-free',choices:[{message:{content:jsonReply}}],
   })});
  }},
  openaiProvider:{generateResponse:async()=>assert.fail('OpenAI está desabilitada')},
  logger:{info:message=>logs.push(message),warn:message=>logs.push(message)},
 });

 const result=await router.generateResponse({message:'Responda agora'});
 assert.equal(result.provider,'openrouter');
 await new Promise(resolve=>setTimeout(resolve,1050));
 assert.equal(signal.aborted,false);
 assert.doesNotMatch(logs.join('\n'),/OpenRouter timeout/);
});

test('OpenRouter HTTP 200 converte content textual em reply conversacional sem expor conteúdo nos logs',async()=>{
 const plainText='A Lua não cai na Terra porque está sempre caindo ao redor dela, em órbita.';
 const logs=[];
 const router=createAIResponseRouter({
  geminiApiKey:'',geminiModel:'',openrouterApiKey:'router-secret',openrouterModel:'openrouter/free',
  openaiEnabled:false,openaiApiKey:'',openaiModel:'',
  geminiProvider:{generateResponse:async()=>assert.fail('Gemini sem chave')},
  openrouterProvider:{generateResponse:request=>generateOpenRouterResponse({
   ...request,
  fetchImpl:async()=>apiResponse(200,{model:'poolside/laguna-s-2.1:free',choices:[{
    finish_reason:'stop',message:{content:plainText},
  }]}),
  })},
  openaiProvider:{generateResponse:async()=>assert.fail('OpenAI está desabilitada')},
  logger:{info:message=>logs.push(message),warn:message=>logs.push(message)},
 });

 const result=await router.generateResponse({message:'me explica de um jeito simples por que a Lua não cai na Terra'});
 assert.equal(result.provider,'openrouter');
 assert.deepEqual(JSON.parse(result.text),{type:'reply',reply:plainText});
 assert.doesNotMatch(logs.join('\n'),/A Lua não cai/);
});

test('provider OpenRouter devolve status sem propagar corpo potencialmente sensível',async()=>{
 const logs=[];
 await assert.rejects(generateOpenRouterResponse({apiKey:'secret',messages:[],systemPrompt:'',fetchImpl:async()=>
  apiResponse(503,{error:{code:'upstream_error',message:'secret response body'}}),
 logger:{info:message=>logs.push(message),warn:message=>logs.push(message)}}),error=>error.status===503&&!error.message.includes('secret response body'));
 assert.match(logs.join('\n'),/OpenRouter HTTP 503/);
 assert.match(logs.join('\n'),/error.code: upstream_error/);
 assert.match(logs.join('\n'),/error.message seguro: mensagem do provider omitida/);
 assert.doesNotMatch(logs.join('\n'),/secret response body|Authorization|Bearer|router-test-secret/);
});

test('content ausente com reasoning separado é registrado sem expor reasoning',async()=>{
 const logs=[];
 await assert.rejects(generateOpenRouterResponse({apiKey:'secret',messages:[],systemPrompt:'',logger:{
  info:message=>logs.push(message),warn:message=>logs.push(message),
 },fetchImpl:async()=>apiResponse(200,{model:'provider/reasoning-model',choices:[{
  finish_reason:'length',message:{content:null,reasoning_content:'private reasoning must not appear'},
 }]})}),error=>error.code==='EMPTY_RESPONSE');
 assert.match(logs.join('\n'),/OpenRouter HTTP 200/);
 assert.match(logs.join('\n'),/modelo efetivo: provider\/reasoning-model/);
 assert.match(logs.join('\n'),/finish_reason: length/);
 assert.match(logs.join('\n'),/choices: 1/);
 assert.match(logs.join('\n'),/content presente: false/);
 assert.match(logs.join('\n'),/reasoning presente: true/);
 assert.match(logs.join('\n'),/resposta rejeitada com segurança: content ausente/);
 assert.doesNotMatch(logs.join('\n'),/private reasoning must not appear/);
});
