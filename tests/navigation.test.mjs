import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createServer} from '../apps/local-server/server.mjs';
test('link externo abre login, mas não libera API, iframe ou POST',async()=>{
 const port=18788;const {server}=createServer({requireActionApproval:false,port,accessCode:'test'});
 await new Promise(r=>server.listen(port,'127.0.0.1',r));
 const call=(path,headers={},method='GET')=>new Promise((resolve,reject)=>{
  const req=http.request({hostname:'127.0.0.1',port,path,headers,method},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();
 });
 const external={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-user':'?1'};
 try{
  assert.equal(await call('/',external),200);
  assert.equal(await call('/'),200);
  assert.equal(await call('/api/session',external),403);
  assert.equal(await call('/api/login',external,'POST'),403);
  assert.equal(await call('/',{...external,'sec-fetch-dest':'iframe'}),403);
  assert.equal(await call('/',{...external,Origin:'https://evil.example'}),403);
  assert.equal(await call('/',{...external,Host:'evil.example'}),403);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
