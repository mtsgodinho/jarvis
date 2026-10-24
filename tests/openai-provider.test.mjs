import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_PROVIDER_TIMEOUT_MS, DEFAULT_OPENAI_MODEL, generateOpenAIResponse } from '../packages/providers/openai.mjs';

test('provider OpenAI usa Responses API, JSON mode, timeout curto e retries desligados',async()=>{
  let clientOptions,request;
  const result=await generateOpenAIResponse({
    messages:[{role:'user',content:'Oi'}],systemPrompt:'Responda em JSON.',apiKey:'openai-test-secret',model:DEFAULT_OPENAI_MODEL,
    clientFactory:options=>{
      clientOptions=options;
      return {responses:{create:async parameters=>{request=parameters;return {status:'completed',output_text:'{"type":"reply","reply":"Olá"}'};}}};
    },
  });
  assert.equal(DEFAULT_OPENAI_MODEL,'gpt-6-sol');
  assert.equal(clientOptions.timeout,AI_PROVIDER_TIMEOUT_MS);
  assert.equal(clientOptions.maxRetries,0);
  assert.equal(clientOptions.logLevel,'off');
  assert.equal(request.model,'gpt-6-sol');
  assert.equal(request.instructions,'Responda em JSON.');
  assert.deepEqual(request.input,[
    {role:'developer',content:'Responda em JSON.'},
    {role:'user',content:'Oi'},
  ]);
  assert.deepEqual(request.text,{format:{type:'json_object'}});
  assert.equal(result,'{"type":"reply","reply":"Olá"}');
});

test('provider OpenAI rejeita resposta incompleta sem expor conteúdo bruto',async()=>{
  await assert.rejects(generateOpenAIResponse({
    messages:[{role:'user',content:'Oi'}],systemPrompt:'JSON',apiKey:'openai-test-secret',model:DEFAULT_OPENAI_MODEL,
    clientFactory:()=>({responses:{create:async()=>({status:'incomplete',output_text:'conteúdo parcial'})}}),
  }),error=>error.code==='EMPTY_RESPONSE'&&error.message==='EMPTY_RESPONSE');
});
