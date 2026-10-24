# Jarvis Tech View

Assistente pessoal local para Windows: painel web autenticado, conversa por IA, memória persistente, voz e ferramentas com aprovação explícita.

Requer Node.js 22 ou superior. Instale com `npm ci`, valide com `npm test` e inicie no Windows com `scripts\iniciar-windows.cmd`. Para voz residente, requer também .NET SDK 10 e reconhecimento/voz pt-BR do Windows.

- [Guia de uso e configuração](docs/GUIA_USO_JARVIS.md)
- [Estado da entrega, evidências e pendências](docs/PLANO_FINALIZACAO_JARVIS.md)
- [Arquitetura](docs/ARQUITETURA.md)
- [Segurança](docs/SEGURANCA.md)

A validação automatizada e a compilação não substituem testes físicos de áudio, automação Windows, provedores e reprodução musical. Consulte as pendências antes de considerar a versão pronta para uso diário. O servidor deve permanecer somente em loopback, sem túneis ou exposição pública.
