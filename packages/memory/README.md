Memória persistente local do Jarvis, armazenada em `runtime/data/memory.json` pelo backend. Conversas completas permanecem apenas no histórico temporário da sessão. O arquivo usa gravação atômica, serializa alterações concorrentes e filtra credenciais e outros segredos óbvios tanto nos rótulos quanto nos valores. O frontend não acessa o arquivo diretamente.

Além das músicas e do time já suportados, fatos pessoais nomeados usam chaves `user:` no mesmo formato JSON versão 1, preservando os dados existentes. Para ensinar novos fatos, use um pedido explícito:

- `lembra que meu projeto atual é Jarvis`
- `lembre que minha linguagem preferida é JavaScript`
- `lembra que prefiro respostas curtas` (salva em `preferencias`)
- `qual é meu projeto atual?`
- `o que você lembra sobre minhas preferências?`
- `atualiza meu projeto atual para Assistente`
- `esquece meu projeto atual`

Rótulos são normalizados sem acentos, com até 80 caracteres; valores têm até 240 caracteres. Há um limite de 50 fatos pessoais, além das categorias originais. Uma nova preferência no campo `preferencias` substitui a anterior; use campos nomeados para preferências independentes. Não há extração automática por IA nem gravação de declarações pessoais genéricas sem pedido explícito.

Os fatos pessoais são enviados como contexto aos provedores configurados em conversas que precisam de IA; música e time mantêm o filtro de relevância existente. Fatos são dados, não instruções de sistema ou autorização para executar ações. Comandos locais reconhecidos têm prioridade e não precisam acessar a memória ou chamar IA. Falhas de armazenamento não impedem esses comandos ou conversas sem memória; pedidos para salvar ou consultar informam a falha.

Limpar a conversa, sair e reiniciar não apagam fatos persistidos. A memória é compartilhada pelas sessões locais deste Jarvis, destinada ao mesmo usuário do Windows, e suporta um processo de servidor por arquivo. O JSON fica em texto simples e não deve guardar segredos. Arquivos ausentes são criados; arquivos inválidos são tratados como memória vazia e substituídos na próxima gravação válida.

Teste automatizado: `node --test tests/memory.test.mjs tests/chat.test.mjs`. A suíte usa arquivos temporários e não altera sua memória real.
