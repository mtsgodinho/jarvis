import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { processEnvironment } from '../packages/security/process-environment.mjs';
import { diagnostic } from '../packages/core/diagnostics.mjs';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const serverPath=fileURLToPath(new URL('./start.mjs',import.meta.url));
const restartCode=75;

export async function supervise({
 accessCode=randomBytes(24).toString('hex'),
 spawnChild=spawn,
 nodePath=process.execPath,
 entryPath=serverPath,
 env=process.env,
 onChild=()=>{},
 shouldStop=()=>false,
}={}) {
 const restartSecret=randomBytes(32).toString('hex');
 const childEnv={...processEnvironment(env,{backend:true}),JARVIS_ACCESS_CODE:accessCode,JARVIS_SUPERVISED:'1',JARVIS_RESTART_SECRET:restartSecret};
 let generation=0;
 while(!shouldStop()) {
  childEnv.JARVIS_GENERATION=String(++generation);
  const child=spawnChild(nodePath,[entryPath],{
   cwd:projectRoot,
   env:childEnv,
   stdio:['inherit','inherit','inherit','ipc'],
   shell:false,
   windowsHide:true,
  });
    onChild(child);
   const code=await new Promise(resolve=>{
    child.once('error',()=>{diagnostic('supervisor.child_error',{code:'PROCESS_START_FAILED'});resolve(1);});
    child.once('close',resolve);
   });
    onChild(null);
  if(shouldStop())return 0;
   diagnostic('supervisor.child_closed',{exitCode:code??1});
   if(code!==restartCode)return code??1;
 }
 return 0;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 let activeChild,stopRequested=false,stopTimer;
 const stopChild=()=>{
   stopRequested=true;
   if(activeChild&&activeChild.exitCode===null) {
    if(activeChild.connected)activeChild.send({type:'shutdown'},()=>{});
    else activeChild.kill('SIGTERM');
    stopTimer=setTimeout(()=>activeChild?.kill('SIGKILL'),8000);
    stopTimer.unref();
   }
 };
 process.once('SIGINT',stopChild);
 process.once('SIGTERM',stopChild);
 const removeHandlers=()=>{
  process.removeListener('SIGINT',stopChild);
  process.removeListener('SIGTERM',stopChild);
  clearTimeout(stopTimer);
 };
 supervise({onChild:child=>{activeChild=child;},shouldStop:()=>stopRequested}).then(code=>{
  removeHandlers();process.exitCode=code;
 },()=>{
   removeHandlers();console.error('Não foi possível iniciar o supervisor do Jarvis. Verifique Node.js e as permissões do projeto.');process.exitCode=1;
 });
}
