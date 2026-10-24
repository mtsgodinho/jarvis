Ferramentas de arquivos em raiz explicitamente autorizada por `JARVIS_FILES_ROOT`, sem fallback para a pasta pessoal. Contratos: `files_list`, `files_read`, `files_create`, `files_move`, `files_open`. Toda chamada do painel/chat passa por aprovação de uso único.

Caminhos relativos, extensões limitadas, sem segredos/diretórios ocultos, travessia, nomes reservados Windows ou symlinks. Leitura/movimentação recusam múltiplos hard links. Criação não sobrescreve; movimentação usa link exclusivo antes de remover a origem. Pastas de destino precisam existir. Não há exclusão genérica nem sandbox contra outro processo local hostil que altere diretórios simultaneamente.

Veja `docs/GUIA_USO_JARVIS.md` para limites e configuração.
