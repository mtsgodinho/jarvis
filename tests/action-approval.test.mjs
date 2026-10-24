import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createActionApprovals, canonicalAction } from '../packages/security/action-approval.mjs';
import { createServer } from '../apps/local-server/server.mjs';

export async function fixture(run, options = {}) {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const calls = [];
  const app = createServer({ port, accessCode: 'test-actions', logger: { info() {}, warn() {} },
    googleApiKey: '', googleModel: '', openrouterApiKey: '', openaiEnabled: false,
    executeAction: async (...args) => { calls.push(args); return { ok: true, status: 'completed', verified: true }; }, ...options });
  await new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${port}`;
  const request = async (path, body, auth = {}) => {
    const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...auth },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text(), headers: response.headers };
  };
  const login = async () => {
    const response = await request('/api/login', { code: 'test-actions' });
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const session = await request('/api/session', undefined, { Cookie: cookie });
    return { Cookie: cookie, 'X-Jarvis-CSRF': session.body.csrf };
  };
  try { await run({ request, auth: await login(), login, calls }); }
  finally { await app.close(); }
}

test('propostas preservam argumentos, pertencimento, expiração e uso único', () => {
  let now = 0;
  const store = createActionApprovals({ now: () => now, ttl: 10 });
  const item = store.create('owner', 'open_app', { app: 'notepad' }, 'abra bloco');
  item.params.app = 'chrome';
  assert.throws(() => store.decide(item.id, 'other', 'approve'));
  assert.equal(store.decide(item.id, 'owner', 'approve').params.app, 'notepad');
  assert.throws(() => store.decide(item.id, 'owner', 'approve'));
  assert.equal(store.finish(item.id, 'owner', { ok: true, status: 'launched' }).execution.verified, false);
  const expired = store.create('owner', 'mute', {}); now = 10;
  assert.throws(() => store.decide(expired.id, 'owner', 'approve'));
  assert.equal(store.list('owner').find(item => item.id === expired.id).state, 'expired');
  assert.equal(canonicalAction('open_app', { app: 'notepad', command: 'malicious' }), null);
  assert.equal(canonicalAction('open_chrome', { profileName: {} }), null);
});

test('chat padrão propõe, exige CSRF e executa uma única vez com argumentos imutáveis', async () => {
  await fixture(async ({ request, auth, calls, login }) => {
    const proposal = await request('/api/chat', { message: 'abra o bloco de notas' }, auth);
    assert.equal(proposal.status, 200);
    assert.equal(proposal.body.execution.status, 'pending_approval');
    assert.match(proposal.body.reply, /Nada foi executado/);
    assert.equal(calls.length, 0);
    const id = proposal.body.execution.approvalId;
    const visible=(await request('/api/approvals',undefined,auth)).body.items[0];
    assert.equal(Object.hasOwn(visible,'owner'),false);
    const other = await login();
    assert.equal((await request('/api/approvals', undefined, other)).body.items.length, 0);
    assert.equal((await request('/api/decision', { id, decision: 'approve' }, other)).status, 400);
    assert.equal((await request('/api/decision', { id, decision: 'approve' }, { Cookie: auth.Cookie })).status, 403);
    assert.equal((await request('/api/decision', { id, decision: 'approve', params: { app: 'chrome' } }, auth)).status, 400);
    const approved = await request('/api/decision', { id, decision: 'approve' }, auth);
    assert.equal(approved.status, 200); assert.equal(approved.body.execution.verified, true);
    assert.deepEqual(calls, [['open_app', { app: 'notepad' }]]);
    assert.equal((await request('/api/decision', { id, decision: 'approve' }, auth)).status, 400);
    assert.equal(calls.length, 1);
  });
});

test('recusa, limpar conversa e logout invalidam propostas sem executar', async () => {
  await fixture(async ({ request, auth, calls }) => {
    const propose = async () => (await request('/api/chat', { message: 'abra o Chrome' }, auth)).body.execution.approvalId;
    let id = await propose();
    assert.equal((await request('/api/decision', { id, decision: 'reject' }, auth)).body.state, 'rejected');
    assert.equal((await request('/api/decision', { id, decision: 'approve' }, auth)).status, 400);
    id = await propose(); await request('/api/chat/clear', {}, auth);
    assert.equal((await request('/api/decision', { id, decision: 'approve' }, auth)).status, 400);
    id = await propose(); await request('/api/logout', {}, auth);
    assert.equal((await request('/api/decision', { id, decision: 'approve' }, auth)).status, 401);
    assert.equal(calls.length, 0);
  });
});

test('falha do executor não vira sucesso nem permite repetir aprovação', async () => {
  await fixture(async ({ request, auth }) => {
    const proposal = await request('/api/chat', { message: 'abra o Chrome' }, auth);
    const id = proposal.body.execution.approvalId;
    const visible=(await request('/api/approvals',undefined,auth)).body.items[0];
    assert.equal(Object.hasOwn(visible,'owner'),false);
    assert.equal((await request('/api/decision', { id, decision: 'approve' }, auth)).status, 503);
    assert.equal((await request('/api/approvals', undefined, auth)).body.items[0].state, 'failed');
    assert.equal((await request('/api/decision', { id, decision: 'approve' }, auth)).status, 400);
  }, { executeAction: async () => { throw new Error('WINDOWS_ONLY'); } });
});

test('diagnósticos e gestão de memória exigem sessão/CSRF e não retornam credenciais',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const path=await import('node:path');
 const directory=await mkdtemp(path.join(tmpdir(),'jarvis-management-'));
 try{
  await fixture(async({request,auth})=>{
   assert.equal((await request('/api/memory')).status,401);
   assert.equal((await request('/api/diagnostics')).status,401);
   assert.equal((await request('/tools-panel.js')).status,200);
   assert.equal((await request('/api/memory',{key:'user:projeto',value:'Jarvis'},{Cookie:auth.Cookie})).status,403);
   assert.equal((await request('/api/memory',{key:'user:projeto',value:'Jarvis'},auth)).status,200);
   assert.equal((await request('/api/memory',undefined,auth)).body.items[0].value,'Jarvis');
   assert.equal((await request('/api/memory',{key:'user:senha',value:'12345'},auth)).status,400);
   assert.equal((await request('/api/memory/delete',{key:'user:projeto',path:'/etc/passwd'},auth)).status,400);
   assert.equal((await request('/api/memory/delete',{key:'user:projeto'},auth)).body.deleted,true);
   const diagnostics=await request('/api/diagnostics',undefined,auth);
   assert.equal(diagnostics.status,200);assert.deepEqual(diagnostics.body.voice,[]);
   assert.doesNotMatch(JSON.stringify(diagnostics.body),/private-provider-key/);
   assert.equal((await request('/api/proposals',{action:'shutdown_windows',params:{force:true}},auth)).status,400);
  },{memoryFilePath:path.join(directory,'memory.json'),residentVoiceDiagnosticsPath:path.join(directory,'voice.json'),googleApiKey:'private-provider-key',googleModel:'fixture'});
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('intenções vindas da IA também passam por aprovação sem executar automaticamente',async()=>{
 await fixture(async({request,auth,calls})=>{
  const result=await request('/api/chat',{message:'Gostaria de iniciar meu editor favorito, por favor'},auth);
  assert.equal(result.body.execution.status,'pending_approval');assert.equal(calls.length,0);
  const approved=await request('/api/decision',{id:result.body.execution.approvalId,decision:'approve'},auth);
  assert.equal(approved.status,200);assert.deepEqual(calls,[['open_app',{app:'vscode'}]]);
 },{googleApiKey:'fixture',googleModel:'fixture',generateReply:async()=>'{"type":"action","action":"open_app","params":{"app":"vscode"}}'});
});
test('cancelar execução aprovada não confirma resultado tardio nem reutiliza autorização',async()=>{
 let resolveResult,started;
 const ready=new Promise(resolve=>{started=resolve;});
 await fixture(async({request,auth})=>{
  const proposal=await request('/api/chat',{message:'abra o Chrome'},auth);const id=proposal.body.execution.approvalId;
  const pending=request('/api/decision',{id,decision:'approve'},auth);await ready;
  const operations=(await request('/api/actions',undefined,auth)).body.items;
  assert.equal(operations.length,1);
  assert.equal((await request('/api/actions/cancel',{id:operations[0].id},auth)).body.cancelled,true);
  assert.equal((await pending).body.code,'CANCELLED');
  resolveResult({ok:true,status:'completed',verified:true});
  await new Promise(resolve=>setImmediate(resolve));
  const items=(await request('/api/approvals',undefined,auth)).body.items;
  assert.equal(items[0].state,'failed');
  assert.equal((await request('/api/decision',{id,decision:'approve'},auth)).status,400);
 },{executeAction:()=>{started();return new Promise(resolve=>{resolveResult=resolve;});}});
});
