# Oraculo - Status do Projeto

Data: `2026-07-03`

## Producao

- App: `https://oraculo.oliverhome.com.br`
- Repositorio principal: `https://github.com/Grupo-Jacartta/oraculo.git`
- Espelho pessoal: `https://github.com/julianocalill/oraculo-jacartta`
- Frontend: Next.js em `apps/web`
- Backend canonico: Supabase/Postgres
- Deploy: Vercel, com dominio de producao apontado para o ultimo deploy aprovado.

## Entregue desde 2026-06-27

- Layout do dashboard alterado para tema claro, branco e mais leve.
- Fallback local de auth para desenvolvimento sem senha em localhost.
- `.vercelignore` criado para evitar envio de `.env`, `tmp/`, logs, reports e artefatos locais.
- Migration fiscal corrigida para criar snapshots sem sintaxe invalida de `grant/revoke on view`.
- `oraculo_fiscal_channel_metrics` otimizado para ler `oraculo_fiscal_channel_sales`.
- Dashboard deixou de executar consultas pesadas no render server-side.
- Importacao manual de julho executada:
  - NF fiscal: `5.856` notas upsertadas e `5.965` itens;
  - pedidos Olist: `6.473` pedidos entre `2026-07-01` e `2026-07-31`;
  - hidratacao detalhada de pedidos foi interrompida apos cerca de `800` pedidos, portanto nao deve ser tratada como completa.
- Edge Function `olist-sync-invoices` criada e publicada.
- Cron fiscal automatizado no Supabase:
  - `oraculo-olist-invoices-15m`;
  - `oraculo-olist-invoices-monthly-headers-hourly`.
- Ranking de SKUs do index religado usando a fonte cacheada `oraculo_sku_current_unified`.
- Filtro padrao do dashboard e da pagina `/pedidos` agora usa o mes vigente em `America/Sao_Paulo`.
- URLs legadas com `start=2026-06-01&end=2026-06-30` sao normalizadas para o mes vigente.
- Cabecalho fiscal deixou de usar texto hardcoded de junho e agora deriva o mes do filtro ativo.

## Estado Fiscal Atual

Consulta de validacao em `2026-07-03` para o periodo `2026-07-01` a `2026-07-31`:

- NFs validas: `7.186`
- Receita faturada: `R$ 688.547,55`
- Dados ate: `2026-07-03`

Regra fiscal oficial permanece:

- status fiscal em `6` ou `7`;
- excluir `tipo = E`;
- excluir `raw_json.origem.tipo = devolucao`;
- data fiscal = emissao da NF;
- receita oficial = valor validado da NF.

## Fiscal Por Canal

O agrupamento `Sem canal` significa que a NF fiscal valida nao trouxe nenhum identificador de canal no payload da Olist:

- `integration_name` vazio;
- `marketplace_name` vazio;
- `channel_name` vazio;
- `raw_json.ecommerce.nome` vazio.

No periodo de julho de 2026, `Sem canal` soma `18` NFs e `R$ 179.642,32`. Quase todo o valor vem da NF `394638`, de `R$ 178.500,00`, com origem `venda`, pedido Olist `364696458` e ecommerce vazio (`id = 0`, `nome = ""`, `canalVenda = ""`). Ela deve ser investigada pelo negocio como possivel venda direta/manual/atacado/B2B antes de renomear ou redistribuir o canal.

## Runtime do Dashboard

Permitido em request-time:

- `oraculo_fiscal_daily_revenue`;
- `oraculo_fiscal_channel_metrics`;
- `oraculo_fiscal_latest_snapshots`;
- `oraculo_sku_current_unified` para ranking parcial/cacheado de SKUs.

Proibido no render server-side da Vercel:

- `oraculo_fiscal_metrics`;
- `oraculo_fiscal_order_item_backfill_progress`;
- `oraculo_sku_period_rank_unified` para periodos grandes;
- auditorias e RPCs pesadas de cobertura.

Motivo: esses caminhos ja causaram timeout Supabase `57014` ou latencia inaceitavel em producao.

## Jobs Ativos

- `oraculo-olist-orders-hourly`: pedidos Olist incrementais.
- `oraculo-olist-derived-hourly`: metricas/cache operacionais.
- `oraculo-nf-cache-hourly`: cache de NFs no Postgres.
- `oraculo-olist-stock-6h`: estoque/produtos.
- `oraculo-olist-invoices-15m`: NFs recentes, lotes curtos com checkpoint.
- `oraculo-olist-invoices-monthly-headers-hourly`: catch-up horario dos cabeçalhos fiscais do mes vigente.

## Commits Recentes

- `f26b677` - automate fiscal invoice sync.
- `ea003d5` - restore cached SKU ranking on dashboard.
- `7aae605` - default dashboard filters to current month.
- `8d4b730` - fix current fiscal period header.

## Pendencias Locais Conhecidas

Continuam fora de commit por serem pendencias separadas:

- `supabase/migrations/20260701120000_create_product_cost_snapshots.sql`
- `tmp/`

## Atualizacao 2026-07-06

- Nova rota `/curva-de-venda` criada no app web.
- Link `Curva de Venda` adicionado ao menu principal do Analytics.
- A tela classifica todos os itens com estoque disponivel em:
  - Curva A: ate `90` dias sem saida;
  - Curva B: de `91` a `180` dias sem saida;
  - Curva C: mais de `180` dias sem saida ou sem venda registrada.
- Fonte final: `olist_products` com `disponivel > 0` e `tipo <> K`; ultima venda calculada por `olist_order_items.order_data_criacao` via `produto_id`.
- A tela mostra cards por curva, grafico horizontal A/B/C por quantidade de produtos e tabela com quatro colunas: nome do produto, data da ultima venda, quantidade em estoque e curva de venda.
- Validacao local: `npx pnpm --filter web typecheck` e `npx pnpm --filter web build`.
- Deploy de producao executado via Vercel CLI em `2026-07-06`.
- Deployment: `dpl_CEayv5fyiMhW5Tah3uy8fXx4KuUE`.
- URL gerada: `https://oraculo-jacartta-1nzsksucw-grupo-jacartta.vercel.app`.
- Alias de producao confirmado: `https://oraculo.oliverhome.com.br`.
- Validacao HTTP: `/curva-de-venda` retorna `307` para `/login?next=%2Fcurva-de-venda`, comportamento esperado para rota protegida.

## Atualizacao 2026-07-06 - recriacao Curva de Venda

- Aba `/curva-de-venda` recriada para seguir o formato operacional pedido:
  - listar somente produtos com estoque disponivel maior que zero;
  - colunas exibidas: nome do produto, data da ultima venda, quantidade em estoque e curva de venda;
  - grafico horizontal A/B/C baseado na quantidade de produtos em cada curva, nao em unidades de estoque.
- Validacao local: `npx pnpm --filter web build` e `npx pnpm --filter web typecheck`.
- Novo deploy de producao via Vercel CLI: `dpl_59HFv6maeWXKC815jo2ta3irJuiW`.
- URL gerada: `https://oraculo-jacartta-99ak8c7m6-grupo-jacartta.vercel.app`.
- Alias de producao confirmado: `https://oraculo.oliverhome.com.br`.
- Validacao HTTP: `/curva-de-venda` retorna `307` para `/login?next=%2Fcurva-de-venda`, comportamento esperado para rota protegida.

## Atualizacao 2026-07-06 - filtro Curva de Venda

- Aba `/curva-de-venda` passou a aceitar filtro por curva:
  - todas: `/curva-de-venda`;
  - curva A: `/curva-de-venda?curva=A`;
  - curva B: `/curva-de-venda?curva=B`;
  - curva C: `/curva-de-venda?curva=C`.
- A tabela respeita o filtro selecionado e continua exibindo somente produtos simples com estoque disponivel maior que zero.
- O grafico horizontal permanece como resumo A/B/C do estoque classificado.
- Botao `Exportar` adicionado para baixar CSV da curva selecionada.
- Rota de exportacao: `/curva-de-venda/export?curva=A|B|C`.
- Validacao local: `npx pnpm --filter web typecheck` e `npx pnpm --filter web build`.
- Deploy de producao: `dpl_ApXuqS96FrJr26D9H8i42mYZ4Lsu`.
- URL gerada: `https://oraculo-jacartta-grldo46bz-grupo-jacartta.vercel.app`.
- Alias de producao confirmado: `https://oraculo.oliverhome.com.br`.
- Validacao HTTP: `/curva-de-venda?curva=A` e `/curva-de-venda/export?curva=A` retornam `307` para login, comportamento esperado para rotas protegidas.

## Atualizacao 2026-07-06 - produtos simples na Curva de Venda

- Aba `/curva-de-venda` ajustada para excluir kits explicitamente.
- Fonte da lista alterada para `olist_products`, com filtros:
  - `disponivel > 0`;
  - `tipo` diferente de `K`.
- O filtro `active = true` nao deve ser usado nessa tela no estado atual, porque os produtos com estoque positivo estao com `active = false` na tabela local.
- Data da ultima venda passou a ser buscada em `olist_order_items.order_data_criacao` por `produto_id`.
- Exportacao CSV usa a mesma regra da tela.
- Validacao local: `npx pnpm --filter web build` e `npx pnpm --filter web typecheck`.
- Deploy de producao: `dpl_AKWzMhPTPwJdtBQQAB2UVhSthmu8`.
- URL gerada: `https://oraculo-jacartta-iu63ubsfb-grupo-jacartta.vercel.app`.
- Alias de producao confirmado: `https://oraculo.oliverhome.com.br`.
- Validacao HTTP: `/curva-de-venda?curva=C` e `/curva-de-venda/export?curva=C` retornam `307` para login, comportamento esperado para rotas protegidas.

## Atualizacao 2026-07-06 - hotfix Curva de Venda vazia

- Problema encontrado: a tela ficou vazia porque `olist_products.active = true` retornava `0` produtos, embora existissem `959` produtos com `disponivel > 0`.
- Correção: remover o filtro `active = true` da tela e da exportacao.
- Regra final da lista: `disponivel > 0` e `tipo <> K`.
- Contagem de validacao antes do deploy: `446` produtos simples com estoque disponivel.
- Validacao local: `npx pnpm --filter web build` e `npx pnpm --filter web typecheck`.
- Deploy de producao: `dpl_GtdRkV2axaUTQekJ1bB4X8LhJuDB`.
- URL gerada: `https://oraculo-jacartta-a7iyxajpo-grupo-jacartta.vercel.app`.
- Alias de producao confirmado: `https://oraculo.oliverhome.com.br`.

## Atualizacao 2026-07-06 - Curva de Estoque

- Nova rota `/curva-de-estoque` criada no app web.
- Link `Curva de Estoque` adicionado ao menu principal do Analytics.
- Objetivo: classificar produtos por meses de cobertura de estoque, nao por data da ultima venda.
- Fonte:
  - estoque atual em `olist_products.disponivel`;
  - vendas historicas em `olist_order_items.quantidade` e `olist_order_items.order_data_criacao`.
- Filtro: produtos com `disponivel > 0`.
- Formula:
  - media diaria = total historico vendido / dias desde a primeira venda registrada;
  - media mensal = media diaria * `30`;
  - meses de cobertura = estoque atual / media mensal.
- Classificacao:
  - Curva A: ate `3` meses de cobertura;
  - Curva B: mais de `3` e ate `6` meses de cobertura;
  - Curva C: mais de `6` meses de cobertura;
  - `Sem venda`: produtos sem media de venda.
- Tela inclui cards A/B/C/total, grafico horizontal de quantidade de produtos por curva, grafico horizontal de estoque por curva e tabela com produto, estoque atual, media diaria, media mensal, meses de cobertura e curva.
- Filtro por curva adicionado:
  - todas: `/curva-de-estoque`;
  - curva A: `/curva-de-estoque?curva=A`;
  - curva B: `/curva-de-estoque?curva=B`;
  - curva C: `/curva-de-estoque?curva=C`.
- Botao `Exportar` adicionado para baixar CSV da curva selecionada.
- Rota de exportacao: `/curva-de-estoque/export?curva=A|B|C`.
- Validacao local: `npx pnpm --filter web build` e `npx pnpm --filter web typecheck`.
- Validacao de dados: `959` produtos com `disponivel > 0` antes do deploy.
- Deploy de producao: `dpl_7rTd398X9LwQt7hS1ftTVwH977k8`.
- URL gerada: `https://oraculo-jacartta-24pvamadm-grupo-jacartta.vercel.app`.
- Alias de producao confirmado: `https://oraculo.oliverhome.com.br`.
- Validacao HTTP: `/curva-de-estoque` retorna `307` para `/login?next=%2Fcurva-de-estoque`, comportamento esperado para rota protegida.

## Atualizacao 2026-07-06 - filtro/export Curva de Estoque

- Aba `/curva-de-estoque` passou a aceitar filtro por curva:
  - todas: `/curva-de-estoque`;
  - curva A: `/curva-de-estoque?curva=A`;
  - curva B: `/curva-de-estoque?curva=B`;
  - curva C: `/curva-de-estoque?curva=C`.
- Botao `Exportar` adicionado para baixar CSV da curva selecionada.
- Rota de exportacao: `/curva-de-estoque/export?curva=A|B|C`.
- Validacao local: `npx pnpm --filter web build` e `npx pnpm --filter web typecheck`.
- Deploy de producao: `dpl_ECh3famL4hPTvzwc7upUB1tGRQoE`.
- URL gerada: `https://oraculo-jacartta-4cdyqs3d7-grupo-jacartta.vercel.app`.
- Alias de producao confirmado: `https://oraculo.oliverhome.com.br`.
- Validacao HTTP: `/curva-de-estoque?curva=A` e `/curva-de-estoque/export?curva=A` retornam `307` para login, comportamento esperado para rotas protegidas.

## Atualizacao 2026-07-06 - performance Curva de Estoque

- Problema: a primeira implementacao da Curva de Estoque calculava historico no render da pagina, buscando produtos e `olist_order_items` em lotes no Next.js.
- Correcao: criada RPC `oraculo_stock_coverage_curve()` no Supabase.
- A RPC le o cache materializado `oraculo_stock_coverage_curve_cache`.
- Funcao de refresh criada: `refresh_oraculo_stock_coverage_curve_cache()`.
- App e exportacao passaram a chamar apenas a RPC, removendo processamento de historico do render server-side.
- Validacao remota em `2026-07-06`: RPC retornou `959` produtos em cerca de `363ms`; a agregacao direta anterior levou cerca de `4s`.
- Curva de Venda tambem foi otimizada com cache materializado `oraculo_sales_curve_cache` e RPC `oraculo_sales_curve()`.
- Validacao remota apos otimizar as duas curvas:
  - `oraculo_stock_coverage_curve`: `959` produtos em cerca de `850ms`;
  - `oraculo_sales_curve`: `446` produtos em cerca de `117ms`.
- Validacao local: `npx pnpm --filter web build` e `npx pnpm --filter web typecheck`.
- Deploy de producao: `dpl_7ZfDGJiXm1cirNhj9B1JW82E5n6i`.
- URL gerada: `https://oraculo-jacartta-jvv4oqtmf-grupo-jacartta.vercel.app`.
- Alias de producao confirmado: `https://oraculo.oliverhome.com.br`.
- Validacao HTTP: `/curva-de-estoque?curva=A` e `/curva-de-estoque/export?curva=A` retornam `307` para login, comportamento esperado para rotas protegidas.
- Deploy de producao com Curva de Venda e Curva de Estoque lendo caches materializados: `dpl_DmXnkiE7DxqZB6T3FNRrfpzZmKu2`.
- URL gerada: `https://oraculo-jacartta-bzlo23qdy-grupo-jacartta.vercel.app`.

## Atualizacao 2026-07-07 - performance geral

- Middleware de producao deixou de chamar `auth/v1/user` em toda navegacao.
- Novo comportamento do middleware:
  - decodifica o `exp` do JWT localmente;
  - se o token ainda esta valido por mais de `60s`, segue sem chamada externa;
  - so chama Supabase Auth quando precisa renovar com refresh token.
- Home deixou de recalcular cache de canais em request-time quando o cache esta vazio.
- Home deixou de consultar `olist_products` + ate `5000` linhas de `olist_order_items` para ruptura; agora reaproveita `oraculo_stock_watchlist_unified`.
- Contagem de `olist_order_items` na home deixou de ser `exact` e passou para `estimated`.
- Validacao local: `npx pnpm --filter web build` e `npx pnpm --filter web typecheck`.
- Deploy de producao: `dpl_ARv9uGp7C6sF2z6ode69r6cYxyGf`.
- URL gerada: `https://oraculo-jacartta-n4vbsg3td-grupo-jacartta.vercel.app`.
- Alias de producao confirmado: `https://oraculo.oliverhome.com.br`.
- Validacao HTTP em producao: `/`, `/curva-de-estoque?curva=A` e `/curva-de-venda?curva=A` retornam `307` para login, comportamento esperado para rotas protegidas sem sessao.

## Atualizacao 2026-07-07 - sync fiscal de NFs de julho

- Problema reportado por comparacao visual com a tela Olist `Notas Fiscais`: Oraculo mostrava `16.428` NFs e `R$ 1.393.548`, enquanto a Olist mostrava cerca de `21.589` NFs emitidas e `R$ 1.775.583,37`.
- Diagnostico: `olist_invoices` estava incompleta para julho; o cron mensal antigo rodava uma vez por dia com limite de `25` paginas e hidratava detalhes, insuficiente para meses com mais de `20k` NFs.
- Correcao operacional aplicada:
  - sync manual de julho `2026-07-01` a `2026-07-31` por `scripts/sync-olist-invoices.js` sem hidratacao de detalhes;
  - `22.698` NFs percorridas/upsertadas no run `a3d3b39c-c618-464f-b59d-58be932e94eb`;
  - snapshot fiscal regravado com `21.676` NFs validas e `R$ 1.781.726,64`;
  - `refresh_oraculo_fiscal_invoice_order_links` executado por dia para evitar timeout `57014`, inserindo `21.676` vinculos de julho;
  - snapshot de cobertura SKU regravado com `21.676` NFs validas, `14.158` NFs com pedido encontrado e `11.610` NFs com pedido + itens.
- Correcao permanente:
  - Edge Function `olist-sync-invoices` agora aceita ate `300` paginas por execucao;
  - novo cron `oraculo-olist-invoices-monthly-headers-hourly`, horario `45 * * * *`, sincroniza cabeçalhos do mes vigente com `hydrateDetails=false`;
  - cron incremental `oraculo-olist-invoices-15m` continua hidratando detalhes recentes.

## Atualizacao 2026-07-07 - regra de DIFAL

- DIFAL deixou de ser tratado como campo manual independente na tela de parametros.
- `oraculo_state_tax_params` recebeu `interstate_icms_rate`.
- Regra implementada:
  - `difal_rate = max(icms_rate - interstate_icms_rate, 0)`;
  - `effective_tax_rate = interstate_icms_rate + difal_rate + fcp_rate`.
- Nesta regra, `icms_rate` representa a aliquota interna do estado de destino.
- A aplicacao em margem/ROI fiscal oficial continua bloqueada ate a cobertura por item passar no gate fiscal.
- Migração aplicada em produção: `20260707172000_calculate_difal_from_icms_rates.sql`.
- Validacao SQL em transacao com rollback: SP `18%` interno, `12%` interestadual e `2%` FCP calculou `6%` DIFAL e `20%` taxa efetiva.
- Validacao local: `npx pnpm --filter web build` e `npx pnpm --filter web typecheck`.
- Deploy de producao: `dpl_6NKpACATF1hWoNtbErpX42UrPQss`.
- Alias de producao confirmado: `https://oraculo.oliverhome.com.br`.

## Atualizacao 2026-07-07 - margem/ROI operacional

- Tela `/skus` liberada para exibir margem 30d, ROI 30d e lucro operacional calculados por `oraculo_sku_margin_30d`.
- Rotulos antigos de `Bloqueado` foram removidos da tabela e do painel lateral.
- A cobertura fiscal continua visivel no topo da pagina para deixar claro que a leitura e parcial.
- Regra de comunicacao: margem/ROI operacional pode ser usada para analise interna; margem/ROI fiscal oficial continua condicionada a view auditada de NF + item.
- Validacao local: `npx pnpm --filter web build` e `npx pnpm --filter web typecheck`.
- Deploy de producao: `dpl_AKM7ayoqYWc9uHGV38ZyUjhpJYVo`.
- URL gerada: `https://oraculo-jacartta-kzmd0txzs-grupo-jacartta.vercel.app`.
- Alias de producao confirmado: `https://oraculo.oliverhome.com.br`.
