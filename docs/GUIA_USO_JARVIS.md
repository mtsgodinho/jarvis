# Jarvis Tech View — guia de uso

## Estado da entrega

A aplicação e as integrações locais foram desenvolvidas e testadas nesta máquina Linux. O painel foi exercitado em Chromium, e o helper de voz foi compilado para Windows. **O uso diário no Windows ainda depende da validação no computador, do microfone e das contas conectadas.** Compilar o helper ou testar um adaptador com respostas simuladas não comprova funcionamento de hardware.

O usuário autorizou a entrega do código pela branch `entrega/jarvis-tech-view`. Não houve deploy da aplicação. A preparação do ambiente de desenvolvimento não instala o executor no seu PC.

## Instalação no Windows

1. Use o checkout atualizado do projeto no PC. O caminho histórico é `C:\Users\mateus\Desktop\jarvis-mateus`; confirme onde ele está atualmente.
2. Instale Node.js 22 ou superior por um instalador oficial, se ainda não estiver instalado.
3. No terminal da pasta do projeto, execute `npm ci`.
4. Para voz residente, instale o **.NET SDK 10**, habilite português brasileiro nas configurações de fala do Windows e disponibilize uma voz pt-BR. Essas instalações não são feitas automaticamente pelo Jarvis.
5. Copie `.env.example` para `.env`, preservando um `.env` já existente. Edite somente o que precisar. Nunca compartilhe esse arquivo ou chaves de acesso.
6. Execute `scripts\iniciar-windows.cmd`. O launcher verifica dependências e mostra endereço e código de acesso. Abra o endereço mostrado, normalmente `http://127.0.0.1:8787`, e informe o código no painel.

Não exponha essa porta à internet, não crie túneis e não use perfis de navegador compartilhados para a sessão local. O código de pareamento muda ao fechar e abrir o launcher e não deve aparecer em relatórios ou capturas.

## Configurar inteligência artificial

- **Gemini (prioritário):** `GOOGLE_API_KEY` e `GOOGLE_MODEL`. Escolha um modelo disponível na sua conta no console do provedor; não presuma que um nome de modelo antigo continua disponível.
- **OpenRouter (alternativa):** `OPENROUTER_API_KEY` e, se necessário, `OPENROUTER_MODEL`.
- **OpenAI (opcional):** `OPENAI_ENABLED=true`, `OPENAI_API_KEY` e, se necessário, `OPENAI_MODEL`.

Reinicie o Jarvis após alterar o `.env`. O indicador “configurado” significa que os campos estão presentes; uma conversa real é necessária para confirmar autenticação e disponibilidade. O roteamento e o fallback existentes foram preservados. Cotas, modelos indisponíveis, credenciais recusadas e indisponibilidade podem produzir mensagens de erro.

Não é preciso configurar IA para comandos locais reconhecidos, memória, painel, previsões e manchetes. Linguagem natural fora dos padrões locais depende do provedor. Pedidos compostos que não cabem em uma ferramenta exigem esclarecimento; o Jarvis não executa comandos livres ou sequências inventadas pelo modelo.

## Conversa e aprovação de ações

Exemplos: “Jarvis, abre o Chrome”, “abre o bloco de notas”, “volume em 30%”, “minimiza o Chrome”, “reinicie o Windows”.

Toda ação de ferramenta no fluxo normal cria uma proposta com **ação e argumentos fixos**. Abra **Aprovações de ações**, confira o pedido e escolha aprovar ou recusar. O pedido expira em 60 segundos, pertence à sessão que o criou e não pode ser aprovado duas vezes. Uma frase “já aprovei” no chat não substitui esse botão.

A aprovação é consumida antes de despachar a ferramenta. Falha, timeout ou cancelamento não permitem repetir a mesma autorização: crie uma nova proposta depois de conferir o que ocorreu. Limpar a conversa ou sair invalida pedidos pendentes. O botão de cancelar interrompe operações em curso quando o adaptador permite; não desfaz uma ação que o Windows já tenha realizado.

Um processo iniciado não comprova uma janela aberta, uma música tocando ou uma tecla aplicada. O Jarvis informa quando apenas solicitou uma ação. Os pedidos para fechar aplicativos não usam encerramento forçado; podem abrir uma pergunta de salvamento do próprio aplicativo. Reiniciar/desligar Windows exige aprovação explícita e pode encerrar trabalhos: salve-os antes.

Em **Ferramentas autorizadas**, é possível propor operações sem configurar IA. Há listagem de aplicativos, foco/minimização/maximização, fechamento, atalhos e controles de interface. As ferramentas recusam janelas ou controles ambíguos. Preenchimento exige controle acessível por nome exato, editável e não marcado como senha. Não há cliques por coordenadas, shell genérico ou digitação indiscriminada. Alguns aplicativos não expõem os padrões de acessibilidade necessários; nesses casos a ação falha de forma controlada. Não interaja simultaneamente com o teclado durante uma automação aprovada.

## Microfone, escuta e respostas faladas

- **Navegador:** clique em “Ativar Jarvis”, autorize o microfone e diga “Jarvis” seguido do pedido. A janela de espera pelo comando expira após silêncio. “Falar uma frase” permite ditado pontual.
- **Residente Windows:** configure primeiro o microfone padrão do Windows (Configurações → Sistema → Som → Entrada). O helper usa esse dispositivo; não há seleção de dispositivo independente dentro do Jarvis. Ative “Configurar escuta residente” no painel e confirme o consentimento solicitado.
- Uma configuração residente habilitada é consentimento persistente: a escuta pode voltar nos próximos inícios. Para revogá-la, desative no painel ou no ícone da bandeja. Sair da sessão vinculada interrompe e desabilita a escuta residente.
- Não ative simultaneamente os dois mecanismos. O painel previne essa combinação.
- Voz pt-BR masculina tem prioridade quando disponível. O timbre depende das vozes instaladas. A síntese usa tom ligeiramente mais grave, sem clonagem de pessoas reais. Velocidade e volume são ajustáveis.
- O reconhecimento pausa durante a resposta para reduzir eco. Há retomada ao terminar e tentativas limitadas de recuperação. Baixa confiança e mensagens de uma ativação antiga são descartadas no residente.
- “Interromper resposta falada” interrompe o TTS **do navegador**. Para o residente, desative a escuta para interromper e encerrar o helper.
- **“Jarvis, pare” durante o próprio TTS não está habilitado:** a arquitetura é half-duplex, sem canal validado de cancelamento de eco. O microfone fica suspenso enquanto o Jarvis fala.

O reconhecimento do navegador pode usar um serviço remoto do navegador. O helper Windows usa as APIs de fala do sistema; disponibilidade, pacotes de idioma e privacidade são controlados pelo Windows. Não há garantia de funcionamento totalmente offline da transcrição por ditado.

## Memória e contexto

Comandos: “lembra que meu projeto atual é Jarvis”, “qual é meu projeto atual?”, “atualiza meu projeto atual para Assistente”, “esquece meu projeto atual”.

A seção **Memória permanente** permite listar, editar, criar e esquecer informações. Para novos campos, use `user:projeto`, `user:preferencias` etc. A validação existente rejeita segredos e valores inválidos. A memória fica em `runtime/data/memory.json`, persiste entre reinícios e é compartilhada pelas sessões locais. Limpar a conversa não apaga esses fatos.

A conversa temporária é limitada e vinculada à sessão. O histórico não autoriza ações. Fatos pessoais relevantes podem ser enviados ao provedor de IA configurado. Não armazene dados confidenciais nesse JSON em texto simples.

## Arquivos e documentos

Configure `JARVIS_FILES_ROOT` com uma **pasta dedicada que você autoriza**, existente e controlada por você. Sem essa configuração, a ferramenta recusa acesso; ela não usa sua pasta pessoal automaticamente. Reinicie após configurar.

No painel, use caminhos relativos como `notas.txt` e `organizado/notas.txt`. Listagem é não recursiva, limitada a 200 entradas por pasta; navegue por subpastas para localizar arquivos. Leitura/criação aceitam `.txt`, `.md`, `.csv`, `.json` UTF-8 até 64 KiB (o formulário de texto é mais restrito). Documentos `.pdf`, `.docx`, `.xlsx`, `.pptx` podem ser abertos pelo aplicativo associado no Windows; seus conteúdos não são interpretados pelo Jarvis.

Criação não sobrescreve arquivos. Organização move um arquivo para uma pasta existente e não sobrescreve o destino. Não há exclusão recursiva ou ferramenta de apagar arquivos. Caminhos absolutos, travessia, nomes de dispositivo Windows, diretórios ocultos/de segredos e links simbólicos são recusados. Leitura e movimentação recusam arquivos com múltiplos hard links.

A proteção de caminhos é defesa da aplicação, **não um sandbox contra outro processo local malicioso que altere diretórios simultaneamente**. Não autorize pastas compartilhadas com escritores não confiáveis. Não há suporte a diretórios de sistema, executáveis, atalhos ou macros.

## Música

- YouTube: “toca Nego Drama dos Racionais MC's” tenta localizar um ID de vídeo e abrir a página de reprodução com autoplay. Se a busca não localizar um vídeo, abre resultados. Autoplay pode ser bloqueado pelo navegador; o Jarvis não afirma que tocou sem verificação. Pausar/retomar e avançar usam teclas de mídia globais, sujeitas ao aplicativo ativo; o resultado permanece não verificado.
- Spotify: “toca Nego Drama no Spotify”. Configure um token OAuth válido em `SPOTIFY_ACCESS_TOKEN`, com `user-read-playback-state` e `user-modify-playback-state` (e acesso à busca conforme a conta). Abra o cliente e deixe um dispositivo ativo. Opcionalmente selecione `SPOTIFY_DEVICE_ID`. Reprodução pela Web API geralmente exige Premium. Não há login, captura de senha, contorno de DRM ou renovação automática de token nesta versão; tokens expirados precisam ser renovados pelo fluxo oficial do usuário.
- Spotify só confirma reprodução se o estado retornado pela API mostrar o mesmo dispositivo, faixa e `is_playing=true`.
- Memória: “lembra que minha música favorita é Nego Drama”; depois “toca minha música favorita”. Padrão YouTube; `JARVIS_MUSIC_PROVIDER=spotify` seleciona Spotify para esse fluxo.

Reprodução efetiva com suas contas/dispositivos permanece pendente de teste real. Nenhuma conta externa foi acessada durante o desenvolvimento.

## Pesquisa e fontes

- “Como está o tempo em Porto Alegre?” consulta geolocalização e condições atuais do Open-Meteo, com local, horário e URLs das fontes. Confirme a cidade/estado retornado em nomes ambíguos.
- “Quais são as notícias de hoje?” consulta até cinco manchetes do feed G1, preserva a data e deixa claro que os artigos completos não foram lidos. O feed pode incluir publicações de dias anteriores.
- “Pesquisa na internet sobre inteligência artificial” consulta trechos da Wikipédia em português. É pesquisa enciclopédica limitada, não um mecanismo geral de busca nem prova de atualidade.
- Abrir Google/YouTube no navegador continua sendo uma ação distinta e exige aprovação. Um navegador automatizado isolado de uso geral não foi implementado.

Destinos necessários: `pt.wikipedia.org`, `geocoding-api.open-meteo.com`, `api.open-meteo.com`, `g1.globo.com`, `www.youtube.com` e, para Spotify, `api.spotify.com`. Fontes indisponíveis produzem erro explícito, sem preencher resultados inventados.

No ambiente em nuvem, as adições de rede foram salvas como rascunho e precisam ser aplicadas nas configurações. Salvar rascunho não aplica a política em execução. No Windows, proxy e firewall locais também podem impedir o acesso. Testes de respostas de fontes nesta entrega usam fixtures; consultas reais foram bloqueadas pela rede da nuvem.

## Inicialização automática e encerramento

Execute `scripts\configurar-inicio-windows.cmd` somente se desejar configurar início ao entrar no Windows. A opção começa desabilitada, exige uma escolha explícita e cria um atalho apenas na pasta Inicializar do seu usuário. O script não ativa o microfone. Não sobrescreve atalhos existentes e só remove um atalho cuja origem consegue confirmar. Se mover a pasta do projeto ou o Node, remova o atalho antigo antes e configure novamente.

Os botões do painel reiniciam/encerram o Jarvis, não o Windows. Reinício supervisionado tenta retomar a sessão com cookie assinado de uso único. Ctrl+C no launcher solicita encerramento coordenado. Porta ocupada gera erro; não é escolhida uma porta diferente silenciosamente. Não encerre processos desconhecidos para liberar a porta.

## Diagnósticos e falhas comuns

- **IA não configurada:** configure um provedor e reinicie; comandos locais e memória continuam disponíveis.
- **Porta 8787 ocupada:** confira outra instância e use o endereço/código do launcher correto. Feche apenas a instância que você iniciou.
- **Microfone negado:** habilite acesso ao microfone para aplicativos da área de trabalho nas configurações de privacidade do Windows; no navegador, confira as permissões do site.
- **PT_BR_RECOGNIZER_UNAVAILABLE:** instale/habilite reconhecimento pt-BR no Windows.
- **DOTNET_SDK_MISSING / VOICE_BUILD_FAILED:** confira `dotnet --version`, SDK 10 e acesso ao NuGet. Não desative TLS, assinaturas ou validações para instalar pacotes.
- **Reconhecimento instável:** confira o dispositivo padrão, ruído, idioma e outro aplicativo usando o microfone; desative e reative após corrigir a causa.
- **Arquivo recusado:** confira raiz autorizada, extensão, tamanho, caminho relativo e ausência de links. Não amplie a raiz para todo o disco como solução.
- **Spotify recusado:** confira token, escopos, plano e dispositivo ativo. A aplicação não renova tokens automaticamente.

Abra **Diagnósticos e provedores → Consultar estado real**. Falhas de voz permanecem em `runtime/data/resident-voice-diagnostics.json`, limitadas aos 20 registros mais recentes com código, etapa, tipo de exceção e HRESULT. O registro não guarda transcrições nem chaves. Arquivos de diagnóstico inválidos são preservados e sinalizados como indisponíveis.

## Verificação antes do uso diário

Execute `npm test`. Confira o relatório em `docs/PLANO_FINALIZACAO_JARVIS.md`. No PC, teste primeiro tarefas sem dados importantes:

1. Login, painel e conversa real com o provedor.
2. Salvar um fato, reiniciar e consultar o mesmo fato.
3. Abrir e minimizar um aplicativo de teste após aprovação; recusar uma proposta.
4. Ajustar volume e conferir o percentual real.
5. Ativar voz com consentimento, testar silêncio, ruído, wake word, TTS, desativação e reinício.
6. Testar música e verificar áudio real, não apenas a página aberta.
7. Testar arquivos em pasta dedicada vazia e confirmar que um arquivo existente não é sobrescrito.
8. Conferir reinício/encerramento, diagnóstico e ausência de processos órfãos.

Não teste desligamento do Windows com trabalho aberto. Até completar esses testes, classifique a entrega como **parcialmente pronta para uso diário**, com base técnica validada e validação física/externa pendente.
