import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { createApprovalStore } from '../../packages/security/approval-store.mjs';
import { generateGeminiResponse } from '../../packages/providers/gemini.mjs';
import { createAIResponseRouter, AIProviderFailure } from '../../packages/providers/ai-router.mjs';
import { DEFAULT_OPENAI_MODEL, generateOpenAIResponse } from '../../packages/providers/openai.mjs';
import { DEFAULT_OPENROUTER_MODEL, generateOpenRouterResponse } from '../../packages/providers/openrouter.mjs';
import { DEFAULT_MEMORY_FILE, buildMemoryContext, createMemoryStore, memoryFactLabel, parseMemoryCommand, resolveMemoryPlayback } from '../../packages/memory/index.mjs';
import { detectContextualLocalAction, detectLocalAction } from '../../packages/core/intent.mjs';
import { createConversationContext } from '../../packages/core/conversation-context.mjs';
import { truthfulActionReply } from '../../packages/core/action-reply.mjs';
import { runDesktopAction } from '../../packages/desktop/index.mjs';
import { LOCAL_APPS, LOCAL_FOLDERS, LOCAL_SITES, localActionConfirmation, validateLocalAction } from '../../packages/contracts/local-actions.mjs';
import { DEFAULT_PORT, HOST, resolvePort, serverOrigin } from '../../packages/core/configuration.mjs';
import { abortable, diagnostic, operationError } from '../../packages/core/diagnostics.mjs';
import { createOperations } from '../../packages/core/operations.mjs';
import { createProcessManager } from '../../packages/desktop/processes.mjs';
import { createRestartTickets, RESTART_COOKIE, clearRestartCookie } from '../../packages/security/restart-ticket.mjs';
import { createResidentVoiceService } from '../../packages/resident-voice/service.mjs';
import {
 DEFAULT_RESIDENT_VOICE_SETTINGS,
 DEFAULT_RESIDENT_VOICE_SETTINGS_PATH,
 readResidentVoiceSettings,
 validateResidentVoiceSettings,
 writeResidentVoiceSettings,
} from '../../packages/resident-voice/settings.mjs';
import {
 DEFAULT_RESIDENT_VOICE_DIAGNOSTICS_PATH,
 appendResidentVoiceDiagnostic,
} from '../../packages/resident-voice/diagnostics.mjs';
dotenv.config({path:fileURLToPath(new URL('../../.env',import.meta.url)),quiet:true});
const fallbackModels=['gemini-3.7-flash','gemini-3.6-flash'];
const unavailableActionReply='Essa ação ainda não está disponível ou não foi permitida.';
const memoryLabels={musica_favorita:'sua música favorita',musica_acordar:'sua música de acordar',musica_bom_dia:'sua música de bom dia',time:'seu time'};
function generateGeminiFromConversation({message,history=[],systemPrompt,apiKey,model,signal,timeoutMs}) {
 const messages=[
  ...history.map(({role,text})=>({role:role==='model'||role==='assistant'?'assistant':'user',content:text})),
  {role:'user',content:message},
 ];
 return generateGeminiResponse({messages,systemPrompt,apiKey,model,signal,timeoutMs});
}
function parseGeminiResponse(text) {
 let parsed;
 try {parsed=JSON.parse(text);}catch{return {type:'invalid_response'};}
 if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))return {type:'invalid_response'};
 if(parsed.type==='reply' && typeof parsed.reply==='string' && parsed.reply.trim() &&
  Object.keys(parsed).length===2 && Object.hasOwn(parsed,'reply'))return {type:'reply',reply:parsed.reply.trim()};
 if(parsed.type==='action' || Object.hasOwn(parsed,'action') || Object.hasOwn(parsed,'params')) {
  if(parsed.type!=='action' || Object.keys(parsed).length!==3 || !Object.hasOwn(parsed,'action') || !Object.hasOwn(parsed,'params')) {
   return {type:'invalid_action'};
  }
  return {type:'action',action:parsed.action,params:parsed.params};
 }
 return {type:'invalid_response'};
}
export function createServer({port=DEFAULT_PORT, accessCode=randomBytes(24).toString('hex'), generateReply=generateGeminiFromConversation,
 generateOpenAI=generateOpenAIResponse, generateOpenRouter=generateOpenRouterResponse, executeAction,
 openaiApiKey=process.env.OPENAI_API_KEY, openaiModel=process.env.OPENAI_MODEL||DEFAULT_OPENAI_MODEL,
 openaiEnabled=process.env.OPENAI_ENABLED==='true', openrouterApiKey=process.env.OPENROUTER_API_KEY,
 openrouterModel=process.env.OPENROUTER_MODEL||DEFAULT_OPENROUTER_MODEL,
 memoryFilePath=DEFAULT_MEMORY_FILE, memoryStore,
 googleApiKey=process.env.GOOGLE_API_KEY, googleModel=process.env.GOOGLE_MODEL,
 supervised=false, requestRestart, requestShutdown, restartSecret, generation,
 operationTimeoutMs=25000, logger=console, residentVoiceSettingsPath=DEFAULT_RESIDENT_VOICE_SETTINGS_PATH,
 residentVoiceDiagnosticsPath=DEFAULT_RESIDENT_VOICE_DIAGNOSTICS_PATH,
 residentVoiceAutoStart=false, residentVoiceService, residentVoicePlatform=process.platform}={}) {
 port=resolvePort(port);
 const origin=serverOrigin(port), sessions=new Map(), approvals=createApprovalStore();
 const operations=createOperations({timeoutMs:operationTimeoutMs,logger});
 const processes=createProcessManager({logger});
 const tickets=createRestartTickets({secret:restartSecret,generation});
 const instanceId=randomBytes(12).toString('hex');
 let lifecycle='running',closePromise,actionBusy=false;
 let residentSettings={...DEFAULT_RESIDENT_VOICE_SETTINGS},residentSettingsLoaded=false,residentSettingsError=null;
 let residentVoiceState={state:'disabled',microphoneActive:false};
 let residentSettingsLoading;
 let residentSession;
 let residentLastUtterance='',residentLastReply='';
 let residentVoiceRequestController;
 let lastResidentDiagnosticKey='',lastResidentDiagnosticAt=0;
 let lastResidentDiagnosticWrite=Promise.resolve();
 const pendingResidentDiagnosticWrites=new Set();
 const conversations=createConversationContext();
 const localMemory=memoryStore||createMemoryStore({filePath:memoryFilePath,logger});
 const aiRouter=createAIResponseRouter({
  openaiProvider:{generateResponse:generateOpenAI},
  openrouterProvider:{generateResponse:generateOpenRouter},
  geminiProvider:{generateResponse:({messages,systemPrompt,apiKey,model,signal,timeoutMs})=>{
   const current=messages.at(-1);
   const history=messages.slice(0,-1).map(({role,text,content})=>({
    role:role==='assistant'?'model':'user',text:text??content,
   }));
  return generateReply({message:current.content,history,systemPrompt,apiKey,model,signal,timeoutMs});
  }},
  openaiApiKey,openaiModel,openaiEnabled,openrouterApiKey,openrouterModel,
  geminiApiKey:googleApiKey,geminiModel:googleModel,
  geminiFallbackModels:fallbackModels,logger,
 });
 let attempts=[];
 const equal=(a,b)=>typeof a==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
 const diagnosticVoiceError=(code,details={})=>{
  const entry={
   code:/^[A-Z0-9_]{1,64}$/.test(code||'')?code:'VOICE_ERROR',
   stage:typeof details.stage==='string'&&/^[a-z_]{1,48}$/.test(details.stage)?details.stage:'service_runtime',
   exceptionType:typeof details.exceptionType==='string'&&/^[A-Za-z0-9_.+`]{1,160}$/.test(details.exceptionType)?details.exceptionType:null,
   hresult:typeof details.hresult==='string'&&/^0x[0-9A-F]{8}$/.test(details.hresult)?details.hresult:null,
  };
  const key=JSON.stringify(entry),now=Date.now();
  if(key===lastResidentDiagnosticKey&&now-lastResidentDiagnosticAt<1000)return lastResidentDiagnosticWrite;
  lastResidentDiagnosticKey=key;lastResidentDiagnosticAt=now;
  diagnostic('resident_voice.error',entry,logger);
  const write=appendResidentVoiceDiagnostic(entry,residentVoiceDiagnosticsPath).catch(error=>{
   diagnostic('resident_voice.diagnostics_write_failed',{
    code:/^[A-Z0-9_]{1,64}$/.test(error.code||'')?error.code:'VOICE_DIAGNOSTICS_WRITE_FAILED',
   },logger);
  });
  lastResidentDiagnosticWrite=write;
  pendingResidentDiagnosticWrites.add(write);
  void write.finally(()=>pendingResidentDiagnosticWrites.delete(write));
  return lastResidentDiagnosticWrite;
 };
 const ensureResidentSession=()=>{
  if(residentSession&&sessions.has(residentSession.id))return residentSession;
  const id=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
  const session={csrf,expiresAt:Date.now()+3600000,residentVoice:true};
  sessions.set(id,session);
  residentSession={id,csrf,session};
  return residentSession;
 };
 const bindResidentSession=(id,session)=>{
  const previous=residentSession;
  if(previous?.id!==id&&previous?.session.residentVoice){
   const messages=conversations.getMessages(previous.id);
   const lastAction=conversations.getLastAction(previous.id);
   for(let index=0;index+1<messages.length;index+=2){
    const action=index+2===messages.length?lastAction:undefined;
    conversations.appendExchange(id,messages[index].text,messages[index+1].text,action);
   }
   conversations.delete(previous.id);
   sessions.delete(previous.id);
  }
  residentSession={id,csrf:session.csrf,session};
 };
 const sendVoiceChat=async message=>{
  if(typeof message!=='string'||!message.trim()||message.trim().length>2500)throw Object.assign(new Error('Comando de voz inválido.'),{code:'VOICE_COMMAND_INVALID'});
  residentLastUtterance=message.trim();
  const identity=ensureResidentSession();
  identity.session.expiresAt=Date.now()+3600000;
  const controller=new AbortController();
  residentVoiceRequestController=controller;
  try{
   const response=await fetch(`http://127.0.0.1:${port}/api/chat`,{
    method:'POST',
    headers:{
     'Content-Type':'application/json',
     Origin:origin,
     Cookie:`jarvis_session=${identity.id}`,
     'X-Jarvis-CSRF':identity.csrf,
     'X-Jarvis-Request-Id':randomBytes(16).toString('hex'),
    },
    body:JSON.stringify({message}),
    signal:controller.signal,
   });
   const result=await response.json();
   if(!response.ok)throw Object.assign(new Error(result.error||'A solicitação por voz não pôde ser concluída.'),{code:result.code||'VOICE_CHAT_FAILED'});
   if(typeof result.reply!=='string'||!result.reply.trim())throw Object.assign(new Error('O chat não retornou uma resposta de voz.'),{code:'VOICE_REPLY_INVALID'});
   residentLastReply=result.reply;
   return result.reply;
  }finally{if(residentVoiceRequestController===controller)residentVoiceRequestController=null;}
 };
 const residentVoice=residentVoiceService||createResidentVoiceService({
  platform:residentVoicePlatform,
  onState:state=>{
   residentVoiceState={state:state.state,microphoneActive:state.microphoneActive===true,wakeState:state.wakeState};
   diagnostic('resident_voice.state',{state:state.state,microphoneActive:state.microphoneActive===true},logger);
  },
  onTranscript:sendVoiceChat,
  onDisable:async()=>{
   residentVoiceRequestController?.abort();
   residentSettings={...residentSettings,enabled:false};
   try{await writeResidentVoiceSettings(residentSettings,residentVoiceSettingsPath);residentSettingsError=null;}
   catch(error){residentSettingsError='VOICE_SETTINGS_WRITE_FAILED';await diagnosticVoiceError(residentSettingsError,{stage:'service_stop'});}
  },
  onError:error=>{void diagnosticVoiceError(error.code,error);},
 });
 const residentVoiceSnapshot=()=>({
  ...residentSettings,
  state:residentSettingsError?'error':residentVoice.status?.state||residentVoiceState.state,
  microphoneActive:residentVoice.status?.microphoneActive===true||residentVoiceState.microphoneActive,
  errorCode:residentSettingsError,
  lastUtterance:residentLastUtterance,
  lastReply:residentLastReply,
 });
 const ensureResidentSettings=async()=>{
  if(residentSettingsLoaded)return;
  if(!residentSettingsLoading)residentSettingsLoading=readResidentVoiceSettings(residentVoiceSettingsPath)
   .then(settings=>{residentSettings=settings;residentSettingsLoaded=true;residentSettingsError=null;residentVoice.updateSettings(settings);})
   .catch(error=>{
    residentSettings={...DEFAULT_RESIDENT_VOICE_SETTINGS};
    residentSettingsLoaded=true;
    residentSettingsError=error.code==='VOICE_SETTINGS_INVALID'?'VOICE_SETTINGS_INVALID':'VOICE_SETTINGS_READ_FAILED';
    residentVoiceState={state:'error',microphoneActive:false};
    diagnosticVoiceError(residentSettingsError,{stage:'settings_read'});
   });
  await residentSettingsLoading;
 };
 const initializeResidentVoice=async({autoStart=false}={})=>{
  await ensureResidentSettings();
  if(!autoStart||!residentSettings.enabled||residentVoiceState.microphoneActive)return residentVoice.status;
  try{await residentVoice.start(residentSettings);residentSettingsError=null;}
  catch(error){
   residentVoiceState={state:'error',microphoneActive:false};
   residentSettingsError=/^[A-Z0-9_]{1,64}$/.test(error.code||'')?error.code:'VOICE_START_FAILED';
   await diagnosticVoiceError(residentSettingsError,{...error,stage:error.stage||'service_start'});
  }
  return residentVoice.status;
 };
 const files=new Map([['/',['index.html','text/html']],['/app.js',['app.js','text/javascript']],['/api.js',['api.js','text/javascript']],['/voice-session.js',['voice-session.js','text/javascript']],['/voice-speech.js',['voice-speech.js','text/javascript']],['/style.css',['style.css','text/css']]]);
 const cookieValue=(req,name)=>(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1);
 const createSession=res=>{
  const id=randomBytes(32).toString('hex');
  sessions.set(id,{csrf:randomBytes(32).toString('hex'),expiresAt:Date.now()+3600000});
  res.setHeader('Set-Cookie',`jarvis_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
  diagnostic('session.created',{},logger);
 };
 const errorCodes={400:'INVALID_REQUEST',401:'SESSION_INVALID',403:'ORIGIN_OR_CSRF_INVALID',404:'NOT_FOUND',
  405:'METHOD_NOT_ALLOWED',409:'ACTION_BUSY',413:'PAYLOAD_TOO_LARGE',429:'RATE_LIMIT',500:'INTERNAL_ERROR',502:'PROVIDER_UNAVAILABLE',503:'RESOURCE_UNAVAILABLE',504:'TIMEOUT'};
 const server=http.createServer(async(req,res)=>{
  const reply=(status,body)=>{
   if(res.destroyed||res.writableEnded)return;
   if(status>=400)body={code:errorCodes[status]||'INTERNAL_ERROR',...body};
   res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));
  };
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Permissions-Policy','camera=(), microphone=(self), geolocation=()');res.setHeader('Cache-Control','no-store');
  // Links externos podem abrir somente o documento público de entrada.
  // Chamadas de API e alterações continuam sob os controles de origem e CSRF.
  const publicNavigation=req.method==='GET' && req.url==='/' &&
   req.headers['sec-fetch-mode']==='navigate' && req.headers['sec-fetch-dest']==='document' &&
   req.headers['sec-fetch-user']==='?1';
  if(req.headers.host!==`127.0.0.1:${port}` || (req.headers.origin && req.headers.origin!==origin) ||
   (req.headers['sec-fetch-site']==='cross-site' && !publicNavigation)) return reply(403,{code:'ORIGIN_INVALID',error:'Endereço incorreto. Use o endereço 127.0.0.1 e a porta informada pelo launcher.'});
  if(!['GET','POST'].includes(req.method)) return reply(405,{error:'Método recusado'});
  try {
   if(req.method==='GET' && files.has(req.url)) {
    const [file,type]=files.get(req.url); const data=await readFile(new URL(`../panel/${file}`,import.meta.url));
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8'}); return res.end(data);
   }
   if(req.method==='GET' && req.url==='/api/health')return reply(200,{ok:lifecycle==='running',state:lifecycle,instanceId});
   if(lifecycle!=='running')return reply(503,{code:'SERVER_STOPPING',error:'Jarvis encerrando operações. Aguarde a reconexão.'});
   let body={};
   if(req.method==='POST') {
    if(req.headers.origin!==origin || req.headers['content-type']!=='application/json') return reply(403,{error:'Requisição recusada'});
    const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>16384)return reply(413,{error:'Limite excedido'});chunks.push(chunk);}
    try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'JSON inválido'});}
    if(!body || typeof body!=='object' || Array.isArray(body))return reply(400,{error:'Dados inválidos'});
   }
   const now=Date.now();
    for(const [key,s] of sessions) if(s.expiresAt<=now){operations.clear(key);sessions.delete(key);approvals.clear(key);conversations.delete(key);}
   if(req.url==='/api/login' && req.method==='POST') {
    attempts=attempts.filter(t=>now-t<60000);
    if(attempts.length>=5)return reply(429,{error:'Aguarda um minuto e tenta novamente.'});
    if(!equal(body.code,accessCode)){attempts.push(now);return reply(401,{error:'Código incorreto'});}
    if([...sessions.values()].filter(value=>!value.residentVoice).length>=10)return reply(429,{error:'Limite de sessões. Reinicia o servidor.'});
    const previous=cookieValue(req,'jarvis_session');
    if(previous){operations.clear(previous);sessions.delete(previous);approvals.clear(previous);conversations.delete(previous);}
    createSession(res);
    return reply(200,{ok:true});
   }
   if(req.url==='/api/resume' && req.method==='POST') {
    if(Object.keys(body).length)return reply(400,{error:'Retomada não aceita parâmetros.'});
    if([...sessions.values()].filter(value=>!value.residentVoice).length>=10)return reply(429,{error:'Limite de sessões.'});
    if(!tickets.consume(cookieValue(req,RESTART_COOKIE)))return reply(401,{code:'RESUME_INVALID',error:'Entre novamente com o código do launcher.'});
    createSession(res);
    res.setHeader('Set-Cookie',[res.getHeader('Set-Cookie'),clearRestartCookie]);
    diagnostic('session.resumed',{},logger);
    return reply(200,{ok:true});
   }
   const id=cookieValue(req,'jarvis_session');
   const session=sessions.get(id);
   if(!session)return reply(401,{error:'Entra com o código do terminal.'});
   if(req.method==='POST' && !equal(req.headers['x-jarvis-csrf'],session.csrf))return reply(403,{code:'CSRF_INVALID',error:'Sessão inválida. Recarregue o painel.'});
   if(req.url==='/api/session' && req.method==='GET')return reply(200,{csrf:session.csrf,expiresAt:session.expiresAt,instanceId});
    if(req.url==='/api/status' && req.method==='GET')return reply(200,{
     ok:true,externalActions:true,state:lifecycle,
     openaiConfigured:aiRouter.status.openaiConfigured,
    openaiEnabled:aiRouter.status.openaiEnabled,
    openrouterConfigured:aiRouter.status.openrouterConfigured,
     geminiConfigured:aiRouter.status.geminiConfigured,
     restartAvailable:supervised&&typeof requestRestart==='function',shutdownAvailable:typeof requestShutdown==='function',
     operationTimeoutMs,
    });
    if(req.url==='/api/voice/resident' && req.method==='GET'){
     await ensureResidentSettings();
     if(residentSettings.enabled&&residentVoice.status?.enabled){
      if(!residentSession)ensureResidentSession();
      if(residentSession?.session.residentVoice)bindResidentSession(id,session);
     }
     return reply(200,residentVoiceSnapshot());
    }
    if(req.url==='/api/voice/resident' && req.method==='POST'){
     await ensureResidentSettings();
     if(Object.keys(body).some(key=>!['enabled','speakingRate','volume'].includes(key))||
      (body.enabled!==undefined&&typeof body.enabled!=='boolean')){
      return reply(400,{error:'Configuração de voz residente inválida.'});
     }
     const nextSettings=validateResidentVoiceSettings({
      enabled:body.enabled??residentSettings.enabled,
      speakingRate:body.speakingRate??residentSettings.speakingRate,
      volume:body.volume??residentSettings.volume,
     });
     if(!nextSettings)return reply(400,{error:'Velocidade ou volume fora do limite permitido.'});
     if(nextSettings.enabled&&residentVoicePlatform!=='win32')return reply(503,{code:'WINDOWS_ONLY',error:'A escuta residente está disponível somente no Windows.'});
     try{await writeResidentVoiceSettings(nextSettings,residentVoiceSettingsPath);}
     catch{residentSettingsError='VOICE_SETTINGS_WRITE_FAILED';return reply(503,{code:residentSettingsError,error:'Não foi possível salvar a configuração de voz residente.'});}
     residentSettings=nextSettings;residentSettingsError=null;residentVoice.updateSettings(nextSettings);
     if(nextSettings.enabled){
      bindResidentSession(id,session);
      try{await residentVoice.start(nextSettings);}
      catch(error){
       try{await residentVoice.stop();}catch{diagnosticVoiceError('VOICE_STOP_FAILED');}
       residentSettings={...nextSettings,enabled:false};
       try{await writeResidentVoiceSettings(residentSettings,residentVoiceSettingsPath);}catch{residentSettingsError='VOICE_SETTINGS_WRITE_FAILED';}
       residentVoiceState={state:'error',microphoneActive:false};
       const codes=['DOTNET_SDK_MISSING','VOICE_BUILD_FAILED','VOICE_START_FAILED','VOICE_START_TIMEOUT','VOICE_START_CANCELLED','VOICE_HELPER_MISSING','VOICE_BRIDGE_START_FAILED','VOICE_HELPER_INITIALIZATION_FAILED','WINDOWS_ONLY','MICROPHONE_PERMISSION_DENIED','MICROPHONE_UNAVAILABLE','PT_BR_RECOGNIZER_UNAVAILABLE','RECOGNITION_GRAMMAR_FAILED'];
       const code=codes.includes(error.code)?error.code:'VOICE_START_FAILED';
       residentSettingsError=code;
       await diagnosticVoiceError(code,{...error,stage:error.stage||'service_start'});
       const errorMessage=code==='MICROPHONE_PERMISSION_DENIED'
        ?'Permissão do microfone negada. Habilite o acesso para aplicativos da área de trabalho nas Configurações de Privacidade do Windows e tente novamente.'
        :code==='DOTNET_SDK_MISSING'
         ?'O .NET SDK 10 não está disponível para compilar o módulo de voz residente.'
         :'Não foi possível ativar a escuta residente. Verifique o diagnóstico local e tente novamente.';
       const diagnosticDetails=[
        typeof error.exceptionType==='string'&&/^[A-Za-z0-9_.+`]{1,160}$/.test(error.exceptionType)?error.exceptionType:null,
        typeof error.hresult==='string'&&/^0x[0-9A-F]{8}$/.test(error.hresult)?error.hresult:null,
       ].filter(Boolean).join(' · ');
       return reply(503,{code,error:diagnosticDetails?`${errorMessage} (${diagnosticDetails})`:errorMessage});
      }
     }else{
      try{await residentVoice.stop();}
      catch{residentSettingsError='VOICE_STOP_FAILED';return reply(503,{code:residentSettingsError,error:'Não foi possível confirmar o encerramento da escuta residente.'});}
      if(residentSession?.id===id)residentSession=null;
      residentVoiceState={state:'disabled',microphoneActive:false};
     }
     return reply(200,{ok:true,...residentVoiceSnapshot()});
    }
    if(req.url==='/api/admin/restart' && req.method==='POST'){
     if(Object.keys(body).length)return reply(400,{error:'A solicitação administrativa não aceita parâmetros.'});
     if(!supervised || typeof requestRestart!=='function')return reply(503,{error:'Reinício disponível somente pelo launcher do Windows.'});
      if(requestRestart()===false)return reply(503,{error:'O supervisor não aceitou o reinício.'});
      lifecycle='restarting';operations.stop();
      const ticket=tickets.issue();if(ticket)res.setHeader('Set-Cookie',ticket);
      diagnostic('server.restart_requested',{},logger);
     return reply(202,{ok:true,state:'restarting'});
    }
    if(req.url==='/api/admin/shutdown' && req.method==='POST'){
     if(Object.keys(body).length)return reply(400,{error:'A solicitação administrativa não aceita parâmetros.'});
     if(typeof requestShutdown!=='function')return reply(503,{error:'Desligamento indisponível neste modo de inicialização.'});
      if(requestShutdown()===false)return reply(503,{error:'O servidor não aceitou o desligamento.'});
      lifecycle='shutting_down';operations.stop();
      diagnostic('server.shutdown_requested',{},logger);
     return reply(202,{ok:true,state:'shutting_down'});
    }
    if(req.url==='/api/chat' && req.method==='GET')return reply(200,{messages:conversations.getMessages(id)});
    if(req.url==='/api/actions' && req.method==='GET')return reply(200,{items:operations.list(id)});
    if(req.url==='/api/actions/cancel' && req.method==='POST'){
     if(Object.keys(body).some(key=>key!=='id') || (body.id!==undefined && !/^[a-f0-9-]{36}$/.test(body.id)))return reply(400,{error:'Identificador de operação inválido.'});
     return reply(200,{ok:true,cancelled:operations.cancel(id,body.id)});
    }
    if(req.url==='/api/chat/clear' && req.method==='POST'){operations.clear(id);conversations.delete(id);return reply(200,{ok:true});}
    if(req.url==='/api/chat' && req.method==='POST'){
     if(typeof body.message!=='string' || !body.message.trim() || body.message.trim().length>2500)return reply(400,{error:'Escreve uma mensagem com até 2.500 caracteres.'});
     const requestId=req.headers['x-jarvis-request-id'];
     if(requestId!==undefined && (typeof requestId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)))return reply(400,{error:'Identificador de requisição inválido.'});
     const actionExecutor=executeAction;
     const disconnected=()=>{if(!res.writableEnded)operations.cancel(id);};
     res.once('close',disconnected);
     let outcome;
     try {outcome=await operations.run(id,requestId,body.message,async operation=>{
     let execution,completedAction;
     const check=()=>{
      operation.check();
      if(lifecycle!=='running')throw operationError('SERVER_STOPPING');
      if(!sessions.has(id)||session.expiresAt<=Date.now())throw operationError('SESSION_INVALID');
     };
     const reply=(status,body)=>{check();return {status,body:{...body,...(execution?{execution}:{})}};};
     const saveConversation=answer=>{check();conversations.appendExchange(id,body.message.trim(),answer,completedAction);};
     const controlError=error=>{
      check();
      if(['CANCELLED','TIMEOUT','PROCESS_TIMEOUT','ACTION_BUSY','SERVER_STOPPING','PROCESS_TERMINATION_FAILED'].includes(error?.code))throw error;
     };
     const executeAction=async(action,params)=>{
      check();
      if(actionBusy)throw operationError('ACTION_BUSY');
      actionBusy=true;operation.setAction(action);
      diagnostic('action.started',{operationId:operation.id,action},logger);
      try {
       const result=actionExecutor
        ?await abortable(Promise.resolve().then(()=>actionExecutor(action,params)),operation.signal)
        :await runDesktopAction(action,params,{signal:operation.signal,processManager:processes});
       check();
       if(!result||result.ok!==true)throw operationError('ACTION_FAILED');
       completedAction={action,params};
       execution={status:result.status||'completed',verified:result.verified===true};
       diagnostic('action.finished',{operationId:operation.id,action,state:execution.status},logger);
       return result;
      } finally {actionBusy=false;}
     };
     check();
     const message=body.message.trim(), history=conversations.getHistory(id);
      const action=detectLocalAction(message)||detectContextualLocalAction(message,conversations.getLastAction(id));
      const memoryCommand=action?null:parseMemoryCommand(message);
      if(memoryCommand){
       let answer;
       const label=memoryLabels[memoryCommand.key]||memoryFactLabel(memoryCommand.key);
       try {
        if(memoryCommand.type==='invalid')return reply(400,{error:'Não posso guardar credenciais ou dados sensíveis na memória.'});
        if(memoryCommand.type==='save'){
         const result=await localMemory.setFact(memoryCommand.key,memoryCommand.value);
         answer=result.updated?`Atualizei ${label} na memória.`:`Guardei ${label} na memória.`;
        }else if(memoryCommand.type==='delete'){
         const result=await localMemory.deleteFact(memoryCommand.key);
         answer=result.deleted?`Esqueci ${label}.`:`Não encontrei ${label} na memória.`;
        }else{
         const fact=await localMemory.getFact(memoryCommand.key);
         answer=fact?`${label} é ${fact.value}.`:`Ainda não tenho ${label} salvo.`;
        }
       }catch(error){
        if(error?.message==='MEMORY_LIMIT_REACHED')return reply(400,{error:'A memória atingiu o limite de 50 fatos pessoais. Esqueça um fato antes de guardar outro.'});
        return reply(503,{error:'Não consegui concluir a operação de memória local. Tenta novamente.'});
       }
       saveConversation(answer);
       return reply(200,{reply:answer,source:'local_memory'});
      }
      if(action){
        const actionName=typeof action==='string'?action:action.action;
        if(actionName==='invalid_volume')return reply(400,{error:'O volume deve ser um número inteiro entre 0 e 100.'});
        if(typeof action!=='string' && action.profileNotFound){
         const answer='Não encontrei esse perfil do Chrome.';
         saveConversation(answer);
         return reply(200,{reply:answer});
        }
        let actionResult;
        const actionParams=typeof action==='string'?undefined:
         action.profile?{profileName:action.profile.name}:action.params;
        try {actionResult=await executeAction(actionName,actionParams);}
        catch(error) {
         controlError(error);
         const errorMessage=error?.message==='APP_NOT_FOUND'&&actionParams?.app
          ?`Não encontrei ${LOCAL_APPS[actionParams.app]} nos locais de instalação conhecidos.`
          :error?.message==='FOLDER_NOT_FOUND'&&actionParams?.folder
           ?`Não encontrei ${LOCAL_FOLDERS[actionParams.folder]}.`
           :actionName==='open_site'&&actionParams?.site
            ?`Não consegui abrir ${LOCAL_SITES[actionParams.site].label}.`
           :['set_volume','volume_up','volume_down','mute','unmute'].includes(actionName)
            ?'Não consegui alterar o volume.'
           :actionName==='open_chrome'?'Não foi possível abrir o Chrome no Windows.':'Não foi possível executar essa ação no Windows.';
         return reply(503,{error:errorMessage});
        }
        const answer=truthfulActionReply(actionResult,typeof actionResult?.message==='string'&&actionResult.message.trim()
         ?actionResult.message.trim()
         :actionName==='open_chrome'
          ?action.profile?`Abrindo o Chrome no perfil ${action.profile.name}.`:'Abrindo o Chrome, Mateus.'
          :localActionConfirmation(actionName,action.params));
       saveConversation(answer);
       return reply(200,{reply:answer,source:'local_action'});
      }
      let persistentFacts=[];
      try {
       await localMemory.initialize();
       persistentFacts=await localMemory.getFacts();
      }catch{
       logger.warn?.('[MEMORY] memória persistente indisponível; seguindo sem fatos locais');
      }
      const rememberedAction=resolveMemoryPlayback(message,persistentFacts);
      if(rememberedAction){
       const validated=validateLocalAction(rememberedAction.action,rememberedAction.params);
       if(validated){
        let actionResult;
        try {actionResult=await executeAction(validated.action,validated.params);}
        catch(error){controlError(error);return reply(503,{error:'Não foi possível executar a ação local solicitada.'});}
        const answer=truthfulActionReply(actionResult,typeof actionResult?.message==='string'&&actionResult.message.trim()
         ?actionResult.message.trim():localActionConfirmation(validated.action,validated.params));
        saveConversation(answer);
        return reply(200,{reply:answer,source:'local_action'});
       }
      }
     let generated;
    try {generated=await aiRouter.generateResponse({
     message,history:history.map(item=>({...item})),memoryContext:buildMemoryContext(persistentFacts,message,history),signal:operation.signal,
    });}
    catch(error) {
     controlError(error);
     const failure=error instanceof AIProviderFailure?error.code:'AI_TEMPORARILY_UNAVAILABLE';
     const responses={
      AI_NOT_CONFIGURED:[503,'Nenhum provedor de IA está configurado. Preenche GOOGLE_API_KEY e GOOGLE_MODEL ou OPENROUTER_API_KEY e OPENROUTER_MODEL no arquivo .env.'],
      OPENAI_CONFIGURATION:[502,'A OpenAI não conseguiu autenticar ou aceitar a configuração. Verifica OPENAI_API_KEY e OPENAI_MODEL no .env.'],
      OPENROUTER_CONFIGURATION:[502,'O OpenRouter não conseguiu autenticar ou aceitar a configuração. Verifica OPENROUTER_API_KEY e OPENROUTER_MODEL no .env.'],
      GEMINI_CONFIGURATION:[502,'O Gemini não conseguiu autenticar ou aceitar a configuração. Verifica GOOGLE_API_KEY e GOOGLE_MODEL no .env.'],
      AI_TEMPORARILY_UNAVAILABLE:[502,'A IA está temporariamente indisponível. Tenta novamente em alguns instantes.'],
     };
     const [status,errorMessage]=responses[failure]||responses.AI_TEMPORARILY_UNAVAILABLE;
     return reply(status,{code:failure,error:errorMessage});
    }
    const answer=generated.text;
    if(typeof answer!=='string' || !answer.trim())return reply(502,{error:'O provedor de IA não retornou uma resposta. Tenta novamente.'});
    const result=parseGeminiResponse(answer);
    let responseText=result.type==='invalid_action'?unavailableActionReply
     :result.type==='invalid_response'?'Não consegui interpretar uma resposta válida agora. Tenta novamente.':result.reply;
    let source=generated.provider;
    if(result.type==='action') {
     const action=validateLocalAction(result.action,result.params);
     if(!action) responseText=unavailableActionReply;
     else {
      let actionResult;
      try {actionResult=await executeAction(action.action,action.params);}
      catch(error) {
       controlError(error);
       const failure=error?.message;
       const knownFailure=['APP_NOT_FOUND','FOLDER_NOT_FOUND','EXECUTABLE_NOT_FOUND'].includes(failure)?failure:'PROCESS_START_FAILED';
       console.warn(`Falha na ação local ${action.action}: ${knownFailure}.`);
       const errorMessage=failure==='APP_NOT_FOUND'
        ?`Não encontrei ${LOCAL_APPS[action.params.app]} nos locais de instalação conhecidos.`
        :failure==='FOLDER_NOT_FOUND'
         ?`Não encontrei ${LOCAL_FOLDERS[action.params.folder]}.`
        :action.action==='open_site'
         ?`Não consegui abrir ${LOCAL_SITES[action.params.site].label}.`
           :['set_volume','volume_up','volume_down','mute','unmute'].includes(action.action)
            ?'Não consegui alterar o volume.'
         :'Não foi possível iniciar o recurso solicitado no Windows. Verifica a instalação e tenta novamente.';
       return reply(503,{error:errorMessage});
      }
      responseText=truthfulActionReply(actionResult,typeof actionResult?.message==='string'&&actionResult.message.trim()
       ?actionResult.message.trim():localActionConfirmation(action.action,action.params));
      source='local_action';
     }
    }
    saveConversation(responseText);
    return reply(200,{reply:responseText,source});
     });}finally{res.removeListener('close',disconnected);}
     return reply(outcome.status,{...outcome.body,operationId:outcome.operationId});
    }
   if(req.url==='/api/approvals' && req.method==='GET')return reply(200,{items:approvals.list(id)});
   if(req.url==='/api/demo' && req.method==='POST')return reply(200,approvals.create(id));
   if(req.url==='/api/decision' && req.method==='POST'){
    try{return reply(200,approvals.decide(body.id,id,body.decision));}
    catch{return reply(400,{error:'Solicitação inválida, expirada ou já resolvida.'});}
   }
   if(req.url==='/api/logout' && req.method==='POST'){
    operations.clear(id);sessions.delete(id);approvals.clear(id);conversations.delete(id);res.setHeader('Set-Cookie',['jarvis_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',clearRestartCookie]);diagnostic('session.ended',{},logger);return reply(200,{ok:true});
   }
   return reply(404,{error:'Não encontrado'});
  }catch(error){
   const failures={
    CANCELLED:[409,'Operação cancelada.'],
    TIMEOUT:[504,'A operação excedeu o tempo limite e foi cancelada.'],
    PROCESS_TIMEOUT:[504,'O processo externo excedeu o tempo limite e foi encerrado.'],
    PROCESS_TERMINATION_FAILED:[503,'Não foi possível confirmar o encerramento do processo auxiliar.'],
    ACTION_BUSY:[409,'Já existe uma ação em andamento. Aguarde ou cancele.'],
    ACTION_LIMIT:[429,'Limite de operações recentes. Aguarde alguns minutos.'],
    IDEMPOTENCY_CONFLICT:[409,'Identificador já utilizado com outra mensagem.'],
    SERVER_STOPPING:[503,'Jarvis encerrando operações. Aguarde.'],
    SESSION_INVALID:[401,'Sessão expirada. Entre novamente.'],
   };
   const code=Object.hasOwn(failures,error?.code)?error.code:'INTERNAL_ERROR';
   const [status,message]=failures[code]||[500,'Erro interno do Jarvis. Consulte o diagnóstico no launcher.'];
   diagnostic('request.failed',{code},logger);
   return reply(status,{code,error:message});
  }
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 server.on('close',()=>{operations.stop();void processes.stop().catch(()=>diagnostic('process.cleanup_failed',{code:'PROCESS_TERMINATION_FAILED'},logger));});
 const close=()=>{
  if(closePromise)return closePromise;
  if(lifecycle==='running')lifecycle='shutting_down';
  operations.stop();
  closePromise=(async()=>{
   diagnostic('server.stopping',{state:lifecycle},logger);
   residentVoiceRequestController?.abort();
   const closed=new Promise(resolve=>server.close(resolve));
   let cleanupError;
   try {await Promise.all([processes.stop(),operations.drain(),residentVoice.stop(),...pendingResidentDiagnosticWrites]);}
   catch(error){cleanupError=error;diagnostic('process.cleanup_failed',{code:'PROCESS_TERMINATION_FAILED'},logger);}
   finally {server.closeAllConnections();await closed;}
   sessions.clear();conversations.clear();residentSession=null;
   diagnostic('server.stopped',{},logger);
   if(cleanupError)throw cleanupError;
  })();
  return closePromise;
 };
 return {server,accessCode,close,initializeResidentVoice};
}
export async function startServer({port=resolvePort()}={}) {
 const supervised=process.env.JARVIS_SUPERVISED==='1';
 const accessCode=process.env.JARVIS_ACCESS_CODE||randomBytes(24).toString('hex');
 let scheduled=false;
 const stop=exitCode=>{
  if(scheduled)return false;
  scheduled=true;
  setTimeout(()=>void close().then(()=>{
   cleanup();process.exitCode=exitCode;
   if(process.connected)process.disconnect();
  },()=>{cleanup();process.exitCode=1;if(process.connected)process.disconnect();}),150);
  return true;
 };
 const {server,close,initializeResidentVoice}=createServer({port,accessCode,supervised,residentVoiceAutoStart:true,
  restartSecret:process.env.JARVIS_RESTART_SECRET,generation:Number(process.env.JARVIS_GENERATION),
  requestRestart:supervised?()=>stop(75):undefined,
  requestShutdown:()=>stop(0),
 });
 const onStop=()=>stop(0);
 const onMessage=message=>{if(message?.type==='shutdown')stop(0);};
 const cleanup=()=>{
  process.removeListener('SIGINT',onStop);process.removeListener('SIGTERM',onStop);
  process.removeListener('disconnect',onStop);process.removeListener('message',onMessage);
 };
 process.once('SIGINT',onStop);process.once('SIGTERM',onStop);
 if(process.connected){process.once('disconnect',onStop);process.on('message',onMessage);}
 server.on('error',error=>{
  diagnostic('server.listen_failed',{port,code:error.code==='EADDRINUSE'?'PORT_IN_USE':'LISTEN_FAILED'});
  console.error(error.code==='EADDRINUSE'
   ?`Porta ${port} ocupada. Verifique se o Jarvis já está aberto em ${serverOrigin(port)}. Não será escolhida outra porta automaticamente.`
   :`Não foi possível escutar na porta ${port}. Verifique configuração e permissões.`);
  cleanup();process.exitCode=1;if(process.connected)process.disconnect();
 });
 server.listen(port,HOST,()=>{
  diagnostic('server.listening',{port});
  // Explicit pairing display, not a diagnostic log. Never include this value in
  // error reports, log files, requests or subprocess arguments.
  console.log(`Jarvis: ${serverOrigin(port)}\nCódigo de acesso (copia apenas a linha abaixo):\n${accessCode}\n${supervised?'Válido enquanto o launcher estiver aberto.':'Válido até reiniciar.'} Não compartilhes este código.`);
  void initializeResidentVoice({autoStart:true});
 });
 return {server,close};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 void import('../../scripts/start.mjs').then(({main})=>main());
}
