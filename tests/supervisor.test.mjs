import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {supervise} from '../scripts/supervisor.mjs';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const supervisorPath=fileURLToPath(new URL('../scripts/supervisor.mjs',import.meta.url));
const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

async function freePort(){
 const server=net.createServer();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const port=server.address().port;
 await new Promise(resolve=>server.close(resolve));
 return port;
}

async function waitUntil(check,message){
 const deadline=Date.now()+12000;
 while(Date.now()<deadline){if(await check())return;await delay(75);}
 assert.fail(message);
}

test('supervisor reinicia apenas no código reservado, sequencialmente e com o mesmo código de acesso',async()=>{
 const calls=[],exitCodes=[75,0];
 let active=0,maxActive=0;
 const result=await supervise({
  accessCode:'stable-access-code',nodePath:'node-test',entryPath:'server-test',env:{PATH:'test'},
  spawnChild:(command,args,options)=>{
   calls.push({command,args,options});
   active++;
   maxActive=Math.max(maxActive,active);
   const child=new EventEmitter();
   const exitCode=exitCodes.shift();
   setImmediate(()=>{active--;child.emit('close',exitCode,null);});
   return child;
  },
 });
 assert.equal(result,0);
 assert.equal(calls.length,2);
 assert.equal(maxActive,1);
 for(const call of calls) {
  assert.equal(call.command,'node-test');
  assert.deepEqual(call.args,['server-test']);
  assert.equal(call.options.env.JARVIS_ACCESS_CODE,'stable-access-code');
  assert.equal(call.options.env.JARVIS_SUPERVISED,'1');
  assert.equal(call.options.shell,false);
  assert.deepEqual(call.options.stdio,['inherit','inherit','inherit','ipc']);
 }
});

test('código de desligamento encerra o supervisor sem iniciar outro servidor',async()=>{
 let starts=0;
 const result=await supervise({spawnChild:()=>{
  starts++;
  const child=new EventEmitter();
  setImmediate(()=>child.emit('close',0,null));
  return child;
 }});
 assert.equal(result,0);
 assert.equal(starts,1);
});

test('interrupção do launcher encerra sem reiniciar e retorna sucesso',async()=>{
 let starts=0,stopRequested=false;
 const result=await supervise({shouldStop:()=>stopRequested,spawnChild:()=>{
  starts++;
  const child=new EventEmitter();
  setImmediate(()=>{stopRequested=true;child.emit('close',null,'SIGTERM');});
  return child;
 }});
 assert.equal(result,0);
 assert.equal(starts,1);
});

test('restart HTTP reinicia o filho, renova a sessão e shutdown encerra o supervisor',async()=>{
 const port=await freePort(),origin=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,[supervisorPath],{
  cwd:projectRoot,
  env:{...process.env,PORT:String(port)},
  stdio:['ignore','pipe','pipe'],
 });
 let output='';
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;});
 child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{output+=chunk;});
 const request=async(path,data,headers={})=>fetch(origin+path,{
  method:data===undefined?'GET':'POST',
  headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...headers},
  body:data===undefined?undefined:JSON.stringify(data),
 });
 try {
  await waitUntil(async()=>{
   try{return (await request('/')).ok&&/Código de acesso/.test(output);}
   catch{return false;}
  },'servidor supervisionado não iniciou');
  const accessCode=output.match(/Código de acesso[^\r\n]*\r?\n([a-f0-9]{48})/)?.[1];
  assert.ok(accessCode);
  const login=await request('/api/login',{code:accessCode});
  assert.equal(login.status,200);
  const oldCookie=login.headers.get('set-cookie').split(';')[0];
  const oldSession=await request('/api/session',undefined,{Cookie:oldCookie});
  const restart=await request('/api/admin/restart',{}, {Cookie:oldCookie,'X-Jarvis-CSRF':(await oldSession.json()).csrf});
  assert.equal(restart.status,202);
  const ticket=restart.headers.get('set-cookie');
  assert.match(ticket,/HttpOnly/);
  assert.match(ticket,/SameSite=Strict/);
  assert.match(ticket,/Path=\/api\/resume/);
  await waitUntil(async()=>{
   try{return (await request('/api/session',undefined,{Cookie:oldCookie})).status===401;}
   catch{return false;}
  },'processo não voltou com a sessão antiga invalidada');
  await waitUntil(()=>Promise.resolve((output.match(/Código de acesso/g)||[]).length>=2),'novo processo não anunciou a inicialização');
  const restartedCode=output.match(/Código de acesso[^\r\n]*\r?\n([a-f0-9]{48})/g).map(line=>line.match(/[a-f0-9]{48}/)[0]);
  assert.deepEqual(restartedCode,[accessCode,accessCode]);
  // No in-memory access code: same path used after F5. Cookie is sent only
  // by the browser, never read by the panel.
  const newLogin=await request('/api/resume',{}, {Cookie:ticket.split(';')[0]});
  assert.equal(newLogin.status,200);
  assert.equal((await request('/api/resume',{}, {Cookie:ticket.split(';')[0]})).status,401);
  const newCookie=newLogin.headers.get('set-cookie').split(';')[0];
  const newSession=await request('/api/session',undefined,{Cookie:newCookie});
  const shutdown=await request('/api/admin/shutdown',{}, {Cookie:newCookie,'X-Jarvis-CSRF':(await newSession.json()).csrf});
  assert.equal(shutdown.status,202);
    let timeout;
    const closed=await Promise.race([
     once(child,'close'),
     new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('supervisor não encerrou após shutdown')),5000);}),
    ]);
    clearTimeout(timeout);
    const [exitCode]=closed;
  assert.equal(exitCode,0);
 } finally {
  if(child.exitCode===null){
   child.kill('SIGTERM');
   await Promise.race([once(child,'close'),delay(3000)]);
  }
 }
});
