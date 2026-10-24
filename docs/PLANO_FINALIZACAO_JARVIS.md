# Finalização do Jarvis Tech View

## Estado geral

**Parcialmente pronto para uso diário.** Implementações e testes locais concluídos nesta entrega; validação física de Windows/áudio e integrações externas permanece pendente. Não se afirma operação real de hardware ou contas a partir de fixtures.

Checkout real: `/workspace/jarvis`, branch `main`. Antes das alterações, Git estava limpo e os **176 testes de referência passaram**. Node.js 24.19.0, npm 11.9.0. Dependências restauradas pelo lockfile; manifest e lockfile da aplicação permaneceram inalterados.

Endereço padrão confirmado por HTTP: `http://127.0.0.1:8787`. Launcher existente: `scripts/iniciar-windows.cmd`. O caminho histórico `C:\Users\mateus\Desktop\jarvis-mateus` não existe nesta máquina Linux e deve ser confirmado no PC. Nenhum worktree foi criado.

`runtime/data/resident-voice-diagnostics.json` estava ausente na inspeção inicial. Nenhum dado pessoal foi removido; o mecanismo de diagnóstico foi preservado.

## Fases e evidências

| Fase | Trabalho realizado | Evidência / pendência |
|---|---|---|
| 1 — referência | Git, arquitetura, dependências, serviços e suíte inspecionados | 176/176 testes antes das alterações |
| 2 — voz | Transporte JSON clonado antes do despacho Windows; descarte de baixa confiança/eco; proteção de gerações stop/start; estado de fala correto; limite de texto; prazo de build; encerramento por EOF; cancelamento de playback durante shutdown; validação finita de configurações; expiração de wake word do navegador; timeout de TTS | Testes de regressão aprovados e build Windows x64; microfone/TTS/eco físico pendentes. Voz pt-BR masculina preferida, corrigindo confusão female/male. Interrupção por voz durante TTS não habilitada em half-duplex |
| 3 — IA e ferramentas | Roteador e fallback preservados; propostas reais vinculadas a ação/argumentos/sessão; aprovação autenticada, expiração, recusa, uso único, cancelamento e resultado honesto | Intenções locais e de IA testadas com provedores injetados. Conversa real depende de credenciais. Pedidos compostos pedem esclarecimento; sem executor genérico de sequências |
| 4 — computador | Catálogo Windows ampliado para listar apps, foco, minimizar/maximizar, solicitar fechamento, controles por acessibilidade, atalhos fixos, reiniciar/desligar Windows; arquivos com raiz explícita, listagem, leitura, criação exclusiva, organização e abertura | Contratos e scripts testados com processo injetado. Arquivos exercitados em filesystem temporário real. Execução Windows/associações de documentos pendente |
| 5 — música | Tentativa YouTube e controles existentes preservados; Spotify oficial com dispositivo/escopos e confirmação por estado de reprodução; integração da música favorita com provedor selecionado | Testes de YouTube e Spotify aprovados. Reprodução audível real pendente; autoplay pode ser bloqueado. Spotify requer conta compatível e token válido; sem renovação automática |
| 6 — memória | Persistência e contexto preservados; CRUD autenticado no painel, com validação de dados existente | Suíte de memória e fluxo Chromium passaram. Testes usam temporários, sem alterar memória pessoal |
| 7 — pesquisa | Open-Meteo, feed G1 e Wikipédia com fontes, datas, timeouts, limites e destinos fixos | Fixtures aprovadas. Consulta real bloqueada por política de rede da nuvem; adições salvas no rascunho. Não há navegador automatizado genérico isolado |
| 8 — painel | Ferramentas autorizadas, aprovações reais, memória, diagnóstico, indicador de conexão derivado do estado, provedores rotulados como configurados; placeholders futuros ocultos | Chromium desktop/móvel: login, CRUD, aprovar/criar/ler arquivo real temporário, diagnósticos e logout, sem erros JS |
| 9 — estabilidade | Supervisor/restart existentes preservados; preflight inclui novo asset; shutdown de voz revisado; opção de autostart por atalho explicitamente opt-in, sem sobrescrever atalhos | Testes de supervisor e restart HTTP passaram. Atalho Windows/encerramento físico de helper ainda exigem PC |
| 10 — qualidade | Contratos restritos, captura limitada de stdout, argumentos codificados, ausência de session ID nas propostas, credenciais fora de subprocessos de ferramentas | Sintaxe de 68 arquivos válida; auditoria npm: zero vulnerabilidades conhecidas reportadas |
| 11 — testes | Referência, regressão, novas unidades/HTTP, Chromium e compilação Windows | 203/203 testes, zero falhas, cancelamentos ou ignorados; 1 fluxo Chromium adicional aprovado; build Windows x64 zero erros/avisos |
| 12 — uso diário | Guia pt-BR, exemplo de configuração, limitações e roteiro de verificação no PC | `GUIA_USO_JARVIS.md`, `.env.example`, README e docs atualizados |
| 13 — aceite | Critérios classificados abaixo | Aceite físico/externo pendente |
| 14 — entrega | Relatório com arquivos, evidências e instruções | `RELATORIO_ENTREGA.md` |

## Critérios de aceite

| Critério | Estado observado |
|---|---|
| Inicia corretamente no Windows | Código/launcher e build verificados; início no PC pendente |
| Painel e estado real | Aprovado em Chromium local; indicadores de conexão derivados do estado, provedores apenas rotulados como configurados |
| Gemini/outro responde | Roteamento/fallback automatizados aprovados; chamada real sem credencial pendente |
| Conversação contextualizada | Suíte existente aprovada; conversa real com modelo pendente |
| Memória persistente | Aprovada em testes de arquivos reais temporários e CRUD no navegador |
| Aplicativos, janelas e volume | Contratos/executor com adaptadores testados; Windows real pendente |
| Reconhecimento, TTS e residente | Máquinas de estado e lifecycle testados, helper compilado; áudio físico pendente |
| Reprodução musical | Solicitação/validação de estado automatizadas; som real e contas pendentes |
| Ferramentas autorizadas | Aprovação autenticada de uso único, sessão, argumentos, recusa, expiração e cancelamento testados |
| Reinicialização | Supervisor e retomada HTTP aprovados em Node; launcher/voz após reinício no Windows pendentes |
| Diagnóstico de falhas | Persistência/redação e acesso autenticado aprovados; falhas físicas específicas dependem de PC |
| Testes e regressões | 203 aprovados, nenhuma regressão crítica conhecida nos fluxos exercitados |
| Documentação/dependências | Guias e configuração de exemplo entregues; .NET SDK 10 e pacotes de idioma indicados |

## Configuração da nuvem e bloqueios externos

Rascunho do ambiente confirmado como salvo, sem publicação por este trabalho:

- `start_skill` atualizado com inicialização, compilação, teste opcional Chromium e limites de validação.
- Domínios adicionados: `pt.wikipedia.org`, `geocoding-api.open-meteo.com`, `api.open-meteo.com`, `g1.globo.com`, `www.youtube.com`, `api.spotify.com` e `generativelanguage.googleapis.com` (este último pela exigência do segredo Google).
- Requisito seguro `GOOGLE_API_KEY` e variável `GOOGLE_MODEL` declarados após confirmar ausência de bindings/variáveis. **Nenhum valor secreto foi fornecido ou salvo pelo agente.**
- Para ativar, o usuário precisa revisar/salvar as configurações e publicar o ambiente pela interface quando desejar. Salvar rascunho não altera a política já em execução nem configura o Windows pessoal.
- Gemini/OpenRouter/Spotify e raiz de arquivos estavam ausentes no processo. As integrações opcionais que não estão configuradas falham de forma explícita; o diretório de arquivos nunca cai automaticamente na pasta pessoal.

Consultas reais de pesquisa falharam por conectividade; via proxy, o destino Open-Meteo recebeu negação de túnel HTTP 403. O Node nesta nuvem precisa usar o proxy/certificado injetados para destinos externos; a opção nativa de Node 24 é `NODE_USE_ENV_PROXY=1`. Não houve desativação de TLS ou verificação de integridade. Nova política ainda não foi aplicada/testada.

## Ferramentas de validação locais

SDK .NET 10.0.402 instalado **somente em `/workspace/.dotnet`**, a partir de `builds.dotnet.microsoft.com`, com SHA-512 confrontado com o metadado oficial. `DOTNET_CLI_HOME` e `NUGET_PACKAGES` apontam para diretórios do workspace. O primeiro build exigiu execução fora do sandbox para criar o mutex NuGet-Migrations; a revisão automática autorizou essa execução. Não houve instalação global nem alteração manual de trust/TLS.

Comando de build validado:

```bash
DOTNET_CLI_HOME=/workspace/.dotnet-home NUGET_PACKAGES=/workspace/.nuget \
DOTNET_CLI_TELEMETRY_OPTOUT=1 /workspace/.dotnet/dotnet build \
packages/resident-voice/windows/Jarvis.Voice.Windows.csproj \
--configuration Release --runtime win-x64 --self-contained false \
-p:EnableWindowsTargeting=true -maxcpucount:2
```

Teste opcional do painel (não faz parte dos 203 testes Node):

```bash
npm install --prefix /workspace/jarvis-validation --package-lock=false playwright-core@1.56.1
JARVIS_PLAYWRIGHT_MODULE=/workspace/jarvis-validation/node_modules/playwright-core \
node tests/panel-browser.mjs
```

Chromium já disponível em `/usr/bin/chromium`; para outra instalação, use `CHROMIUM_PATH`. Esse teste usa backend e arquivos temporários reais, sem executar desktop Windows, microfone ou contas externas.

## Última validação da aplicação

`npm start` foi iniciado com o código atualizado. O teste funcional HTTP passou em saúde, assets, login, sessão/CSRF, status, diagnósticos, leitura da memória, proposta pendente sem execução, recusa e logout. O código de acesso não foi impresso pelo teste. O servidor permanece somente em loopback.

A suíte completa terminou com 203 aprovados, zero reprovados, zero cancelados e zero ignorados. A auditoria npm reportou zero vulnerabilidades conhecidas; isso não equivale a auditoria de segurança completa. Alterações de argumentos do `.NET`/PowerShell foram inspecionadas e compiladas/testadas onde suportado; automação física continua pendente.

## Entrega pelo GitHub

Após dificuldade de download do arquivo local, o usuário autorizou explicitamente criar commit e enviar o código à branch `entrega/jarvis-tech-view`. Essa autorização não inclui merge em `main`, deploy da aplicação ou publicação do ambiente.
