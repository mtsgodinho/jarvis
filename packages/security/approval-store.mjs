import { randomBytes } from 'node:crypto';
export function createApprovalStore({now = Date.now, ttl = 60000} = {}) {
  const pending = new Map();
  const snapshot = ({owner, ...item}) => ({...item});
  function get(id, owner) {
    const item = pending.get(id);
    if (!item || item.owner !== owner) throw new Error('NOT_FOUND');
    if (now() >= item.expiresAt && item.state === 'pending') item.state = 'expired';
    return item;
  }
  return {
    create(owner) {
      if (pending.size >= 100) throw new Error('LIMIT');
      const item = {id: randomBytes(24).toString('hex'), owner, kind:'demo.confirm',
        description:'Confirmar uma demonstração local. Não altera arquivos nem controla o computador.',
        state:'pending', expiresAt:now()+ttl};
      pending.set(item.id,item); return snapshot(item);
    },
    list(owner) { return [...pending.values()].filter(i=>i.owner===owner).map(i=>snapshot(get(i.id,owner))); },
    decide(id, owner, decision) {
      const item=get(id,owner);
      if(item.state!=='pending') throw new Error('NOT_PENDING');
      if(!['approve','reject'].includes(decision)) throw new Error('INVALID_DECISION');
      item.state=decision==='approve'?'completed':'rejected';
      return snapshot(item);
    },
    clear(owner) { for(const [id,item] of pending) if(item.owner===owner) pending.delete(id); }
  };
}
