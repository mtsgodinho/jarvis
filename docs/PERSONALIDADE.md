# Identidade e personalidade do Jarvis

`packages/providers/personality.mjs` define a identidade estável: Jarvis é o assistente; Mateus é o operador principal e seu criador. Nomes hipotéticos mencionados na conversa não mudam essas identidades. Para uma mudança real, altere a configuração exportada e revise as instruções e testes correspondentes.

`packages/providers/system-instructions.mjs` compõe um único prompt compartilhado: regras técnicas e contrato JSON, execução verdadeira, identidade/persona e regras de prioridade. A persona orienta português brasileiro natural, competência, calma, elegância, concisão, humor seco ocasional e sobriedade quando necessário. Não contém falas dos filmes nem acrescenta comandos ao catálogo.

O roteador existente usa esse prompt, acrescenta os fatos permanentes e envia o histórico temporário nos papéis originais, seguido da mensagem atual. Gemini e os fallbacks recebem a mesma identidade. Há uma cópia da persona no prompt de cada requisição, não uma cópia em cada mensagem histórica. A API continua recebendo suas instruções a cada requisição, como antes.

## Verdade sobre execução

O modelo deve retornar uma intenção `action` quando houver comando executável. O backend continua responsável por validar, executar e interpretar o resultado. A persona não substitui verificações de execução.

`packages/core/action-reply.mjs` protege somente a confirmação textual após execução, nos três caminhos existentes: comandos locais/contextuais, ações resolvidas pela memória e ações propostas pela IA. Resultado de falha não gera confirmação de sucesso. Um resultado `ok: true` só permite a confirmação original quando `verified: true` e o status, se presente, é `completed`. Sem evidência suficiente, a resposta informa que a solicitação foi feita, mas sua conclusão não foi confirmada. Mensagens otimistas do executor são ignoradas nesses casos.

Abrir um processo não comprova que uma página carregou ou uma pesquisa ocorreu. Como o executor atual do navegador retorna `launched` e `verified: false`, Jarvis informa essa incerteza mesmo quando a página de fato abre. A automação e seus mecanismos de verificação permanecem os mesmos; esta etapa não corrige a pesquisa do YouTube nem acrescenta inspeção de abas.

## Validação e limites

Execute `node --test tests/personality.test.mjs tests/chat.test.mjs tests/ai-router.test.mjs tests/memory.test.mjs tests/conversation-context.test.mjs` para as verificações focadas e `npm.cmd test` para toda a suíte no PowerShell.

Os sete testes novos verificam identidade e separação do operador, personalidade e prioridades, prompt comum no fallback, hipótese Jarbas com contexto e persistência após limpeza/logout/reinício, respostas sem confirmação ou com falha, busca contextual e ações vindas da IA/memória. Mocks de sucesso em `tests/chat.test.mjs` agora declaram explicitamente `completed` e `verified: true`; as expectativas e o roteamento existentes são mantidos.

Os testes usam provedores simulados: verificam instruções e integração, não garantem o comportamento semântico de um modelo real. Instruções de personalidade reduzem desvios, mas não eliminam alucinações. A proteção textual é determinística para resultados de execução; uma resposta livre incorreta do modelo ainda depende de sua adesão ao prompt. Não se adicionou um filtro heurístico que pudesse bloquear conversas legítimas.

Memória persistente, contexto temporário, modelos, fallback, automação, STT e TTS não foram modificados por esta etapa. A identidade não é gravada como lembrança nem inserida no histórico como mensagem.

## Testes manuais por voz

- `Jarvis, qual é seu nome, quem sou eu e quem desenvolveu você?` — deve distinguir Jarvis de Mateus e reconhecer Mateus como criador.
- `E se eu te chamar de Jarbas?` e depois `Tá bom.` — deve continuar Jarvis; não deve chamar o usuário de Jarbas.
- `Jarvis, meu computador parece ter decidido tirar férias.` — pode brincar com discrição, sem sarcasmo agressivo ou bordões.
- `Agora falando sério: preciso organizar minhas prioridades.` — deve mudar para um tom sóbrio e objetivo.
- `Jarvis, abra o YouTube.` e `Agora pesquisa por Pink Floyd.` — deve tentar as ações pelo fluxo existente e reconhecer ausência de confirmação, em vez de afirmar sucesso.
- Limpe a conversa ou reinicie; pergunte novamente seu nome e consulte um fato permanente já salvo — a identidade e o fato permanecem, mas o histórico temporário desaparece.
