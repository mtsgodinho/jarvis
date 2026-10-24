import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {validateWindowAction,runWindowAction} from '../packages/desktop/windows-control.mjs';
import {createProcessManager} from '../packages/desktop/processes.mjs';
import {autostartScript,configureAutostart} from '../scripts/autostart-windows.mjs';
import {createSpotifyPlayer} from '../packages/providers/spotify.mjs';

test('janelas e energia validam catálogo, alvos e atalhos sem comandos arbitrários',()=>{
 assert.equal(validateWindowAction('shutdown_windows',{force:true}),null);
 assert.equal(validateWindowAction('keyboard_shortcut',{app:'notepad',shortcut:'{WIN}r cmd'}),null);
 assert.equal(validateWindowAction('close_app',{app:'unknown'}),null);
 assert.equal(validateWindowAction('type_text',{app:'notepad',control:'Texto',text:'olá'}).action,'type_text');
});
test('automação usa script fixo e conteúdo codificado, sem invocar shell genérico',async()=>{
 let captured;
 const text="'; Start-Process evil; '";
 const result=await runWindowAction('type_text',{app:'notepad',control:'Editor',text},{platform:'win32',exists:()=>true,processManager:{run:async(executable,args,options)=>{captured={executable,args,options};return {stdout:'{"ok":true,"status":"requested","verified":false}'};}}});
 const script=Buffer.from(captured.args.at(-1),'base64').toString('utf16le');
 assert.doesNotMatch(script,/Start-Process evil/);assert.match(script,/IsPassword/);assert.match(script,/CONTROL_NOT_UNIQUE/);assert.match(script,/GetForegroundWindow/);assert.equal(captured.options.captureOutput,true);assert.equal(result.verified,false);
 await assert.rejects(runWindowAction('list_apps',{}, {platform:'linux'}),/WINDOWS_ONLY/);
});
test('gerenciador captura stdout limitado sem propagar credenciais',async()=>{
 const manager=createProcessManager({logger:{info(){}}});
 let options;
 const result=await manager.run('fixture',[],{captureOutput:true,env:{SPOTIFY_ACCESS_TOKEN:'fixture-secret'},spawnProcess:(executable,args,opts)=>{
  options=opts;const child=new EventEmitter();child.stdout=new PassThrough();
  setImmediate(()=>{child.emit('spawn');child.stdout.write('{"ok":true}');child.emit('close',0);});return child;
 }});
 assert.equal(result.stdout,'{"ok":true}');assert.equal(options.env.SPOTIFY_ACCESS_TOKEN,undefined);assert.equal(options.shell,false);await manager.stop();
});
test('inicialização automática é opt-in e não substitui atalhos alheios',async()=>{
 const enable=autostartScript({enable:true,nodePath:'C:\\node.exe',root:'C:\\jarvis'});
 assert.match(enable,/AUTOSTART_ALREADY_EXISTS/);assert.match(enable,/AUTOSTART_NOT_OWNED/);assert.doesNotMatch(enable,/Set-ExecutionPolicy|RunAs|HKLM/);
 await assert.rejects(configureAutostart({platform:'linux',enable:true}),/WINDOWS_ONLY/);
 await assert.rejects(configureAutostart({platform:'win32'}),/EXPLICIT_OPT_IN_REQUIRED/);
});
test('Spotify exige conta/dispositivo e verifica reprodução após solicitar play',async()=>{
 let calls=0;const track='spotify:track:1234567890123456789012';
 const player=createSpotifyPlayer({token:'test-fixture',fetchImpl:async(url,options)=>{
  calls++;assert.equal(new URL(url).hostname,'api.spotify.com');assert.equal(options.redirect,'error');
  if(calls===1)return Response.json({tracks:{items:[{uri:track,name:'Música teste'}]}});
  if(calls===2)return Response.json({devices:[{id:'device',is_active:true,is_restricted:false}]});
  if(calls===3){assert.deepEqual(JSON.parse(options.body),{uris:[track]});return new Response(null,{status:204});}
  return Response.json({is_playing:true,item:{uri:track},device:{id:'device'}});
 }});
 assert.equal((await player.play('música teste')).verified,true);assert.equal(calls,4);
 await assert.rejects(createSpotifyPlayer({token:''}).play('teste'),{code:'SPOTIFY_NOT_CONFIGURED'});
 await assert.rejects(createSpotifyPlayer({token:'fixture',fetchImpl:async()=>new Response(null,{status:403})}).play('teste'),{code:'SPOTIFY_PREMIUM_OR_SCOPE_REQUIRED'});
});
test('Spotify não confirma reprodução sem estado correspondente',async()=>{
 let calls=0;
 const player=createSpotifyPlayer({token:'fixture',fetchImpl:async()=>{
  calls++;return calls===1?Response.json({tracks:{items:[{uri:'spotify:track:1234567890123456789012',name:'Teste'}]}})
  :calls===2?Response.json({devices:[{id:'d',is_active:true}]})
  :new Response(null,{status:204});
 }});
 assert.equal((await player.play('teste')).verified,false);
});
