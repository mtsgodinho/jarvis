# Segurança e limites
Hoje: servidor somente em 127.0.0.1:8787, Host e Origin esperados, sem CORS, rotas fixas, CSP, sessão local em cookie HttpOnly/SameSite, token CSRF em POST e limite de tentativas de login. Rotas administrativas fixas exigem sessão e CSRF; restart e shutdown aceitam somente objeto vazio. O launcher supervisiona um único servidor por vez, reinicia apenas no código de saída 75 e encerra no código 0. Não abrir porta, túnel nem publicar o servidor.
O código de acesso identifica quem tem acesso ao terminal, não uma identidade pessoal. Loopback não protege contra outros processos locais.

A chave Gemini é carregada do `.env` no backend; status e respostas da API não incluem chaves. Gemini é o provedor principal; OpenRouter é tentado como alternativa e OpenAI somente se habilitada. O histórico textual fica em memória, associado à sessão, e é apagado ao limpar a conversa, sair ou expirar. O texto e os fatos de memória relevantes são enviados ao provedor que atende à conversa. O modelo não recebe ferramentas executáveis: suas intenções estruturadas passam pela validação de ações locais permitidas no servidor.

O executor implementado abre somente aplicativos, pastas e sites predefinidos, faz buscas com consultas codificadas e controla volume/mídia por parâmetros e teclas fixos. Os processos usam `shell: false`; não há execução de comandos livres, terminal genérico, manipulação de arquivos, mouse ou controle geral do teclado. As ações locais agora criam propostas reais e exigem aprovação humana vinculada à sessão e aos argumentos; o demonstrador separado não autoriza ferramentas. O navegador automatizado genérico permanece sem implementação; arquivos têm ferramentas restritas a uma raiz autorizada, conforme descrito abaixo. A voz usa reconhecimento contínuo do navegador após ativação explícita; apenas o texto reconhecido depois de “Jarvis” é encaminhado pela rota de chat, nunca o áudio ao backend Jarvis. O próprio serviço de reconhecimento do navegador pode processar o áudio e exige conexão/permissões conforme o navegador. O painel indica quando o microfone está ativo, permite interromper a escuta e interrompe a síntese ao desativar o modo. O módulo de voz do backend/LiveKit continua desativado. O código de acesso permanece estável somente enquanto o supervisor está aberto; após reinício, o painel o reutiliza apenas em memória para autenticar uma sessão nova, com cookie e CSRF novos.

Antes de qualquer ação real:
1. Pareamento local e sessão autenticada; proteção CSRF, origem exata, expiração, limites de requisição.
2. Validação de cada payload. O JSON Schema é contrato, ainda não é um validador em execução.
3. Proposta imutável, ID aleatório, ação/destino/parâmetros vinculados à aprovação, expiração, consumo único e invalidação ao mudar o contexto. Aprovação só por UI autenticada, nunca ferramenta LLM.
4. Executor revalida no momento da execução. Parada cancela fila e processos; o botão atual é apenas demonstrativo.
5. Navegador sem perfil pessoal em processo isolado, política de saída em nível de rede. Texto de sites nunca constitui autorização.
6. Chaves no backend/cofre local. Redação de logs, consentimento para memória, câmera e tela.
7. Auditoria de dependências, versões travadas e testes adversariais antes de habilitar integrações.

## Atualização: aprovação real e novos adaptadores

As ações locais agora passam por propostas reais no fluxo padrão. Argumentos ficam fixos no servidor e não podem ser substituídos no POST de decisão. Propostas têm sessão proprietária, expiração e uso único; falha ou cancelamento exigem uma nova proposta. O demonstrador não concede permissão de execução. Aprovação humana reduz execução inadvertida; ela não transforma uma ação já iniciada em reversível.

Fechar aplicativo usa mensagem de fechamento, sem matar processos pelo nome. Windows pode pedir salvamento. Energia exige aprovação explícita e não usa desligamento forçado. Controles acessíveis recusam senhas, alvos ambíguos e campos somente leitura. Atalhos são fixos e limitados a aplicativos do catálogo; sua aplicação final não é presumida como verificada.

Leitura/criação/organização de arquivos exige pasta dedicada configurada, sem fallback para a pasta pessoal. Não há ferramenta de exclusão genérica. Não autorize pastas com escritores locais hostis; a proteção da aplicação não substitui um sandbox de filesystem.

Diagnósticos autenticados expõem somente estado e metadados allowlisted de voz, sem chaves ou transcrições. Spotify exige token OAuth oficial com escopos adequados; não captura credenciais de login nem contorna limitações do serviço. Fontes externas usam destinos fixos, TLS e limites de tamanho/tempo. Consultar fontes não habilita execução de instruções vindas delas.
