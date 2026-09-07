# Estado do projeto — 04/09/2026

Continuidade: [estado anterior de 02/09](project-status-2026-09-02.md).

## Explicações de colunas em todo o sistema

Todas as tabelas `data-table` agora apresentam um `?` em cada cabeçalho. A
explicação abre ao passar o mouse e também por foco/toque, para funcionar em
desktop, celular e navegação por teclado. As tabelas ordenáveis recebem a
descrição no próprio componente; um reforço no layout cobre os cabeçalhos
legados e observa conteúdo incluído depois da navegação.

O glossário fica centralizado em `apps/web/lib/column-hints.ts`, com definições
compartilhadas e complementos por rota para termos que mudam de significado
entre telas. Um inventário de todos os `<th>` e arrays de `SortableTable`
confirmou que os cabeçalhos literais existentes possuem descrição específica.
Mudança implementada localmente; publicação ainda não executada neste registro.

## Análise Comercial diária e por intervalo

Implementada a aba `/analise-comercial`, em **Comercial**, com filtro de datas
inclusivas, Hoje/Ontem/7 dias/mês, loja e busca por nome/SKU. Ranking ordenável
por quantidade, receita, margem e resultado, com custos, impostos e comissão.

A data é faturamento (emissão da NF válida) para manter venda e margem no mesmo
universo. O motor fiscal existente é reutilizado integralmente. Produtos sem
custo/comissão ficam no ranking com margem pendente. Cards mostram margem
ponderada sobre a receita coberta; o valor de NFs sem itens continua no total
e é explicado. Contrato e operação: [analise-comercial.md](analise-comercial.md).

## Backend

Migration `20260904143926_commercial_daily_analysis.sql` aplicada no Supabase
vinculado. Três tabelas agregadas com RLS/SELECT authenticated; refresh interno
sem acesso de anon/authenticated. Cron `oraculo-commercial-hourly` (:42) criado
na mesma migration e acompanhado em `/status`.

Os últimos 10 dias são revistos de hora em hora; o histórico recebe lotes de
7 dias, incluindo dias sem vendas no controle. A RPC retorna JSON com todos os
SKUs, impedindo corte de 1.000 linhas do PostgREST.

## Validação

- TypeScript sem erros e suíte de domínio com 59 testes aprovados, incluindo
  datas impossíveis/invertidas/futuras, intervalos inclusivos, ponderação da
  margem e produtos com dados incompletos.
- Consulta real de 11 dias como `authenticated`, timeout de 8s: **20,773 ms**.
- Reconciliação SKU a SKU em 03/09 contra `oraculo_fiscal_margin_lines`:
  **zero diferenças** em quantidade, receita e resultado coberto.
- 03/09: 3.835 NFs, R$ 199.155,88 faturados; ranking R$ 199.055,98.
  Diferença R$ 99,90 explicitamente identificada como NF sem itens.
- Verificação de segurança Supabase sem apontamentos para os novos objetos.

- Build de produção aprovado, rota `/analise-comercial` incluída.
- Navegador: Hoje/Ontem, intervalo personalizado + loja + SKU, ordenação por
  margem e layout de celular (390 px, sem overflow do documento) verificados.
- Carga inicial concluída: 96 dias, de 01/06 a 04/09; consulta do intervalo
  completo como authenticated em **72,308 ms**.
- Cron horário executou com sucesso em 04/09 às 11:42 BRT (40s). Anonymous
  sem acesso à RPC e authenticated sem acesso à função de refresh.

## Publicação

Frontend em produção, commit `96ad31c`, enviado a `origin` e `personal`.
Deployment Vercel `dpl_EaNG4CybVy9KZbY2kUsNKNMgnAbC`, **READY**, com alias
`oraculo.oliverhome.com.br`; a função `/analise-comercial` consta no build
publicado em `gru1`. A rota pública mantém o redirecionamento para login;
validação funcional autenticada foi feita localmente e no banco com RLS.
A novidade pós-login tem ID `2026-09-04-analise-comercial`.

Alterações locais anteriores em hidratação/separação multicanal e documentos de
01/09 e 02/09 foram preservadas.

## Preparação multioperação — Giracasa/SP

O Oráculo agora tem contexto explícito de operação nas URLs e nas permissões por usuário/aba. O schema `giracasa` nasce isolado, vazio e desativado; não reutiliza dados ou credenciais de Uberlândia. O motor `gira-casa-v1`, testes de isolamento, builder de Edge Functions e runbook de carga de 90 dias estão versionados. A operação só será ativada em migration posterior à configuração das contas e à conferência dos números. Decisão: `docs/adr/ADR-006-operation-isolation.md`; operação: `docs/giracasa-onboarding.md`.

### Estado de implantação da Giracasa às 18:10

A migration de cadastro das operações foi aplicada em produção: 7/7 usuários foram migrados apenas para Uberlândia e nenhuma permissão Giracasa foi concedida; `giracasa.enabled=false`. A revisão automática bloqueou a migration seguinte porque ela altera em uma transação as 101 tabelas, 34 views, 94 funções próprias, RLS e grants. O SQL passou integralmente no clone local, mas não foi aplicado em produção e o web app não foi publicado. É necessária autorização explícita para esse blast radius. Não foram encontradas credenciais Giracasa no ambiente, portanto funções, backfill e jobs também não foram ativados.
