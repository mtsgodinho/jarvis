// Contrato futuro: aprovação vem de UI autenticada, nunca de ferramenta do modelo.
// Sem transporte autenticado, é obrigatório falhar fechado.
export function consumeApproval() {
  throw new Error('APPROVAL_NOT_IMPLEMENTED: integração permanece bloqueada');
}
