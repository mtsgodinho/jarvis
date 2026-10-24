import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearch,detectResearch} from '../packages/research/index.mjs';
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('intenção de pesquisa distingue consulta, previsão e manchetes',()=>{
 assert.deepEqual(detectResearch('Jarvis, como está o tempo em Porto Alegre?'),{kind:'weather',query:'Porto Alegre'});
 assert.deepEqual(detectResearch('quais são as notícias de hoje?'),{kind:'news'});
 assert.deepEqual(detectResearch('pesquisa na internet sobre inteligência artificial'),{kind:'search',query:'inteligência artificial'});
 assert.equal(detectResearch('abra o Chrome'),null);
});
test('meteorologia consulta localização e fonte com data e URL real',async()=>{
 const calls=[];const service=createResearch({now:()=>new Date('2026-10-24T12:00:00Z'),fetchImpl:async(url,options)=>{
  calls.push(url);assert.equal(options.redirect,'error');
  return calls.length===1?json({results:[{name:'Porto Alegre',country:'Brasil',latitude:-30,longitude:-51}]}):json({timezone:'America/Sao_Paulo',current:{temperature_2m:23,relative_humidity_2m:70,wind_speed_10m:12,time:'2026-10-24T09:00'}});
 }});
 const result=await service.run({kind:'weather',query:'Porto Alegre'});
 assert.equal(calls.length,2);assert.match(result.reply,/23 °C/);assert.match(result.reply,/2026-10-24T09:00/);assert.equal(result.sources.length,2);
});
test('busca retorna trechos consultados e não aceita links de host arbitrário',async()=>{
 const service=createResearch({fetchImpl:async()=>json({query:{pages:{1:{title:'IA',extract:'Texto da fonte',fullurl:'https://pt.wikipedia.org/wiki/IA'},2:{title:'malicioso',fullurl:'http://127.0.0.1/'}}}})});
 const result=await service.run({kind:'search',query:'IA'});assert.equal(result.sources.length,1);assert.match(result.reply,/Texto da fonte/);assert.match(result.reply,/não é uma busca completa/);
});
test('notícias preservam data e origem sem inventar que toda manchete é de hoje',async()=>{
 const service=createResearch({fetchImpl:async()=>new Response('<rss><channel><item><title><![CDATA[Tecnologia &amp; ciência]]></title><link>https://g1.globo.com/tecnologia/noticia.html</link><pubDate>Fri, 23 Oct 2026 12:00:00 GMT</pubDate></item><item><title>bad</title><link>http://127.0.0.1/</link></item></channel></rss>')});
 const result=await service.run({kind:'news'});assert.equal(result.sources.length,1);assert.match(result.reply,/23 Oct 2026/);assert.match(result.reply,/não foram consultados/i);
});
test('rede indisponível, zero resultados e respostas grandes não viram notícias falsas',async()=>{
 await assert.rejects(createResearch({fetchImpl:async()=>{throw new Error('offline');}}).run({kind:'news'}),/offline/);
 await assert.rejects(createResearch({fetchImpl:async()=>json({})}).run({kind:'search',query:'x'}),/RESEARCH_NO_RESULTS/);
 await assert.rejects(createResearch({fetchImpl:async()=>new Response('x'.repeat(1024*1024+1))}).run({kind:'news'}),/RESEARCH_RESPONSE_LIMIT/);
});
