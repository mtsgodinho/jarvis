import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../apps/local-server/server.mjs';
import {createApprovalStore} from '../packages/security/approval-store.mjs';
test('aprovação vinculada, expirada e de uso único',()=>{
 let time=0;const s=createApprovalStore({now:()=>time,ttl:10});const a=s.create('a');
 assert.throws(()=>s.decide(a.id,'b','approve'));
 assert.equal(s.decide(a.id,'a','approve').state,'completed');
 assert.throws(()=>s.decide(a.id,'a','approve'));
 const b=s.create('a');time=10;assert.throws(()=>s.decide(b.id,'a','approve'));
 const c=s.create('a');assert.equal(s.decide(c.id,'a','reject').state,'rejected');
});
test('HTTP autenticação, origem, CSRF, aprovação e logout',async()=>{
 const port=18787,origin=`http://127.0.0.1:${port}`;const {server}=createServer({port,accessCode:'test-code'});
 await new Promise(r=>server.listen(port,'127.0.0.1',r));
 try{
 const req=(path,data,headers={})=>fetch(origin+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json',Origin:origin}:{}),...headers},body:data?JSON.stringify(data):undefined});
 assert.equal((await req('/')).status,200);
 for(const asset of ['/voice-session.js','/voice-speech.js']) {
  const response=await req(asset);
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/javascript/);
 }
 assert.equal((await req('/api/status')).status,401);
 assert.equal((await req('/api/login',{code:'test-code'},{Origin:'https://evil.example'})).status,403);
 assert.equal((await req('/api/login',{code:'wrong'})).status,401);
 const login=await req('/api/login',{code:'test-code'});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const session=await (await req('/api/session',null,{Cookie:cookie})).json();assert.ok(session.csrf);
 assert.equal((await req('/api/demo',{},{Cookie:cookie})).status,403);
 const headers={Cookie:cookie,'X-Jarvis-CSRF':session.csrf};
 const item=await (await req('/api/demo',{},headers)).json();assert.ok(item.id);
 assert.equal((await req('/api/decision',{id:item.id,decision:'approve'},headers)).status,200);
 assert.equal((await req('/api/decision',{id:item.id,decision:'approve'},headers)).status,400);
 assert.equal((await req('/api/logout',{},headers)).status,200);
 assert.equal((await req('/api/session',null,headers)).status,401);
 for(let i=0;i<4;i++)assert.equal((await req('/api/login',{code:'wrong'})).status,401);
 assert.equal((await req('/api/login',{code:'wrong'})).status,429);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
