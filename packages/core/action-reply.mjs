export function truthfulActionReply(result, confirmedReply) {
  if (result?.status === 'pending_approval') return 'A ação aguarda sua aprovação no painel. Nada foi executado.';
  if (result?.ok !== true || ['failed', 'cancelled', 'timeout'].includes(result.status)) {
    return 'Não consegui executar a ação solicitada, Mateus.';
  }
  if (result.verified !== true || (result.status && result.status !== 'completed')) {
    return 'Solicitei a ação ao sistema, mas não consegui confirmar que ela foi concluída, Mateus.';
  }
  return confirmedReply;
}
