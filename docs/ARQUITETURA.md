# Arquitetura pretendida
Painel → sessão autenticada → orquestrador → proposta tipada → política → aprovação humana quando exigida → executor específico → resultado verificável.

Implementado: painel local com sessão autenticada e CSRF, aprovações reais de ações, demonstração separada, status, conversa com Gemini e ferramentas locais allowlisted no Windows. As propostas reais agora exigem decisão autenticada antes do despacho. Chrome e perfis conhecidos são interpretados localmente. Para outras ferramentas, o provedor de IA produz um envelope JSON de resposta ou intenção; o servidor valida ação e parâmetros contra `packages/contracts/local-actions.mjs` e o executor revalida antes de iniciar processos.
Reservado: um navegador automatizado genérico isolado e integrações externas além do catálogo explícito.
Gemini não recebe função de execução nem caminhos/comandos. O executor aceita somente aplicativos, pastas, sites, buscas e teclas multimídia predefinidos; processos usam `spawn` com `shell: false`. A camada administrativa de reiniciar/desligar permanece separada.
A versão inicial usa JavaScript ESM/Node e frontend estático. Gemini, pelo SDK oficial `@google/genai`, é o provedor principal; OpenRouter é a alternativa seguinte e OpenAI é opcional, somente quando habilitada. Todas as credenciais vêm do `.env` no backend e nunca chegam ao navegador. O reconhecimento contínuo por “Jarvis” e a síntese usam APIs do navegador; somente a transcrição após a ativação usa a rota de chat existente. oneEuro.ts é referência TypeScript não compilada; voz LiveKit continua desligada.
Módulo de rede reaproveitado é independente dos futuros controles de navegador. Não confundir bloqueio de HTTP Node com sandbox de navegador ou isolamento do sistema operacional.

## Fluxo atual de ferramentas com aprovação

A conversa local, intenções da IA e pedidos do formulário de ferramentas produzem propostas canônicas no backend. Nenhuma delas executa automaticamente no fluxo padrão. `/api/decision` exige sessão, origem e CSRF; recebe somente ID e decisão, consome a proposta uma vez e revalida o contrato antes de chamar o executor. Recusa, expiração, logout, limpeza de conversa e encerramento invalidam a autorização. As aprovações demonstrativas antigas permanecem identificadas como demonstração e não autorizam ferramentas reais.

`packages/security/action-approval.mjs` mantém as propostas por sessão. `packages/desktop/windows-control.mjs` limita processos, operações de janela, controles acessíveis e atalhos. Dados do usuário são codificados em JSON/base64, nunca concatenados como instruções PowerShell. Energia Windows exige a mesma aprovação explícita. O parâmetro programático `requireActionApproval:false` é usado apenas pelos testes de execução imediata preexistentes; não há rota, variável de ambiente ou opção do painel que desligue aprovação.

`packages/files/index.mjs` exige raiz explícita (`JARVIS_FILES_ROOT`), caminhos relativos, extensões e tamanhos limitados, criação exclusiva e organização sem sobrescrita. Não é um sandbox de sistema operacional contra modificações concorrentes por processos locais hostis.

`packages/research/index.mjs` consulta um catálogo fechado de fontes HTTPS com timeouts, respostas limitadas e redirecionamentos bloqueados. Retorna fontes e horários sem encaminhar páginas como instruções de execução. Não oferece navegador automatizado genérico. `packages/providers/spotify.mjs` usa apenas a API oficial e verifica o estado de reprodução antes de confirmar sucesso.

O painel inclui gestão de memória, diagnóstico autenticado e formulários de ferramentas. Campos e resultados são renderizados como texto. As seções futuras sem implementação ficam ocultas. Consulte o plano de finalização para distinguir testes automatizados de execução física.
