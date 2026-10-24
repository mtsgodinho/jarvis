Origem: jarvis-main(1).zip enviado pelo usuário, commit do ZIP 1c4016afdf86f7043efc6882ceffef84ad0d8783. Copyright 2026 Aditya Dewaskar, licença MIT preservada.
net.mjs: módulo original de rede, mantido isolado para revisão e adaptação. Testado apenas para bloqueios básicos, sem requisições externas. Não conectado ao painel nem a navegador.
oneEuro.ts: filtro original para suavização de gestos, reservado para fase posterior; não compilado nem importado pelo esqueleto.
Nenhuma chave, bridge original, áudio ou integração Claude foi copiada.
Antes de ativar net.mjs: bloquear credenciais embutidas, restringir portas/domínios, rever faixas especiais IPv4/IPv6, fixar limite total de tempo, testar DNS e redirecionamentos. Não chamar requestOnce/openRemote diretamente sem validação. Não é barreira completa para Chromium.
