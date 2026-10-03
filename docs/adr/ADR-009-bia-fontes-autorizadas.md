# ADR-009: B.ia consulta telas autorizadas e seleciona fatos verificáveis

## Status

Accepted — 02/10/2026. Amplia a ADR-008. Publicada em 03/10/2026, Vercel Ready;
conferência da interface com sessão real desta ampliação aguarda novo login.

## Contexto

A B.ia deve explicar os assuntos de todos os setores sem criar um segundo
conjunto de métricas, respeitando Usuários e sem qualquer escrita. Cada tela
já possui autorização, critérios de negócio e fontes com coberturas próprias.

## Decisão

- Registro fechado em `packages/domain/bia-sources.js`: todas as abas e
  subfontes auditadas herdam a permissão da respectiva página. Não é SQL livre
  nem acesso irrestrito ao banco. Nome e papel enviados no corpo são rejeitados.
- Antes de qualquer leitura, validar B.ia, operação e TODAS as abas citadas.
  `getCurrentUser` lê identidade/permissões atuais; `canAccessRequest` mantém
  as regras de `tabs`, `restricted_tabs`, administradores e operação habilitada.
  Um segundo request da página confirma a autorização. Não mudamos concessões.
- A receita comercial mantém sua RPC JWT STABLE. As demais fontes fazem
  somente GET ao caminho fixo na mesma origem aprovada, operação e sessão.
  Sem redirects, ações, exports, execução de scripts, cache compartilhado,
  escolha de URL/RPC pelo modelo ou envio de cookies a outras origens.
- Extração de HTML limitada ao conteúdo de `main.workspace`. Ignorar nav,
  scripts/RSC, conteúdo oculto, campos sensíveis e controles de escrita.
  Ler cards, linhas, notas e filtros GET; Parâmetros também expõe valores
  numéricos configurados. Máximo 150 fatos e 30 linhas por tabela.
- As páginas preservam seus clientes atuais, inclusive loaders administrativos
  já autorizados para dados pessoais. B.ia não recebe service-role nem um
  cliente genérico de banco. Essa reutilização qualifica a proibição de
  admin-client da primeira receita; não remove a autorização dessas páginas.
- Ollama seleciona no máximo seis IDs conhecidos. Valores, textos e links
  vêm do código e das telas; campos extras/IDs inventados descartam a seleção.
  O primeiro fato mais relevante do ranking determinístico é sempre mantido.
  Pergunta e fatos têm CPF/e-mail mascarados antes da inferência. Nunca enviar
  sessão, credenciais, HTML completo ou respostas antigas ao modelo.
- Nome vem da sessão, apenas para apresentação cordial; não autoriza dados.
  Cada resposta traz dado, explicação do indicador, fonte e limitações.
- Até três fontes por pergunta; filtros/datas sem suporte pedem esclarecimento.
  Sem somar rankings ou páginas limitadas, inferir zeros/causas ou converter
  simulação/previsão em fatos medidos. Nenhuma ação de escrita é executada.

## Consequências

Mudanças no HTML de uma tela exigem conferir o extrator. Cobertura de aba não
significa que qualquer cálculo, filtro ou detalhe de um registro é suportado.
Dados presentes apenas após JavaScript ou em uma página de detalhe exigem uma
nova ferramenta fixa, com teste de autorização. Agenda continua filtrada pela
sessão da página. Caches/limites existentes continuam explícitos.

GET interno acrescenta latência e custo de renderização. Limites por processo
não constituem coordenação distribuída: medir no piloto antes de ampliar uso.
Timeout total 45s, GET 25s e inferência 12s; fallback preserva fatos verificados.
Chat continua em memória, sem banco ou localStorage. Mudança de usuário,
operação ou conjunto de permissões em navegação limpa a conversa.
