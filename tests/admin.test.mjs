import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../apps/local-server/server.mjs';

let nextPort=18850;
async function withServer(options, run) {
 const port=nextPort++,origin=`http://127.0.0.1:${port}`,{server}=createServer({requireActionApproval:false,port,...options});
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 const request=async(path,data,headers={})=>{
  const response=await fetch(origin+path,{
   method:data===undefined?'GET':'POST',
   headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...headers},
   body:data===undefined?undefined:JSON.stringify(data),
  });
  return {response,body:await response.json()};
 };
 try {await run(request);} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
async function authenticated(request) {
 const login=await request('/api/login',{code:'admin-test'});
 const cookie=login.response.headers.get('set-cookie').split(';')[0];
 const session=await request('/api/session',undefined,{Cookie:cookie});
 return {Cookie:cookie,'X-Jarvis-CSRF':session.body.csrf};
}

test('reinício exige sessão e CSRF e usa somente a solicitação fixa do supervisor',async()=>{
 let restartCalls=0;
 await withServer({accessCode:'admin-test',supervised:true,requestRestart:()=>{restartCalls++;}},async request=>{
  assert.equal((await request('/api/admin/restart',{})).response.status,401);
  const headers=await authenticated(request);
  assert.equal((await request('/api/admin/restart',{}, {Cookie:headers.Cookie})).response.status,403);
  const arbitrary=await request('/api/admin/restart',{command:'powershell Start-Process calc.exe'},headers);
  assert.equal(arbitrary.response.status,400);
  assert.equal(restartCalls,0);
  const result=await request('/api/admin/restart',{},headers);
  assert.equal(result.response.status,202);
  assert.deepEqual(result.body,{ok:true,state:'restarting'});
  assert.equal(restartCalls,1);
 });
});

test('desligamento exige sessão e CSRF, rejeita comandos e não solicita reinício',async()=>{
 let restartCalls=0,shutdownCalls=0;
 await withServer({accessCode:'admin-test',supervised:true,
  requestRestart:()=>{restartCalls++;},requestShutdown:()=>{shutdownCalls++;}},async request=>{
  assert.equal((await request('/api/admin/shutdown',{})).response.status,401);
  const headers=await authenticated(request);
  assert.equal((await request('/api/admin/shutdown',{}, {Cookie:headers.Cookie})).response.status,403);
  const arbitrary=await request('/api/admin/shutdown',{command:'format C:'},headers);
  assert.equal(arbitrary.response.status,400);
  assert.equal(shutdownCalls,0);
  const result=await request('/api/admin/shutdown',{},headers);
  assert.equal(result.response.status,202);
  assert.deepEqual(result.body,{ok:true,state:'shutting_down'});
  assert.equal(shutdownCalls,1);
  assert.equal(restartCalls,0);
 });
});

test('restart é recusado quando o servidor não foi iniciado pelo supervisor',async()=>{
 await withServer({accessCode:'admin-test'},async request=>{
  const headers=await authenticated(request);
  assert.equal((await request('/api/admin/restart',{},headers)).response.status,503);
 });
});
