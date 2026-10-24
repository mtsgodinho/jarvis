# Ordem de implementação
- [x] Pastas, contratos, painel local e bloqueio padrão.
- [x] Comparação e separação dos módulos reaproveitáveis.
- [x] Sessões autenticadas e aprovação demonstrativa no painel.
- [ ] Aprovações humanas vinculadas a ações reais e verificadas pelo executor.
- [x] Conversa por texto com Gemini e gestão de erros/cotas, sem ferramentas.
- [x] Voz básica em português pelo navegador: acionamento explícito, reconhecimento e síntese opcionais.
- [ ] Robustez adicional para permissões, indisponibilidade e cancelamento/reconexão de voz.
- [ ] Browser somente leitura com isolamento e testes de saída de rede.
- [x] Executor Windows allowlisted: apps, pastas, sites, buscas e controles predefinidos de volume/mídia.
- [ ] Arquivos em diretório escolhido pelo usuário, leitura primeiro.
- [x] Memória local por comandos explícitos de ensino, consulta, atualização e exclusão.
- [ ] Ações de escrita com aprovação, auditoria e desfazer quando possível.
- [ ] Integrações da operação TechView, uma a uma.
O reconhecimento de voz depende das APIs e permissões do navegador; o adaptador LiveKit permanece desativado. As aprovações atuais são demonstrações, não uma etapa de autorização do executor Windows. O esqueleto não garante custos zero de provedores. Serviço de Windows roda no PC; publicar um painel não instala o executor no computador.
