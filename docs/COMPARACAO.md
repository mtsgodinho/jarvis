# Comparação dos projetos enviados
Análise de código, sem instalar SDKs ou usar contas reais. Não constitui auditoria completa de dependências.

| Aspecto | Voice Butler | Jarvis com interface holográfica | Decisão |
|---|---|---|---|
| IA | Gemini/LiveKit | Claude SDK ou API direta | Preparar adaptadores Gemini e LiveKit no backend |
| Interface | Next/React, visualizadores de áudio | React/Vite, cena 3D, gestos, HUD | Painel próprio leve neste esqueleto; 3D opcional depois |
| Navegador | Chromium separado | Integração com Chrome do usuário | Futuro navegador separado |
| Segurança | Confirmação emitida pelo modelo e filtro inglês | Bloqueio de origens, rede e modo de leitura | Política nova, negando ações desconhecidas |
| Segredos | Variáveis no servidor | Modo direto usa VITE_ e dangerouslyAllowBrowser | Nunca colocar chaves no frontend |
| Ações locais | Limitadas ao navegador | Claude/MCP, cwd na pasta pessoal, opção ampla de escrita | Executor local com lista de ações |

## Aproveitamento concreto
Do segundo: net.mjs e oneEuro.ts preservados em vendor com licença e origem. Estão isolados; apenas os testes importam net.mjs.
Do primeiro: desenho modular de voz, agente e ferramentas reaproveitado conceitualmente. Não copiamos o backend Python: o ZIP não apresenta licença específica para esse código; a licença do frontend não foi presumida como válida para todo o projeto.
O painel e o núcleo são novos. Isso evita trazer dependências e permissões dos projetos inteiros para um esqueleto.

## Riscos do segundo projeto
O modo direto importa chaves VITE_ no cliente e usa dangerouslyAllowBrowser. A bridge define cwd=homedir(), descobre MCPs globais e possui JARVIS_ALLOW_WRITES. A política depende do encaminhamento do SDK; o próprio código comenta que certas ações podem não passar pelo callback. Bloqueio por Origin é útil, mas não equivale a autenticação do proprietário. Há boas medidas de rede com validação DNS e redirects; precisam de revisão antes do reaproveitamento operacional.
Não afirmamos ausência de malware, vulnerabilidades nos pacotes ou bypasses de permissões. Bibliotecas de câmera, gestos, 3D e áudio foram deixadas fora para reduzir complexidade inicial.
