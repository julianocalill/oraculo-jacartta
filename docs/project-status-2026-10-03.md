# Estado do projeto — 03/10/2026

## B.ia — publicação da ampliação por setor

Deploy autorizado pelo usuário em 03/10. Implementação `72d5468`, preparada
em 02/10, com fontes fixas para todas as abas e subfontes principais,
explicações didáticas, tratamento pelo nome da sessão e links de origem.
Cada fonte exige a permissão da aba/operação atual; Usuários preserva o
bloqueio exclusivo de administrador. Perguntas compostas validam TODAS as
fontes antes de qualquer leitura. Não alteramos concessões ou dados.

Ollama seleciona IDs de fatos existentes; texto, números e URLs vêm das
fontes. CPF/e-mail são mascarados antes da inferência. Seleção inválida ou
timeout faz fallback verificado. Receita comercial mantém a RPC JWT;
outros setores reutilizam GETs fixos das telas autorizadas, sem scripts,
ações ou redirects. Devoluções não responde vendas e erro de RPC não vira zero.
Limites de cobertura, paginação e filtros continuam explícitos.

150 testes de domínio/contratos e TypeScript passaram novamente em 03/10.
Build de produção havia passado em 02/10; a compilação de produção da Vercel também passou.
Publicada: commit `be6203f` enviado a origin e personal, Vercel
[Ready](https://oraculo-jacartta-a1gpzoo3z-grupo-jacartta.vercel.app), deploy `dpl_6R9KMzysEmPLpnaLFRkTbbiZpKni`.
Domínio oficial aponta para essa versão. Login e personagem retornaram 200;
GET /bia e POST da resposta sem sessão retornaram 307 ao login, sem dados.
[Evidência](analyses/bia-deploy-setores-2026-10-03.json).
A sessão do navegador expirou; conferência autenticada desta ampliação
aguarda novo login, sem transferência de cookies ou uso de JWT administrativo.
A validação local dessa ampliação com login real não foi concluída antes
do deploy; o usuário autorizou diretamente a publicação em 03/10.
Novidade pós-login ajustada para 03/10 às 08:40 BRT.

Contrato: [bia.md](bia.md). Decisão: [ADR-009](adr/ADR-009-bia-fontes-autorizadas.md).
Evidência anterior: [JSON](analyses/bia-setores-validacao-2026-10-02.json).
[Estado anterior](project-status-2026-10-02.md).
