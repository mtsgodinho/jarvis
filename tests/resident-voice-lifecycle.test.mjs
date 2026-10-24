import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createResidentVoiceService} from '../packages/resident-voice/service.mjs';
import {validateResidentVoiceSettings} from '../packages/resident-voice/settings.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function harness(run,options={}){
 const directory=await mkdtemp(path.join(tmpdir(),'jarvis-voice-cycle-'));
 const helper=path.join(directory,'helper.exe');await writeFile(helper,'fixture');
 const children=[],requests=[];const transcripts=[];
 const service=createResidentVoiceService({platform:'win32',dotnetPath:process.execPath,helperExecutablePath:helper,build:async()=>{},
  onTranscript:async text=>{transcripts.push(text);return 'Recebido.';},
  spawnProcess:()=>{
   const child=new EventEmitter();child.exitCode=null;child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
   child.stdin.on('data',chunk=>{for(const line of String(chunk).trim().split('\n')){const message=JSON.parse(line);requests.push(message);if(message.type==='shutdown')setImmediate(()=>child.kill());}});
   child.kill=()=>{child.exitCode=0;child.stdout.end();child.stderr.end();child.emit('close',0);};
   child.send=message=>child.stdout.write(JSON.stringify(message)+'\n');
   children.push(child);setImmediate(()=>child.send({type:'state',data:{state:'awaiting_activation',microphoneActive:true}}));return child;
  },...options});
 try{await run({service,children,requests,transcripts});}finally{await service.stop();await rm(directory,{recursive:true,force:true});}
}
test('configuração de voz rejeita NaN e infinitos',()=>{
 for(const field of ['speakingRate','volume'])for(const value of [NaN,Infinity,-Infinity])assert.equal(validateResidentVoiceSettings({enabled:true,speakingRate:1,volume:1,[field]:value}),null);
});
test('fala residente descarta baixa confiança e eco do reconhecimento durante saudação',async()=>{
 await harness(async({service,children,transcripts})=>{
  await service.start();const child=children[0];
  child.send({type:'transcript',data:{text:'Jarvis abra Chrome',confidence:'Low'}});await tick();assert.equal(transcripts.length,0);
  child.send({type:'transcript',data:{text:'Jarvis'}});await tick();assert.equal(service.status.state,'speaking');
  child.send({type:'transcript',data:{text:'Às suas ordens.'}});await tick();assert.equal(transcripts.length,0);
  child.send({type:'speech_complete'});child.send({type:'state',data:{state:'awaiting_activation',microphoneActive:true}});
  child.send({type:'transcript',data:{text:'abra o Chrome'}});await tick();assert.deepEqual(transcripts,['abra o Chrome']);
 });
});
test('resposta antiga não fala nem bloqueia uma nova ativação após stop/start',async()=>{
 let complete;let count=0;
 await harness(async({service,children,requests})=>{
  await service.start();children[0].send({type:'transcript',data:{text:'Jarvis pedido antigo'}});await tick();
  await service.stop();await service.start();
  children[1].send({type:'transcript',data:{text:'Jarvis pedido novo'}});await tick();
  complete('resposta antiga');await tick();
  assert.equal(count,2);assert.equal(requests.some(item=>item.type==='speak'&&item.text==='resposta antiga'),false);
  assert.equal(requests.some(item=>item.type==='speak'&&item.text==='resposta nova'),true);
 },{onTranscript:async()=>{count++;return count===1?new Promise(resolve=>{complete=resolve;}):'resposta nova';}});
});
test('respostas extensas respeitam limite do sintetizador residente',async()=>{
 await harness(async({service,children,requests})=>{
  await service.start();children[0].send({type:'transcript',data:{text:'Jarvis explica'}});await tick();
  const speech=requests.find(item=>item.type==='speak');assert.equal(speech.text.length,2500);
 },{onTranscript:async()=>'a'.repeat(4000)});
});
