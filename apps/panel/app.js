import { createApiClient } from './api.js';
import { createVoiceSession, VOICE_STATES } from './voice-session.js';
import { selectPortugueseVoice } from './voice-speech.js';
const $=s=>document.querySelector(s);
let csrf='',sending=false,reconnecting=false,shuttingDown=false,administrating=false,residentEnabled=false,residentMicrophoneActive=false;
let instanceId='',chatController=null,interactionVersion=0,chatTimeoutMs=30000,refreshing=false,utteranceActive=null,speechResolver=null;
let residentRefreshBusy=false,residentLastUtterance='',residentLastReply='',residentSettingsTimer=null;
const request=createApiClient({getCsrf:()=>csrf});
const administrativeBusy=()=>reconnecting||shuttingDown||administrating;
const voiceSession=createVoiceSession({
 createRecognition:()=>{
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  return Recognition?new Recognition():null;
 },
 onState:setVoiceState,
 onCommand:message=>sendMessage(message,{fromVoice:true}),
 onError:showVoiceError,
});
async function api(path,data,options){
 try{return await request(path,data,options);}
 catch(error){if(error.status===401&&!administrativeBusy())lock();throw error;}
}
function stopInteraction(){
 interactionVersion++;
 chatController?.abort();chatController=null;
 voiceSession.stop();
 cancelSpeech();
 sending=false;$('#thinking').hidden=true;$('#cancel-action').hidden=true;
}
function enableInput(enabled){
 $('#send-message').disabled=!enabled;$('#chat-message').disabled=!enabled;
 $('#voice-start').disabled=!enabled||sending||voiceSession.active;
}
function resetExchange(){const empty=$('#last-utterance');empty.textContent='Aguardando sua mensagem';empty.classList.add('empty-value');const reply=$('#current-reply');reply.textContent='O canal está pronto';reply.classList.add('empty-value');}
function lock(){stopInteraction();csrf='';$('#login').hidden=false;$('#administration').hidden=true;$('#approvals').hidden=true;$('#conversation').hidden=true;$('#logout').hidden=true;$('#requests').replaceChildren();$('#chat-history').replaceChildren();resetExchange();setVoiceState('off');enableInput(false);}
async function refresh(){
 const version=interactionVersion;
 const {items}=await request('/api/approvals');
 if(version!==interactionVersion||administrativeBusy())return;
 $('#requests').replaceChildren();
 for(const item of items){const box=document.createElement('article');const text=document.createElement('p');
 const labels={pending:'Aguardando aprovação',completed:'Demonstração confirmada — nenhuma ação externa executada',rejected:'Recusada',expired:'Expirada'};
 text.textContent=item.description+' '+labels[item.state];box.append(text);
 if(item.state==='pending')for(const [decision,label] of [['approve','Aprovar demonstração'],['reject','Recusar']]){
 const button=document.createElement('button');button.textContent=label;button.onclick=()=>run(async()=>{await api('/api/decision',{id:item.id,decision});await refresh();});box.append(button);}
 $('#requests').append(box);}
}
function addMessage(role,text){const item=document.createElement('article');item.className=`message ${role==='user'?'user-message':'jarvis-message'}`;const label=document.createElement('b');label.textContent=role==='user'?'Mateus':'Jarvis';const content=document.createElement('p');content.textContent=text;item.append(label,content);$('#chat-history').append(item);$('#chat-history').scrollTop=$('#chat-history').scrollHeight;const summary=role==='user'?$('#last-utterance'):$('#current-reply');summary.textContent=text;summary.classList.remove('empty-value');}
async function loadChat(){const {messages}=await api('/api/chat');$('#chat-history').replaceChildren();resetExchange();for(const message of messages)addMessage(message.role,message.text);}
async function enter(){const s=await request('/api/session');csrf=s.csrf;instanceId=s.instanceId;const status=await request('/api/status');chatTimeoutMs=(status.operationTimeoutMs||25000)+5000;$('#login').hidden=true;$('#administration').hidden=false;$('#approvals').hidden=false;$('#conversation').hidden=false;$('#logout').hidden=false;setVoiceState('off');enableInput(true);$('#restart-jarvis').disabled=!status.restartAvailable;$('#shutdown-jarvis').disabled=!status.shutdownAvailable;const providers=[status.geminiConfigured&&'Gemini',status.openrouterConfigured&&'OpenRouter',status.openaiEnabled&&status.openaiConfigured&&'OpenAI'].filter(Boolean);const providerLabel=providers.length?providers.join(' · '):'IA não configurada';$('#gemini-state').textContent=providerLabel;$('#status').textContent=`Acesso autenticado · ${providerLabel}`;await Promise.all([refresh(),loadChat(),refreshResidentVoice()]);}
function showFailure(error){$('#status').textContent=error.message;setVoiceState(error.code==='SERVER_UNAVAILABLE'?'offline':'error');}
async function run(fn){try{await fn();}catch(error){if(error.status===401&&!administrativeBusy())lock();showFailure(error);}}
$('#login-form').onsubmit=e=>{e.preventDefault();run(async()=>{const code=$('#code').value.trim();try{await api('/api/login',{code});}finally{$('#code').value='';}await enter();});};
async function restoreSession(){
 try{await enter();return true;}
 catch(error){
  if(error.status!==401)throw error;
  await request('/api/resume',{});
  await enter();return true;
 }
}
async function reconnectAfterRestart(previousInstance){
 if(reconnecting)return;reconnecting=true;const deadline=Date.now()+35000;
 $('#status').textContent='Jarvis reiniciando. Reconectando...';
 while(Date.now()<deadline){
  try{
   const health=await request('/api/health',undefined,{timeoutMs:1500});
   if(health.ok&&health.instanceId!==previousInstance){
    await restoreSession();
    reconnecting=false;administrating=false;$('#status').textContent='Jarvis reiniciado.';return;
   }
  }catch(error){if(error.code==='RESUME_INVALID'){break;}}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 reconnecting=false;administrating=false;lock();$('#status').textContent='Reconexão automática indisponível. Entre com o código do launcher; se estiver fechado, execute scripts/iniciar-windows.cmd.';
}
$('#restart-jarvis').onclick=async()=>{
 if(administrativeBusy())return;
 if(!window.confirm('Deseja reiniciar o Jarvis?'))return;
 administrating=true;stopInteraction();enableInput(false);
 $('#restart-jarvis').disabled=true;$('#shutdown-jarvis').disabled=true;$('#status').textContent='Solicitando reinício do Jarvis...';
 const previousInstance=instanceId;
 try{await api('/api/admin/restart',{});}
 catch(error){if(error.status&&error.code!=='SERVER_STOPPING'){administrating=false;await run(enter);showFailure(error);return;}}
 await reconnectAfterRestart(previousInstance);
};
$('#shutdown-jarvis').onclick=async()=>{
 if(administrativeBusy())return;
 if(!window.confirm('Deseja realmente desligar o Jarvis?'))return;
 stopInteraction();enableInput(false);
 shuttingDown=true;$('#restart-jarvis').disabled=true;$('#shutdown-jarvis').disabled=true;
 $('#status').textContent='Solicitando encerramento coordenado...';
 try{await api('/api/admin/shutdown',{});}
 catch(error){if(error.status&&error.code!=='SERVER_STOPPING'){shuttingDown=false;await run(enter);showFailure(error);return;}}
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){
  try{await request('/api/health',undefined,{timeoutMs:1500});}
  catch(error){if(error.code==='SERVER_UNAVAILABLE'){lock();$('#status').textContent='Jarvis desligado: servidor local indisponível. Para ligar, execute scripts/iniciar-windows.cmd.';return;}}
  await new Promise(resolve=>setTimeout(resolve,300));
 }
 $('#status').textContent='Não foi possível confirmar o desligamento. Consulte o launcher.';
};
$('#demo').onclick=()=>run(async()=>{await api('/api/demo',{});await refresh();});
function setVoiceState(state){
 const labels={
  [VOICE_STATES.OFF]:'Microfone desligado',[VOICE_STATES.AWAITING]:'Microfone ativo · diga “Jarvis”',
  [VOICE_STATES.LISTENING]:'Ouvindo comando',[VOICE_STATES.PROCESSING]:'Processando',
  [VOICE_STATES.SPEAKING]:'Falando',[VOICE_STATES.ERROR]:'Falha na voz',offline:'Sem conexão local',
 };
 const coreLabels={
  [VOICE_STATES.OFF]:'Sistema em espera',[VOICE_STATES.AWAITING]:'Aguardando “Jarvis”',
  [VOICE_STATES.LISTENING]:'Ouvindo comando...',[VOICE_STATES.PROCESSING]:'Processando...',
  [VOICE_STATES.SPEAKING]:'Respondendo em voz alta',[VOICE_STATES.ERROR]:'Verifique a voz',
  offline:'Servidor local indisponível',
 };
 const coreDescriptions={
  [VOICE_STATES.OFF]:'Núcleo Jarvis em espera',[VOICE_STATES.AWAITING]:'Microfone ativo, aguardando a palavra Jarvis',
  [VOICE_STATES.LISTENING]:'Jarvis está ouvindo o comando',[VOICE_STATES.PROCESSING]:'Jarvis está processando',
  [VOICE_STATES.SPEAKING]:'Jarvis está falando',[VOICE_STATES.ERROR]:'Ocorreu uma falha de voz',
  offline:'O servidor local está indisponível',
 };
 const listening=state===VOICE_STATES.AWAITING||state===VOICE_STATES.LISTENING;
 $('#voice-state').textContent=labels[state]||labels[VOICE_STATES.ERROR];
 $('#voice-state').dataset.state=state;document.body.dataset.state=state;
 $('#assistant-core').dataset.state=state;$('#assistant-core').setAttribute('aria-label',coreDescriptions[state]||coreDescriptions[VOICE_STATES.ERROR]);
 $('#core-state-label').textContent=coreLabels[state]||coreLabels[VOICE_STATES.ERROR];
 const residentListening=residentMicrophoneActive;
 $('#microphone-indicator').textContent=residentListening?'Microfone ativo · processo residente':listening?'Microfone ativo':'Microfone desligado';
 $('#microphone-indicator').dataset.active=String(residentListening||listening);
 $('#voice-enable').disabled=voiceSession.active||sending||residentEnabled;
 $('#voice-disable').disabled=!voiceSession.active;
 $('#voice-start').disabled=voiceSession.active||sending||residentEnabled;
 $('#voice-stop').hidden=!listening||!voiceSession.active;
}
function setResidentVoiceStatus(value){
 residentEnabled=value.enabled===true;
 residentMicrophoneActive=value.microphoneActive===true;
 const labels={
  disabled:'Residente desligado',
  starting:'Iniciando escuta residente...',
  awaiting_activation:'Microfone ativo · aguardando “Jarvis”',
  awaiting_command:'Ouvindo o comando seguinte',
  processing:'Processando comando por voz',
  speaking:'Respondendo por voz',
  error:'Escuta residente com erro',
 };
 const status=$('#resident-voice-status');
 status.textContent=labels[value.state]||labels.disabled;
 status.dataset.active=String(value.microphoneActive===true);
 if(value.microphoneActive){
  $('#microphone-indicator').textContent='Microfone ativo · processo residente';
  $('#microphone-indicator').dataset.active='true';
 }else if(!voiceSession.active){
  $('#microphone-indicator').textContent='Microfone desligado';
  $('#microphone-indicator').dataset.active='false';
 }
 $('#resident-voice-enable').disabled=residentEnabled||voiceSession.active||sending;
 $('#resident-voice-disable').disabled=!residentEnabled;
 $('#voice-enable').disabled=voiceSession.active||sending||residentEnabled;
 $('#voice-start').disabled=voiceSession.active||sending||residentEnabled;
 if(value.lastUtterance&&value.lastUtterance!==residentLastUtterance){
  residentLastUtterance=value.lastUtterance;addMessage('user',residentLastUtterance);
 }
 if(value.lastReply&&value.lastReply!==residentLastReply){
  residentLastReply=value.lastReply;addMessage('model',residentLastReply);
 }
 const errors={
  MICROPHONE_PERMISSION_DENIED:'Permissão negada. Ative o acesso ao microfone para aplicativos da área de trabalho em Configurações > Privacidade e segurança > Microfone.',
  DOTNET_SDK_MISSING:'Instale o .NET SDK 10 antes de ativar a escuta residente.',
  VOICE_BUILD_FAILED:'Não foi possível compilar o módulo de voz residente. Consulte o diagnóstico do launcher.',
  VOICE_SETTINGS_READ_FAILED:'Não foi possível ler a configuração da escuta residente.',
  VOICE_SETTINGS_INVALID:'A configuração salva da escuta residente é inválida.',
 };
 const errorCode=value.errorCode;
 const error=$('#resident-voice-error');
 if(errorCode){error.textContent=errors[errorCode]||'A escuta residente encontrou uma falha. Verifique o microfone e tente novamente.';error.hidden=false;}
 else error.hidden=true;
}
async function refreshResidentVoice(){
 if(residentRefreshBusy||!csrf)return;
 residentRefreshBusy=true;
 try{setResidentVoiceStatus(await request('/api/voice/resident'));}
 finally{residentRefreshBusy=false;}
}
function showVoiceError(error){
 const message=typeof error==='string'?error:error?.message||'O reconhecimento de voz falhou.';
 const element=$('#voice-error');element.textContent=message;element.hidden=false;
 if(voiceSession.state!==VOICE_STATES.ERROR)setVoiceState(VOICE_STATES.ERROR);
}
function updateSpeechControl(id,outputId,format){
 const control=$(`#${id}`),output=$(`#${outputId}`);
 output.value=format(Number(control.value));output.textContent=format(Number(control.value));
}
function cancelSpeech(){
 const utterance=utteranceActive;utteranceActive=null;
 if(utterance){utterance.onstart=null;utterance.onend=null;utterance.onerror=null;}
 if(window.speechSynthesis)window.speechSynthesis.cancel();
 const resolve=speechResolver;speechResolver=null;resolve?.(false);
}
function speakReply(text,{fromVoice=false}={}){
 if(administrativeBusy()||!csrf||!$('#voice-toggle').matches('[aria-pressed="true"]')||
  !window.speechSynthesis||typeof SpeechSynthesisUtterance==='undefined')return Promise.resolve(false);
 cancelSpeech();
 const utterance=new SpeechSynthesisUtterance(text);
 const voices=window.speechSynthesis.getVoices();
 const portugueseVoice=selectPortugueseVoice(voices);
 utterance.voice=portugueseVoice||null;
 utterance.lang='pt-BR';
 utterance.rate=Number($('#speech-rate').value);
 utterance.volume=Number($('#speech-volume').value);
 utteranceActive=utterance;
 if(!portugueseVoice&&voices.length){
  $('#voice-error').textContent='O navegador não listou uma voz em português; a pronúncia dependerá da voz padrão instalada.';
  $('#voice-error').hidden=false;
 }
 if(fromVoice)voiceSession.setSpeaking();
 else setVoiceState(VOICE_STATES.SPEAKING);
 return new Promise(resolve=>{
  speechResolver=resolve;
  const finish=success=>{
   if(utteranceActive!==utterance)return;
   utteranceActive=null;speechResolver=null;
   if(!fromVoice&&voiceSession.state===VOICE_STATES.SPEAKING)setVoiceState(VOICE_STATES.OFF);
   resolve(success);
  };
  utterance.onstart=()=>{if(utteranceActive===utterance&&fromVoice)voiceSession.setSpeaking();};
  utterance.onend=()=>finish(true);
  utterance.onerror=event=>{
   const cancelled=event?.error==='canceled'||event?.error==='interrupted';
   if(!cancelled){
    const message=event?.error==='voice-unavailable'
     ?'Nenhuma voz instalada está disponível. Instale/ative uma voz pt-BR no Windows ou navegador e tente novamente.'
     :`A síntese de voz foi interrompida (${event?.error||'erro desconhecido'}).`;
    showVoiceError(message);
   }
   finish(false);
  };
  try {window.speechSynthesis.speak(utterance);}
  catch(error){showVoiceError(`Não foi possível iniciar a síntese de voz (${error?.name||'erro do navegador'}).`);finish(false);}
 });
}
async function sendMessage(messageOverride, {fromVoice=false}={}){
 if(sending||administrativeBusy()||!csrf)return;
 const input=$('#chat-message'),message=(messageOverride??input.value).trim();if(!message)return;
 const voiceConversation=fromVoice||voiceSession.active;
 if(voiceConversation&&!fromVoice)voiceSession.suspend();
 const version=interactionVersion;
 const controller=new AbortController();chatController=controller;
 const requestId=crypto.randomUUID();
 sending=true;setVoiceState('processing');$('#send-message').disabled=true;$('#thinking').hidden=false;$('#cancel-action').hidden=false;$('#chat-error').hidden=true;
 addMessage('user',message);if(!fromVoice)input.value='';
 try{
  const result=await api('/api/chat',{message},{signal:controller.signal,timeoutMs:chatTimeoutMs,requestId});
  if(version!==interactionVersion)return;
  addMessage('model',result.reply);
  if(voiceConversation)await speakReply(result.reply,{fromVoice:true});
  else void speakReply(result.reply);
 }catch(error){
  if(version!==interactionVersion)return;
  $('#chat-error').textContent=error.message;$('#chat-error').hidden=false;
  if(voiceConversation&&voiceSession.active)showVoiceError(error.message);
  else setVoiceState(error.code==='SERVER_UNAVAILABLE'?'offline':VOICE_STATES.ERROR);
 }finally{
  if(version===interactionVersion){
   sending=false;chatController=null;$('#thinking').hidden=true;$('#cancel-action').hidden=true;
   enableInput(!administrativeBusy()&&Boolean(csrf));
   if(voiceConversation)voiceSession.resume();
   else if($('#voice-state').dataset.state===VOICE_STATES.PROCESSING)setVoiceState(VOICE_STATES.OFF);
   input.focus();
  }
 }
}
$('#cancel-action').onclick=()=>run(async()=>{
 await api('/api/actions/cancel',{});
 stopInteraction();enableInput(Boolean(csrf)&&!administrativeBusy());setVoiceState('off');
 $('#status').textContent='Cancelamento solicitado. Ações já entregues a aplicativos externos não são desfeitas.';
});
$('#chat-form').onsubmit=e=>{e.preventDefault();sendMessage();};
$('#voice-enable').onclick=()=>{
 if(!csrf||sending)return;
 if(!window.speechSynthesis||typeof SpeechSynthesisUtterance==='undefined'){
  showVoiceError('Este navegador não disponibiliza síntese de voz. Use outro navegador ou o chat por texto.');return;
 }
 $('#voice-error').hidden=true;$('#chat-error').hidden=true;
 const toggle=$('#voice-toggle');toggle.setAttribute('aria-pressed','true');
 toggle.querySelector('span').textContent='Respostas faladas: ligadas';
 voiceSession.start();enableInput(Boolean(csrf));
};
$('#voice-disable').onclick=()=>{
 voiceSession.stop();cancelSpeech();
 const toggle=$('#voice-toggle');toggle.setAttribute('aria-pressed','false');
 toggle.querySelector('span').textContent='Respostas faladas: desligadas';
 enableInput(Boolean(csrf)&&!administrativeBusy());
};
$('#voice-start').onclick=()=>{if(administrativeBusy()||sending)return;$('#voice-error').hidden=true;cancelSpeech();voiceSession.listenOnce();};
$('#voice-stop').onclick=()=>{$('#voice-disable').click();};
$('#resident-voice-enable').onclick=async()=>{
 if(!csrf||sending||residentEnabled||voiceSession.active)return;
 if(!window.confirm('Autoriza o Jarvis a usar continuamente o microfone local deste Windows, detectar “Jarvis” offline e enviar somente o texto reconhecido ao chat autenticado? Nenhuma gravação será salva.'))return;
 $('#resident-voice-enable').disabled=true;$('#resident-voice-error').hidden=true;
 try{
  const result=await api('/api/voice/resident',{
   enabled:true,
   speakingRate:Number($('#speech-rate').value),
   volume:Number($('#speech-volume').value),
  });
  setResidentVoiceStatus(result);
 }catch(error){
  const messages={
   MICROPHONE_PERMISSION_DENIED:'Permissão negada. Ative o acesso ao microfone para aplicativos da área de trabalho em Configurações > Privacidade e segurança > Microfone.',
   DOTNET_SDK_MISSING:'Instale o .NET SDK 10 antes de ativar a escuta residente.',
  };
  $('#resident-voice-error').textContent=messages[error.code]||error.message;
  $('#resident-voice-error').hidden=false;
  await refreshResidentVoice();
 }finally{
  if(csrf)$('#resident-voice-enable').disabled=residentEnabled||voiceSession.active||sending;
 }
};
$('#resident-voice-disable').onclick=async()=>{
 if(!csrf||!residentEnabled)return;
 $('#resident-voice-disable').disabled=true;
 try{setResidentVoiceStatus(await api('/api/voice/resident',{enabled:false}));}
 catch(error){
  $('#resident-voice-error').textContent=error.message;
  $('#resident-voice-error').hidden=false;
  await refreshResidentVoice();
 }
};
function scheduleResidentVoiceSettings(){
 if(!residentEnabled)return;
 clearTimeout(residentSettingsTimer);
 residentSettingsTimer=setTimeout(()=>run(async()=>{
  const value=await api('/api/voice/resident',{
   speakingRate:Number($('#speech-rate').value),
   volume:Number($('#speech-volume').value),
  });
  setResidentVoiceStatus(value);
 }),350);
}
$('#nav-chat').onclick=()=>{$('#chat-drawer').open=true;};
$('#voice-toggle').onclick=()=>{
 const button=$('#voice-toggle'),enabled=button.getAttribute('aria-pressed')!=='true';
 if(enabled&&(!window.speechSynthesis||typeof SpeechSynthesisUtterance==='undefined')){
  showVoiceError('Este navegador não é compatível com síntese de voz.');return;
 }
 button.setAttribute('aria-pressed',String(enabled));
 button.querySelector('span').textContent=`Respostas faladas: ${enabled?'ligadas':'desligadas'}`;
 if(!enabled){cancelSpeech();if(voiceSession.active)voiceSession.resume();}
 $('#voice-error').hidden=true;
};
$('#speech-rate').oninput=()=>{updateSpeechControl('speech-rate','speech-rate-value',value=>`${value.toFixed(2).replace('.',',')}×`);scheduleResidentVoiceSettings();};
$('#speech-volume').oninput=()=>{updateSpeechControl('speech-volume','speech-volume-value',value=>`${Math.round(value*100)}%`);scheduleResidentVoiceSettings();};
updateSpeechControl('speech-rate','speech-rate-value',value=>`${value.toFixed(2).replace('.',',')}×`);
updateSpeechControl('speech-volume','speech-volume-value',value=>`${Math.round(value*100)}%`);
$('#clear-chat').onclick=()=>run(async()=>{if(sending)return;await api('/api/chat/clear',{});$('#chat-history').replaceChildren();resetExchange();$('#chat-error').hidden=true;});
$('#logout').onclick=()=>run(async()=>{stopInteraction();await api('/api/logout',{});lock();$('#status').textContent='Sessão encerrada';});
async function initialize(){
 try{await restoreSession();}
 catch(error){
  if(error.status===401){lock();$('#status').textContent='Entre com o código exibido pelo launcher.';}
  else if(error.code==='SERVER_STOPPING'||error.code==='SERVER_UNAVAILABLE'){await reconnectAfterRestart(null);}
  else showFailure(error);
 }
}
void initialize();
setInterval(async()=>{
 if(!csrf||administrativeBusy()||refreshing)return;
 refreshing=true;const version=interactionVersion;
 try{await Promise.all([refresh(),refreshResidentVoice()]);}
 catch(error){if(version===interactionVersion&&!administrativeBusy()){if(error.status===401)lock();showFailure(error);}}
 finally{refreshing=false;}
},5000);
window.addEventListener('pagehide',stopInteraction);
window.addEventListener('unhandledrejection',()=>{$('#status').textContent='Falha interna no painel. Recarregue a página; nenhuma ação será repetida automaticamente.';});
