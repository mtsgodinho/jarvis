import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from '../packages/core/dispatcher.mjs';
import { consumeApproval } from '../packages/security/approvals.mjs';
import { vetTarget, blockedAddress } from '../vendor/adewaskar/net.mjs';
test('ações desconhecidas e shell não são executados', () => {
  for (const kind of ['shell.exec','files.delete','browser.click','approve',null]) {
    assert.equal(dispatch({kind}).code, 'DENIED');
  }
});
test('alegar aprovação no payload não libera integração', () => {
  assert.equal(dispatch({kind:'desktop.open_app',approved:true}).ok,false);
  assert.throws(() => consumeApproval(), /NOT_IMPLEMENTED/);
});
test('status local é a única ação funcional', () => {
  assert.deepEqual(dispatch({kind:'system.status'}),{ok:true,mode:'skeleton',externalActions:false});
});
test('módulo reaproveitado bloqueia destinos privados conhecidos', () => {
  for (const url of ['http://127.0.0.1','http://192.168.1.1','http://169.254.169.254','http://[::1]','file:///etc/passwd','http://localhost']) assert.throws(()=>vetTarget(url));
  assert.equal(blockedAddress('::ffff:7f00:1'),true);
});
