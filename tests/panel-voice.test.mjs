import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createVoiceSession, extractWakeCommand, VOICE_STATES} from '../apps/panel/voice-session.js';
import {selectPortugueseVoice} from '../apps/panel/voice-speech.js';

const panelRoot=new URL('../apps/panel/',import.meta.url);
const [app,html,css,voiceSessionSource]=await Promise.all([
 readFile(new URL('app.js',panelRoot),'utf8'),
 readFile(new URL('index.html',panelRoot),'utf8'),
 readFile(new URL('style.css',panelRoot),'utf8'),
 readFile(new URL('voice-session.js',panelRoot),'utf8'),
]);

test('painel apresenta controles acessíveis e controles de fala',()=>{
 for(const id of ['voice-enable','voice-disable','voice-start','voice-stop','voice-toggle',
  'voice-state','voice-error','microphone-indicator','speech-rate','speech-volume']) {
  assert.match(html,new RegExp(`id="${id}"`));
 }
 assert.match(html,/aria-pressed="false"/);
 assert.match(html,/serviço do navegador/);
 assert.match(html,/Apenas texto após “Jarvis” é enviado ao chat/);
 assert.ok(html.indexOf('id="speech-volume-value"')<html.indexOf('<script type="module"'));
 assert.match(app,/const control=\$\(`#\$\{id\}`\),output=\$\(`#\$\{outputId\}`\)/);
});

test('estados da máquina refletem a interface e áreas futuras ficam inativas',()=>{
 for(const state of ['off','awaiting','listening','processing','speaking','error','offline']) {
  assert.match(css,new RegExp(`body\\[data-state="${state}"\\]`));
 }
 assert.match(html,/id="assistant-core"/);
 assert.match(html,/id="voice-waveform"/);
 assert.match(app,/onState:setVoiceState/);
 assert.match(app,/voiceSession\.setSpeaking\(\)/);
 assert.match(app,/VOICE_STATES\.PROCESSING/);
 for(const label of ['Comandos','Aplicativos','Automação','Projetos','Sistema','Internet','Multimídia','Notas','Configurações']) {
  assert.match(html,new RegExp(`<button[^>]+disabled[^>]+aria-label="${label}"`));
 }
});

test('chat usa a transcrição final e a rota autenticada existente sem transmitir áudio',()=>{
 assert.match(app,/createRecognition:\(\)=>/);
 assert.match(app,/\$\('#voice-enable'\)\.onclick=\(\)=>/);
 assert.match(app,/\$\('#voice-start'\)\.onclick=\(\)=>/);
 assert.match(app,/\$\('#chat-form'\)\.onsubmit=e=>\{e\.preventDefault\(\);sendMessage\(\);\}/);
 assert.match(app,/api\('\/api\/chat',\{message\},\{signal:controller.signal/);
 assert.match(app,/new SpeechSynthesisUtterance\(text\)/);
 assert.match(app,/window\.speechSynthesis\.speak\(utterance\)/);
 assert.match(app,/await speakReply\(result\.reply,\{fromVoice:true\}\)/);
 assert.match(app,/voiceSession\.resume\(\)/);
 assert.match(app,/selectPortugueseVoice\(voices\)/);
 assert.doesNotMatch(app,/getUserMedia|child_process|\bspawn\(|\bexec\(/);
});

test('permissão negada e falhas de reconhecimento são exibidas com tentativas limitadas',()=>{
 assert.match(voiceSessionSource,/MICROPHONE_PERMISSION_DENIED/);
 assert.match(voiceSessionSource,/permissões deste site\/navegador/);
 assert.match(voiceSessionSource,/RECOGNITION_RETRIES_EXHAUSTED/);
});

test('controles administrativos confirmam ações e retomam por cookie sem guardar código',()=>{
 for(const id of ['administration','restart-jarvis','shutdown-jarvis'])assert.match(html,new RegExp(`id="${id}"`));
 assert.match(app,/confirm\('Deseja reiniciar o Jarvis\?'\)/);
 assert.match(app,/confirm\('Deseja realmente desligar o Jarvis\?'\)/);
 assert.match(app,/api\('\/api\/admin\/restart',\{\}\)/);
 assert.match(app,/api\('\/api\/admin\/shutdown',\{\}\)/);
 assert.match(app,/request\('\/api\/resume',\{\}\)/);
 assert.doesNotMatch(app,/accessCode|localStorage|sessionStorage/);
 assert.match(app,/Jarvis reiniciado\./);
 assert.match(app,/scripts\/iniciar-windows\.cmd/);
});

class FakeRecognition {
 constructor(){this.started=false;this.aborted=false;}
 start(){this.started=true;this.onstart?.();}
 abort(){this.aborted=true;}
 emit(transcript,{final=true}={}){
  this.onresult?.({resultIndex:0,results:[Object.assign([{transcript}],{isFinal:final})]});
 }
 fail(error){this.onerror?.({error});}
 end(){this.onend?.();}
}

function createHarness(options={}){
 const recognitions=[],states=[],commands=[],errors=[];
 const session=createVoiceSession({
  createRecognition:()=>{const recognition=new FakeRecognition();recognitions.push(recognition);return recognition;},
  onState:state=>states.push(state),
  onCommand:command=>commands.push(command),
  onError:error=>errors.push(error),
  ...options,
 });
 return {session,recognitions,states,commands,errors};
}

test('palavra Jarvis só ativa no início da fala e extrai o comando',()=>{
 assert.deepEqual(extractWakeCommand('Jarvis, que horas são?'),{activated:true,command:'que horas são?'});
 assert.deepEqual(extractWakeCommand('Ei Jarvis abre o Chrome'),{activated:true,command:'abre o Chrome'});
 assert.equal(extractWakeCommand('eu gosto do Jarvis'),null);
 assert.equal(extractWakeCommand('Jarvisinho, abra'),null);
});

test('modo contínuo aguarda ativação e só envia o comando depois de Jarvis',()=>{
 const {session,recognitions,commands,states}=createHarness();
 assert.equal(session.start(),true);
 assert.equal(recognitions[0].continuous,true);
 assert.equal(recognitions[0].lang,'pt-BR');
 assert.equal(session.state,VOICE_STATES.AWAITING);
 recognitions[0].emit('abra o Google Chrome');
 assert.deepEqual(commands,[]);
 recognitions[0].emit('Jarvis, aumenta o volume');
 assert.deepEqual(commands,['aumenta o volume']);
 assert.equal(session.state,VOICE_STATES.PROCESSING);
 assert.ok(states.includes(VOICE_STATES.AWAITING));
 assert.ok(states.includes(VOICE_STATES.LISTENING));
});

test('wake word isolada arma a escuta para a frase seguinte',()=>{
 const {session,recognitions,commands}=createHarness();
 session.start();
 recognitions[0].emit('Jarvis');
 assert.equal(session.state,VOICE_STATES.LISTENING);
 assert.deepEqual(commands,[]);
 recognitions[0].emit('o que conversamos ontem?');
 assert.deepEqual(commands,['o que conversamos ontem?']);
});

test('resultados repetidos não processam o comando duas vezes',()=>{
 const {session,recognitions,commands,states}=createHarness();
 session.start();
 recognitions[0].emit('Jarvis, me explica uma coisa');
 recognitions[0].emit('Jarvis, me explica uma coisa');
 assert.deepEqual(commands,['me explica uma coisa']);
 assert.equal(session.processing,true);
 assert.ok(states.includes(VOICE_STATES.PROCESSING));
});

test('reconhecimento pausa durante a fala e retoma quando a fala termina',()=>{
 const {session,recognitions}=createHarness();
 session.start();
 const first=recognitions[0];
 first.emit('Jarvis, que horas são?');
 assert.equal(first.aborted,true);
 session.setSpeaking();
 assert.equal(session.state,VOICE_STATES.SPEAKING);
 session.resume();
 assert.equal(session.state,VOICE_STATES.AWAITING);
 assert.equal(recognitions.length,2);
});

test('reconhecimento de uma frase continua disponível sem wake word',()=>{
 const {session,recognitions,commands}=createHarness();
 session.listenOnce();
 recognitions[0].emit('abra o Chrome');
 assert.deepEqual(commands,['abra o Chrome']);
 assert.equal(session.active,false);
 session.resume();
 assert.equal(session.state,VOICE_STATES.OFF);
});

test('permissão negada encerra a escuta e informa sem contornar a decisão',()=>{
 const {session,recognitions,errors}=createHarness();
 session.start();
 recognitions[0].fail('not-allowed');
 assert.equal(session.active,false);
 assert.equal(session.state,VOICE_STATES.ERROR);
 assert.equal(errors.at(-1).code,'MICROPHONE_PERMISSION_DENIED');
 assert.match(errors.at(-1).message,/autorize o microfone/i);
});

test('falha de rede recupera a escuta com backoff limitado',()=>{
 const timers=[];
 const {session,recognitions,errors}=createHarness({
  schedule:(callback,delay)=>{const timer={callback,delay,cancelled:false};timers.push(timer);return timer;},
  cancelSchedule:timer=>{timer.cancelled=true;},
  retryDelayMs:100,maxRetries:2,
 });
 session.start();
 recognitions[0].fail('network');
 assert.equal(timers[0].delay,100);
 timers[0].callback();
 assert.equal(recognitions.length,2);
 recognitions[1].end();
 assert.equal(timers[1].delay,200);
 timers[1].callback();
 recognitions[2].end();
 assert.equal(session.active,false);
 assert.equal(session.state,VOICE_STATES.ERROR);
 assert.equal(errors.at(-1).code,'RECOGNITION_RETRIES_EXHAUSTED');
});

test('microfone temporariamente indisponível informa e tenta retomar sem loop ilimitado',()=>{
 const timers=[];
 const {session,recognitions,errors}=createHarness({
  schedule:(callback,delay)=>{const timer={callback,delay};timers.push(timer);return timer;},
  cancelSchedule:()=>{},
  retryDelayMs:50,maxRetries:1,
 });
 session.start();
 recognitions[0].fail('audio-capture');
 assert.match(errors.at(-1).message,/microfone disponível/i);
 timers[0].callback();
 recognitions[1].fail('audio-capture');
 assert.equal(session.active,false);
 assert.equal(errors.at(-1).code,'RECOGNITION_RETRIES_EXHAUSTED');
});

test('falha ao processar mensagem mostra erro e libera a conversa para retomada',async()=>{
 const {session,recognitions,errors}=createHarness({
  onCommand:async()=>{throw new Error('SERVER_UNAVAILABLE');},
 });
 session.start();
 recognitions[0].emit('Jarvis, me ajuda');
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(errors.some(error=>error.code==='COMMAND_FAILED'));
 assert.equal(session.state,VOICE_STATES.AWAITING);
 assert.equal(session.processing,false);
});

test('navegador sem reconhecimento apresenta erro em vez de ativar uma escuta falsa',()=>{
 const states=[],errors=[];
 const session=createVoiceSession({createRecognition:()=>null,onState:state=>states.push(state),onError:error=>errors.push(error)});
 assert.equal(session.start(),false);
 assert.equal(session.active,false);
 assert.equal(session.state,VOICE_STATES.ERROR);
 assert.equal(errors[0].code,'RECOGNITION_UNAVAILABLE');
});

test('desativar cancela recuperação pendente e impede reinício do microfone',()=>{
 const timers=[];
 const {session,recognitions}=createHarness({
  schedule:(callback,delay)=>{const timer={callback,delay,cancelled:false};timers.push(timer);return timer;},
  cancelSchedule:timer=>{timer.cancelled=true;},
 });
 session.start();
 recognitions[0].end();
 session.stop();
 assert.equal(timers[0].cancelled,true);
 timers[0].callback();
 assert.equal(recognitions.length,1);
 assert.equal(session.state,VOICE_STATES.OFF);
});

test('seleciona voz em português brasileiro e prefere uma opção masculina quando disponível',()=>{
 const portuguese=['pt-PT','pt-BR'].map((lang,index)=>({name:`Voz ${index}`,lang}));
 const masculine={name:'Daniel Natural',lang:'pt-BR'};
 assert.equal(selectPortugueseVoice([...portuguese,masculine]),masculine);
 assert.equal(selectPortugueseVoice([{name:'English',lang:'en-US'},portuguese[0]]),portuguese[0]);
 assert.equal(selectPortugueseVoice([{name:'English',lang:'en-US'}]),undefined);
});

test('wake word parcial seguida de final isolada não é enviada como comando',()=>{
 const {session,recognitions,commands}=createHarness();session.start();
 recognitions[0].emit('Jarvis',{final:false});recognitions[0].emit('Jarvis');
 assert.deepEqual(commands,[]);recognitions[0].emit('abre o Chrome');assert.deepEqual(commands,['abre o Chrome']);session.stop();
});
test('janela de comando expira após silêncio e não captura fala sem ativação',()=>{
 const timers=[];const {session,recognitions,commands}=createHarness({schedule:callback=>{const timer={callback};timers.push(timer);return timer;},cancelSchedule:()=>{}});
 session.start();recognitions[0].emit('Jarvis');timers[0].callback();
 assert.equal(session.state,VOICE_STATES.AWAITING);recognitions[0].emit('abre o Chrome');assert.deepEqual(commands,[]);session.stop();
});

test('marcação female não é confundida com voz masculina',()=>{
 const selected=selectPortugueseVoice([
  {lang:'pt-BR',name:'Maria Natural',gender:'female',default:true},
  {lang:'pt-BR',name:'Paulo',gender:'male'},
 ]);
 assert.equal(selected.name,'Paulo');
});
