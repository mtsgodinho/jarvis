// Apenas intenções explicitamente registradas; nenhuma ferramenta executa aqui.
const capabilities = new Map([
  ['system.status', 'allow'],
  ['browser.read', 'approval'],
  ['desktop.open_app', 'approval'],
  ['files.read', 'approval'],
]);
export function decide(action) {
  if (!action || typeof action.kind !== 'string') return 'deny';
  return capabilities.get(action.kind) ?? 'deny';
}
