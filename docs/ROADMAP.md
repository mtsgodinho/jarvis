# Ordem de implementação
- [x] Pastas, contratos, painel local e bloqueio padrão.
- [x] Comparação e separação dos módulos reaproveitáveis.
- [x] Sessões autenticadas e aprovação demonstrativa no painel.
- [x] Propostas reais vinculadas à sessão e aos argumentos, com aprovação de uso único no despacho do executor (testes automatizados; Windows real pendente).
- [x] Conversa por texto com Gemini e gestão de erros/cotas, sem ferramentas.
- [x] Voz básica em português pelo navegador: acionamento explícito, reconhecimento e síntese opcionais.
- [ ] Robustez adicional para permissões, indisponibilidade e cancelamento/reconexão de voz.
- [ ] Browser somente leitura com isolamento e testes de saída de rede.
- [x] Executor Windows allowlisted: apps, pastas, sites, buscas e controles predefinidos de volume/mídia.
- [x] Arquivos em raiz explícita: listagem, leitura, criação exclusiva, organização sem sobrescrita e abertura de documentos; testes de filesystem aprovados, abertura Windows pendente.
- [x] Memória local por comandos explícitos de ensino, consulta, atualização e exclusão.
- [ ] Ações de escrita com aprovação, auditoria e desfazer quando possível.
- [ ] Integrações da operação TechView, uma a uma.
O reconhecimento de voz depende das APIs e permissões do navegador; o adaptador LiveKit permanece desativado. As aprovações reais de ferramentas estão integradas; a demonstração antiga continua separada e identificada. O esqueleto não garante custos zero de provedores. Serviço de Windows roda no PC; publicar um painel não instala o executor no computador.

Para o estado atualizado, critérios de aceitação e limitações, consulte `PLANO_FINALIZACAO_JARVIS.md` e `GUIA_USO_JARVIS.md`. Itens de código implementados não indicam validação física de Windows/áudio ou contas externas.
