# Changelog — Oráculo

Histórico de entregas e mudanças significativas.

## [2026-08-23] — Status do sync sem falsos alertas

- **Pedidos**: `/status` deixou de ler `olist_sync_runs`, tabela legada escrita
  pela carga histórica local das 10h, e passou a ler
  `olist_order_sync_runs`, fonte real do sync operacional retomável. Uma falha
  de backfill de junho não mascara mais os pedidos correntes.
- **Estoque**: uma varredura aberta agora aparece pela atividade do cursor em
  `olist_stock_sync_state`; a tela não espera as ~15h da varredura completa
  para reconhecer que o job rodou hoje e mostra o progresso atual.
- **Notas**: a pausa deliberada por orçamento de 110s, quando recente e
  marcada como retomável, aparece como `Retomando` em amarelo. Só vira alerta
  se deixar de ter atividade por 90 minutos.
- **Backfill local**: chamadas à Olist agora têm timeout de 90s e 8 tentativas
  com backoff. Antes o HTTP/2 podia ficar 5 minutos travado em cada tentativa
  antes de registrar `fetch failed`.
- Verificação: `node --check scripts/import-olist-orders-full.js`,
  `pnpm --filter web typecheck` e `pnpm --filter web build` sem erros.

## [2026-08-23] — Menu reorganizado, sessão de 1h e cobertura de dados explícita

- **Menu**: Devoluções migrou de Operações para o setor Comercial;
  Documentação saiu do Analítico e ficou solta junto da Agenda; o grupo Admin
  perdeu o `align-self: end` e ficou alinhado com o resto da sidebar.
- **Parâmetros só para administradores**: nova flag `adminOnly` no registro de
  abas (`lib/auth/tabs.ts`). O gate ignora a aba para quem não é master mesmo
  que esteja gravada em `app_metadata.tabs`, e a caixinha saiu da matriz de
  `/usuarios`.
- **Sessão com janela dura de 1h** (era deslogado em minutos): a causa raiz
  era o `getCurrentUser` usando `setSession`, que rotacionava o refresh token
  por fora do middleware — a rotação dupla disparava o reuse detection do
  Supabase e revogava a sessão. Agora só o middleware renova token (e propaga
  os cookies novos para o próprio request); `getCurrentUser` valida com
  `getUser(jwt)`. O login grava `oraculo_session_window` (1h, nunca renovado)
  e o middleware desloga quando ele expira. Primeiro deploy desloga todo mundo
  uma vez (sessões antigas não têm o cookie).
- **/status com cobertura**: cards "Pedidos na base até" / "NFs na base até"
  medidos no próprio dado (vermelhos quando não chegam em hoje) e coluna
  **Cobertura** na tabela explicando o que cada rotina varre e com que atraso.
- **Visão geral diz de quando são os dados**: linha em linguagem simples sob o
  título — até quando as NFs sincronizadas chegam e quando os indicadores
  foram recalculados (hora do snapshot horário, ou "calculados agora" em
  janela custom).

## [2026-08-23] — Ranking de SKUs restrito à fonte Olist

- `/skus` agora consulta exclusivamente `source = 'olist'`, inclusive ao abrir
  o detalhe de um produto. URLs antigas com `source=all` ou `source=shopee`
  não conseguem mais misturar as duas origens.
- O seletor de fonte foi removido e substituído pela indicação fixa
  **Olist · todos os marketplaces**. A API direta da Shopee continua como
  fonte auxiliar em suas análises próprias, mas não participa deste ranking:
  a mesma venda já chega pela Olist e aparecia duplicada com outro SKU/nome.

## [2026-08-23] — Cobertura de custo fiscal ligada ao override manual + Olist mais rápido

- **Causa raiz da Cobertura fiscal travada em ~97%**: `oraculo_fiscal_margin_lines`
  resolvia custo só por `produto_id -> olist_products`, nunca olhando o
  override manual de `oraculo_margin_sku_params` (formulário já existente em
  `/parametros` e `/shopee/reposicao`). Preencher custo nessas telas não
  movia a Cobertura. Corrigido casando o override direto pelo SKU da linha
  (necessário porque parte relevante das linhas tem `produto_id = '0'` — sem
  produto do catálogo Olist vinculado, nem sequer um id pra cadastrar custo)
  e, para kits, também por componente. Migrations `20260823120000`,
  `20260823121000`, `20260823122000`. Ver `docs/deployment-map.md`.
- **Nova seção "Custos pendentes" em `/parametros`**: lista os SKUs exatos
  que ficam fora da Cobertura fiscal, ordenados por receita afetada, com o
  motivo (sem produto vinculado / kit incompleto / sem custo / custo
  implausível) e correção inline reaproveitando o form `saveSkuParam` já
  existente — sem página nem tabela nova. RPC `oraculo_fiscal_cost_gap`
  roda só via snapshot horária (`fiscal_cost_gap`, dentro de
  `oraculo_capture_fiscal_margin_snapshots()`), nunca ao vivo — o cálculo
  varre o mês inteiro e estoura o timeout de 8s do papel `authenticated`.
- **Olist com menos atraso**: `oraculo-olist-orders-hourly` passou de 2×/hora
  para 4×/hora (`5,20,35,50 * * * *`, migration `20260823130000`), mesma
  cadência já comprovada segura para as notas fiscais — corta o
  atraso máximo de um pedido novo aparecer de ~30 min para ~15 min.
- **Salvar um custo recalcula tudo na hora**: o SKU sai de "Custos pendentes"
  no próprio save (loader filtra pelos overrides ativos, sem esperar o
  snapshot), e Cobertura/Lucro fiscal recalculam em até 1 minuto via job
  `pg_cron` de um tiro (`oraculo_trigger_fiscal_recompute`, migration
  `20260823150000`) — antes só o cron horário atualizava. Chamar a captura
  direto do request não funciona: leva ~16-26s e o caminho REST corta antes,
  inclusive com `set local statement_timeout` (testado ao vivo).
- **Captura de snapshots fiscais 2× mais rápida** (migration `20260823140000`):
  `oraculo_fiscal_margin_lines` era calculada 3× por passe (~10,4s cada);
  agora roda uma vez em temp table reaproveitada — ~33s → ~16s. Também moveu
  `refresh_oraculo_fiscal_invoice_order_links` para o início, para todos os
  snapshots do passe lerem o mesmo estado de vínculos.

## [2026-08-23] — Redesign da UI: bento, tema claro, tipografia e gráficos

- **Visão geral recomposta em bento grid** (12 colunas, tiles de tamanhos
  variados): hero de Receita faturada com sparkline preenchida e sub-stats,
  Lucro fiscal com gauges, cobertura SKU compacta, donut de impostos e o novo
  tile "Composição do resultado" (barra segmentada custo/impostos/marketplace/
  lucro). Nota metodológica virou `<details>` recolhido.
- **Tema claro completo + seletor por usuário**: toggle Escuro/Claro na
  sidebar, cookie de 1 ano lido no servidor (`lib/theme-server.ts`) — o HTML
  já sai com o `data-theme` certo, sem flash. Ouro ganhou papéis tokenizados
  (`--gold-text`, `--on-gold`) para manter contraste 4.5:1 no claro.
- **Tipografia**: Aptos (só Windows) → IBM Plex Sans + IBM Plex Mono via
  `next/font` (self-hosted, sem request externo em runtime).
- **Gráficos com linguagem única** (SVG server-side, sem lib): novo
  `DailyBars` substitui as barras em div de /pedidos (gradiente, pico sólido,
  média tracejada, tooltip nativo); curvas suavizadas (Catmull-Rom) no
  `RevenueArea` e nas sparklines.
- **KPIs sem truncar**: cards `.metric` usam container queries — o valor
  escala pela largura do card (adeus "R$ 5.902.8…").
- **Mobile**: sidebar não estoura mais o viewport (min-width 0 no shell),
  `.dashboard-section` com `minmax(0,1fr)` (SVG de 720px estourava
  /devolucoes), alvos de toque ≥44px (nav, filtros, pills, toggle, links de
  tabela com área expandida).
- **Interação**: fim do sublinhado em links — hover é mudança de cor com
  transição em todo o sistema (pills de aba, row-links, doc-links); anel de
  foco único `:focus-visible`; `prefers-reduced-motion` global.
- **Sidebar compacta (232px) com ícones SVG** por aba
  (`app/components/nav-icons.tsx`).
- Documentação: novo `docs/design-system.md` (tokens, temas, bento, gramática
  dos gráficos, regras de interação e mobile).

## [2026-08-23] — Auditoria dos dados de logística e correção de campo morto

- **`olist_orders.transportador_nome` removida**: 0 preenchidos em 138.873
  pedidos de 30 dias. O campo `nome` do ERP vem sempre vazio porque quem
  despacha é o marketplace — a coluna foi criada na Fase 1 a partir do shape
  do jsonb, sem medir taxa de preenchimento. Migration `20260823170000`.
- **Cobertura real dos campos de envio agora está no `COMMENT ON`** de cada
  coluna, para não repetir o erro em quem ler o dicionário: `forma_envio` e
  `frete_por_conta` 99,9%; `codigo_rastreamento` ~1% (só Mercado Envios);
  `valor_frete` ~2% (só pedidos hidratados).
- **Fase 4 do plano reescrita**: o Olist não serve como fonte de expedição
  multicanal. Cada canal precisa da própria ingestão, como já existe para a
  Shopee. Ordem definida por volume e maturidade de API (ML → TikTok);
  ranking de transportadoras e frete por pedido saem do escopo por falta de
  dado. Ver `docs/plano-logistica-deposito.md`.
- Estado medido do resto: estoque por depósito com 3.073 produtos e **99,3%**
  de reconciliação com o saldo do ERP (era 88% no backfill inicial, quando
  saldo e depósito vinham de varreduras diferentes); custo cobre 91,8% dos
  produtos com estoque; dimensões físicas só 32,5% (peso) e 12,5% (cubagem).

## [2026-08-22] — Logística Fase 2: recebimento e conferência

- Nova pill **/logistica/recebimento**: lista as faturas de importação sem
  conferência, as conferências abertas (com progresso) e o histórico. "Iniciar
  conferência" copia os itens esperados de `importacao_itens` (quantity, ou
  cartons × quantity_per_carton) para `logistica_recebimento_itens`.
- **/logistica/recebimento/[id]** é a tela do galpão (mobile-first, campos
  grandes, um item por cartão): quantidade e cartons conferidos, divergência
  sugerida pela quantidade (ok/falta/sobra/avaria) que a pessoa confirma, SKU
  Olist opcional com `datalist` do ERP e observação. Cada item grava quem e
  quando conferiu. Concluir fecha como `concluido` ou
  `concluido_com_divergencia`; item não conferido entra como falta total (a
  tela avisa antes). Dá para reabrir.
- Aqui o vínculo com o catálogo do ERP é desejado — ao contrário da etiqueta
  de palete — porque o objetivo é cruzar a entrada conferida com o saldo Olist
  (a tela mostra o disponível de hoje do SKU informado). Referências a
  faturas/itens são soltas: a planilha pode ser recarregada sem apagar uma
  conferência já feita.
- Tabelas `logistica_recebimentos` e `logistica_recebimento_itens`, view
  `oraculo_recebimento_progress` (migration `20260822120000`). O lançamento de
  entrada continua sendo feito no Olist.

## [2026-08-22] — Menu lateral por setores

- O menu deixou de ser uma lista plana de 19 abas: agora são três setores —
  **Analítico** (Analytics, SKUs, curvas, previsão, mais vendidos,
  documentação), **Comercial** (Pedidos, Shopee, Mercado Livre, Calculadora,
  RPA) e **Operações** (Logística, Expedição, Importações, Devoluções,
  Alertas) — em acordeão: o setor da página atual nasce aberto e abrir outro
  fecha o anterior. Agenda e Parâmetros ficam soltos; Admin continua no rodapé.
- Zero estado no cliente: é `<details name="oraculo-setor">` nativo — o
  browser cuida da exclusividade. O setor é metadado da aba em
  `lib/auth/tabs.ts` (`sector`); `group` e o controle de acesso não mudam.
  O badge de rupturas soma no cabeçalho "Operações" para não sumir com o
  setor fechado. As caixinhas de `/usuarios` seguem o mesmo agrupamento.

## [2026-08-21] — Logística Fase 1: estoque por depósito

- **`/logistica` virou hub** com pills (Visão geral · Estoque · Etiqueta). A
  visão geral mostra capital em estoque a custo, unidades disponíveis/
  reservadas, rupturas e a quebra de capital por depósito. **/logistica/estoque**
  é a tabela por produto com colunas dinâmicas por depósito (só depósitos com
  movimento viram coluna), sinal da watchlist, custo canônico e capital — com
  filtros e export xlsx que reusa o builder da tela.
- **A conta Olist tem 8 depósitos e a gente jogava o dado fora**: a coluna
  `olist_stock_items.depositos` sempre ficou vazia porque o payload de
  `produtos/{id}` não traz depósitos — eles vêm de `GET /estoque/{id}`. Nova
  tabela `olist_stock_deposits` (produto × depósito) alimentada pela edge
  function `olist-sync-stock` (chamada extra só para produtos com movimento,
  ~+30% de chamadas, página segue longe do teto de 150s) e semeada por
  `scripts/backfill-olist-stock-deposits.js`. Dimensão curada em
  `logistica_depositos` (tipo próprio/full_ml/full_shopee/terceiro).
- **`olist_orders.transportador` era escrito e nunca lido** — agora um trigger
  (`oraculo_olist_order_logistics_fields`) materializa `transportador_nome`,
  `forma_envio`, `frete_por_conta`, `codigo_rastreamento` e `valor_frete` no
  write (generated column ali é proibido: rewrite de ~1 GB sob lock). Backfill
  dos 371k pedidos feito por cursor de id — nunca por "where is null", que
  re-escolheria para sempre pedido com transportador vazio.
- **Dimensões físicas de SKU** em `olist_products` (peso, medidas, cubagem)
  como generated columns de `payload.dimensoes` — 1.176 produtos já com peso.
- Descoberta de dado: `olist_stock_items.reservado` é sempre NULL (mesma
  causa); o reservado real agora vem da soma dos depósitos com
  `desconsiderar = false`.
- Plano completo das próximas fases (recebimento, endereçamento por posição,
  inventário, expedição multi-canal, picking) em
  `docs/plano-logistica-deposito.md`.

## [2026-08-21] — Perguntar em linguagem natural (e adeus Conectar BI)

- Nova aba **/documentacao/perguntar**: a pessoa descreve em português o que
  quer saber ("quanto eu faturei por canal em julho") e recebe **o caminho** —
  qual view usar, qual receita já resolve e quais armadilhas se aplicam. Não
  devolve número e **não escreve SQL**: neste banco, somar duas fontes dobra o
  faturamento e contar pedidos na tabela errada erra 3x, e as dez armadilhas
  existem porque são os casos em que o SQL *parece* certo. SQL que roda e
  devolve número errado é pior que nenhuma resposta — ninguém desconfia.
- **Dois estágios.** A recuperação determinística (`ask.ts`) roda sempre, sem
  IA, com um vocabulário de negócio (ninguém digita `billed_revenue`, digita
  "quanto faturei"). A IA local (Ollama na VPS, `qwen2.5-coder:7b`) recebe
  **só os candidatos**, nunca o schema inteiro, e escolhe entre eles. Mesmo
  princípio do relatório de Shopee Ads: a IA redige, o código decide o que é
  verdade. Toda tabela citada é validada contra o catálogo — nome inventado é
  descartado e a tela diz que foi.
- **Sem `OLLAMA_URL` a busca funciona igual**, só sem o parágrafo da IA. A
  seção fica num `<Suspense>`: a página aparece na hora com o resultado
  completo do catálogo e a leitura por IA chega depois. Zero client JS.
- Dois ajustes de ranking que só apareceram testando: alvo curto (`sku`) casava
  como substring em quase todo nome e afogava o específico — "quais produtos
  vão acabar no estoque" trazia margem por SKU em primeiro e ruptura em quarto.
  E as armadilhas passaram a vir da curadoria já declarada em `recipes.ts`, não
  do score: o limiar é alto de propósito, porque três avisos irrelevantes
  ensinam a ignorar o bloco inteiro e aí o que importa passa batido.
- **Aba Conectar BI removida** a pedido: some a rota `/documentacao/conectar`,
  o `connection.ts`, o passo a passo de Metabase/PowerBI e os avisos sobre
  porta 6543, DirectQuery e "esta conexão consegue escrever".
- Riscos que ficam com a infra, não com o código (documentados em
  `docs/documentacao-perguntar-ia.md`): a chamada sai da Vercel direto para a
  VPS, então o endpoint precisa exigir token, e a VPS é compartilhada — uma
  busca interativa tem perfil de carga muito diferente de um relatório a cada
  três dias.

## [2026-08-21] — Documentação do banco (nova aba)

- Nova aba **/documentacao**: dicionário de dados, receitas de SQL e as
  armadilhas do dado, para que Metabase e PowerBI parem de adivinhar o schema.
  Seis telas: visão geral, **Conectar BI** (parâmetros do pooler, passo a passo
  de Metabase e PowerBI, e o aviso de que a conexão consegue escrever), o
  **dicionário** dos 121 objetos com busca por coluna, o detalhe de cada objeto
  (colunas, tipos, PK/FK, SQL da view), as **50 funções** de BI com assinatura,
  as **11 receitas** de SQL e a página de **armadilhas**.
- **A fonte da verdade é o catálogo do Postgres, não um markdown paralelo.** As
  descrições entram como `COMMENT ON` e as telas leem `pg_catalog` em tempo
  real por 4 RPCs `security definer` novas (`oraculo_catalog_objects`,
  `..._columns`, `..._functions`, `..._view_sql` — migration `20260821120000`,
  com `revoke from anon` explícito). O ganho é duplo: a mesma descrição aparece
  dentro do **Metabase** (Table Metadata) e do DBeaver. E mostra o banco real:
  as migrations descrevem objetos que não existem em produção
  (`product_fiscal_rules`, toda a família `tiktok_*`), então um dicionário
  escrito a partir delas nasceria mentindo.
- **Cobertura de descrição: 18 → 121 objetos (100%), 1 → 158 colunas (11%),
  0 → 50 funções de BI (100%)** — migrations `20260821130000`, `20260821140000`,
  `20260821150000` e `20260821160000`. As colunas cobertas são as dos 16 objetos
  que o BI realmente consome. **A tela mostra o que falta**: cada objeto tem
  medidor de cobertura e o filtro `?pendentes=1` é a lista de trabalho — sem
  isso a documentação apodrece invisivelmente, o mesmo modo de falha do cache
  sem cron que serviu junho por 45 dias.
- **As armadilhas saíram do AGENTS.md para a tela.** As 10 que já custaram bug
  real (contar pedido em `olist_order_items`, somar Olist e Shopee, ler o
  `payload` de 1 GB, `fiscal_invoice_type='E'` em vez de `fiscal_origin_type`,
  valor pelo item em vez de `total_amount`, B2B distorcendo ranking, custo 0 que
  não é nulo) aparecem no objeto que elas machucam e na receita que as evita.
  Ficavam num arquivo que quem escreve SQL no Metabase nunca abre.
- A aba nasce **opt-in** (invisível até ser liberada em `/usuarios`), como
  `/rpa`: ela lista os nomes de `oraculo_rpa_*` e `shopee_order_escrow` e as
  instruções de conexão direta ao banco. Nomes e descrições, nunca dados — e a
  senha do banco não aparece na tela nem existe como variável de ambiente do web
  app.
- Primeiro bloco de código multi-linha do app: `.sql-block` (`white-space: pre`
  + `overflow-x: auto`) rola sozinho, como `.table-wrap` — o invariante
  `.workspace > * { min-width: 0 }` foi verificado a 1280px e 720px com o SQL
  mais largo do banco (493 caracteres). O botão "copiar SQL" é o único
  `"use client"` da aba, pelo mesmo motivo das outras exceções deliberadas: o
  propósito da área é tirar SQL daqui e colar no Metabase.
- **Trap nova documentada**: `drop view ... ; create view ...` **apaga os
  comentários** da view e das colunas dela (`create or replace view` preserva).
  O repo faz isso em 4 migrations. Toda migration que derruba uma view precisa
  reaplicar os `COMMENT ON` no mesmo arquivo; a barra de cobertura é o detector.

## [2026-08-19] — Previsão de Vendas (nova aba)

- Nova aba **/previsao-de-vendas**: previsão de unidades da próxima semana
  (seg–dom) para a logística trabalhar produção e previsibilidade — total, por
  canal, por SKU e dia a dia. Regras transparentes, auditáveis na própria tela:
  média simples das últimas semanas completas (até 4) × tendência (razão 4v4,
  limitada a ±30%), faixa low–high pelo coeficiente de variação (clamp 5–50%),
  pesos por dia da semana, share por canal e, por SKU, média das semanas em que
  o SKU existiu. **Previsão pura, sem ligação com estoque** (decisão de 20/08:
  as colunas de estoque/cobertura/sugestão de compra do primeiro corte foram
  removidas — estoque é assunto da Curva de Estoque; o `disponivel` do ERP
  também não enxergava o saldo posicionado no Full/FBS).
- 5 RPCs novas (`oraculo_sales_forecast_week/daily/channels/skus/backtest`,
  migration `20260819210000`), todas `stable` lendo só os caches
  `oraculo_olist_qty_*_daily_cache` — sem cache novo, sem cron novo. B2B/"Sem
  canal" fica **fora** da previsão e aparece como KPI à parte. A âncora é
  `oraculo_olist_last_order_date()` e a previsão nunca enxerga dados da própria
  semana-alvo — o que torna o **backtest** (painel "previsão vs realizado" na
  tela) honesto por construção.
- Backfill one-shot `oraculo-qty-cache-backfill-once` (pg_cron `:02`, se
  auto-desagenda): rerun de 120 dias dos qty caches. Ele revelou que a
  cobertura de itens pré-agosto exigia re-hidratar os pedidos (semanas de
  julho com ~30% ⇒ unidades subcontadas ~3x). Regra de piso: histórico começa
  em **20/07/2026**, e semana anterior a 03/08 só entra na base/tendência/
  backtest quando a cobertura de itens dela atinge 90%; semana usada com
  cobertura < 90% gera aviso em `calc_note` na tela.
- **Re-hidratação de itens de julho** (migration `20260820150000`, iniciada
  20/08): fila de 45,5 mil pedidos de 20/07–02/08 sem itens, semeada direto
  dos pedidos (a semeadura fiscal só cobre os 66% com NF vinculada; a fila
  passou a aceitar pedido sem NF). Cron a cada 2 min dirige a edge function
  `olist-backfill-order-items` (~100 pedidos/execução ⇒ ~15h) e um
  finalizador horário reescreve o qty cache (35 dias) quando a fila zera e
  desagenda tudo — as semanas de julho entram na previsão automaticamente,
  completando a base de 4 semanas.
- `/status` ganhou a linha "Cache de quantidade (Previsão de Vendas)" — a
  previsão depende inteiramente do job `oraculo-olist-qty-cache` (`:20`) e um
  cache parado é falha silenciosa.
- Export CSV por SKU em `/previsao-de-vendas/export` (mesmas RPCs da página).

## [2026-08-19] — Curvas com refresh agendado e detalhe do pedido preservado

- **Refresh automático das curvas**: as materialized views
  `oraculo_sales_curve_cache` (Curva de Venda por recência) e
  `oraculo_stock_coverage_curve_cache` (Curva de Estoque) tinham funções
  `refresh_*` desde 06/07 que **nunca foram agendadas** — as duas abas mostravam
  o retrato de 06/07, 44 dias atrás. Novo job `oraculo-curves-refresh-daily`
  (08:26 UTC, depois do derived-refresh full das 07:43 que reconstrói
  `olist_products`), rodando como `postgres` com o grant correspondente.
- **Detalhe do pedido deixa de ser destruído**: novo trigger
  `olist_orders_preserve_payload_itens`. O sync com `hydrateDetails=true` salva o
  payload completo (com `itens`), mas a varredura dia-a-dia e as invocações sem
  hydrate gravavam o payload da listagem por cima — nenhum dos 15.766 pedidos dos
  últimos 3 dias tinha `itens`. Sem esse campo o cache do `hydrateOrderDetails`
  nunca valia e cada passada re-buscava todos os pedidos da janela, um a um:
  a varredura de 3 dias levava ~13h e o dia corrente só entrava quando a janela
  já tinha rolado — a base vivia ~1 dia atrás dos canais. O mesmo apagão deixava
  `olist-derived-refresh` sem itens para derivar, jogando tudo no backfill
  overnight.
- `supabase/functions/olist-sync-orders/index.ts` sincronizado com a **v14 que
  está em produção** (deploy de 17/07): paginação retomável por cursor
  (`next_offset` em `olist_order_sync_runs.metadata`), `resume` e `patchRun`. O
  arquivo do repo era a versão anterior, sem cursor — um deploy a partir dele
  teria regredido o sync. Os `504 IDLE_TIMEOUT` a cada `:05` e `:35` são parte
  desse desenho: a função morre no limite de 150s do Edge Runtime e a invocação
  seguinte continua de onde parou.

## [2026-08-19] — Curva de Venda com filtro de período e canal (ABC por volume)

- A aba **/curva-de-venda** ganhou filtro de datas (**De** / **Até**). Com o
  período preenchido a classificação muda de significado: deixa de ser recência
  (A = vendeu nos últimos 90 dias) e vira **ABC clássica por unidades vendidas
  na janela** — A = até 80% do volume acumulado, B = até 95%, C = os últimos 5%
  mais os produtos em estoque sem venda no período. Sem datas, a tela continua
  exatamente como era.
- Novo RPC `oraculo_sales_curve_volume(p_start, p_end, p_channel, p_exclude_no_channel)`: agrega
  `olist_order_items` no período (excluindo pedidos cancelados, mesmo critério
  de `refresh_oraculo_olist_qty_cache`), calcula participação e acumulado por
  produto e junta o estoque de `olist_products`. Sem cache — a janela é livre e
  a base só tem pedidos desde 01/05/2026, então roda direto pelo índice de
  `order_data_criacao` (~3s para um mês; ~9s quando o filtro de canal obriga a
  ler o payload dos pedidos).
- **Filtro de canal** junto do período: *Todos os canais*, *Só marketplaces
  (sem atacado)*, *Só atacado (sem canal)* ou um canal específico. Existe porque
  o atacado B2B distorce a ABC — 2 pedidos sem canal em 08/2026 somaram 63.557
  unidades, mais que qualquer marketplace inteiro, e sozinhos derrubavam a curva
  A para meia dúzia de SKUs. Nada é excluído por padrão; quem decide é a tela.
  A lista de canais vem de `oraculo_sales_curve_channels()`, que lê o cache
  diário por canal em vez de destoastar `olist_orders.payload`.
- No modo período a tabela mostra unidades vendidas, % do volume e % acumulado,
  e o gráfico de barras passa a comparar unidades por curva em vez de contagem
  de produtos. O export CSV acompanha os filtros (colunas e nome do arquivo).

## [2026-08-18] — Termos de Serviço públicos

- Nova página pública `/termos-de-servico`, com condições de acesso e uso da
  plataforma interna, responsabilidades dos usuários, integrações de terceiros,
  propriedade intelectual, disponibilidade, suspensão e legislação aplicável.
- A rota foi liberada no middleware para consulta sem autenticação e vinculada à
  Política de Privacidade. A fonte editorial fica em `docs/termos-de-servico.md`.
- Publicado na raiz do domínio o arquivo de verificação solicitado pelo TikTok
  Developers, com liberação pública restrita à rota exata no middleware.

## [2026-08-17] — Aba Preço × Custo Shopee (análise horária)

- Nova aba **/shopee/precos**: lucro/prejuízo por anúncio/variação das 4 lojas
  ao preço atual, com custo Olist resolvido pela regra validada na planilha de
  16/08 (**anúncio de KIT → valor da aba de kits da Olist; produto unitário →
  preço de custo do cadastro**), QTD por razão de quantidade dos pedidos
  casados, checagem de conflito de modelo (⚠ 80x60 vs 60x60 etc.) e export
  .xlsx com filtros. Substitui a planilha manual
  (`analises/preco-produto-shopee-2026-08/`).
- Cache `oraculo_shopee_price_product_cache` recalculado **de hora em hora**
  pela edge function `shopee-price-product-refresh` (cron `:57`, minuto que só
  tinha o backfill overnight — teto de 2 jobs/minuto respeitado), com auditoria
  em `oraculo_shopee_price_product_runs`.
- Os 4 syncs de produtos Shopee passaram de 4×/dia para **horários** (mesmos
  minutos 22/32/44/52) — sem isso o preço envelheceria 6h e a análise horária
  seria teatro. Custo: ~6× mais chamadas à API de produtos da Shopee.
- Fórmula de lucro: a do Juliano (comissão 20%/14% + taxa fixa por faixa +
  1,3% + 6% + 9,25%×(preço−custo) + 3% + 3% + R$1), documentada no hint da
  coluna.

## [2026-08-17] — Consolidado de fim de semana da Shopee

- O relatório de separação em caixas (`GJHOwusnuXgaxVaT`) passa a usar, às
  segundas-feiras no slot de `13:30`, a janela especial de sábado `13:30` até
  segunda `13:00`. O slot de segunda às `07:00` permanece inalterado.
- A coleta direta da Shopee passa a repetir chamadas GET após falhas transitórias
  de rede, reduzindo o risco de a janela maior terminar com `ECONNRESET`.

## [2026-08-16] — De-para de SKUs: anúncio do marketplace → SKU Olist

- Botão **"De-para de SKUs (.xlsx)"** na aba `/skus`: planilha com 4 abas
  (Shopee, Mercado Livre, TikTok, Não mapeados e ambíguos) mapeando o SKU do
  anúncio de cada canal para o SKU do cadastro Olist — onde a baixa de estoque
  de fato acontece.
- A API pública Tiny v3 **não expõe** o vínculo de anúncios da Olist (só
  `PUT /anuncios/{id}/preco`, sem GET). O de-para é **derivado por evidência de
  venda**: pedidos casados pelo `numeroPedidoEcommerce`, usando só pedidos com
  1 SKU distinto de cada lado (precedente de `oraculo_returns_reconciled`).
  `mapeado` = ≥2 pedidos e ≥80% de dominância.
- A **razão de quantidade** denuncia anúncio de fardo/kit: `CABIDE
  VELUDO-50UN` → razão 50 (1 fardo vendido = 50 unidades baixadas na Olist).
- Cache `oraculo_sku_channel_map_cache` com refresh on-demand na própria rota
  (throttle 6h), **sem novo job de cron** — worker slots no limite.
- Novo: `mercadolivre_order_items` — o `mercadolivre-sync` passou a persistir
  itens de pedido por anúncio/variação (antes só agregava por dia); backfill de
  120 dias executado. TikTok usa as devoluções importadas como fonte (a
  integração direta nunca foi aplicada em produção).
- Detalhes e decisões em `docs/de-para-skus.md`.

## [2026-08-14] — Custo do produto líquido de créditos recuperáveis

- O custo passa a descontar o crédito que volta na apuração, pela origem da
  mercadoria: **−9,25% nacional** (PIS/COFINS não cumulativo) e **−11,75%
  importado** (PIS/COFINS-Importação). O custo bruto do ERP superestimava o
  desembolso real.
- A regra vive em **uma função só** (`oraculo_net_cost`), ligada às três views que
  resolvem custo: `oraculo_product_effective_cost` (motor fiscal),
  `oraculo_sku_unit_cost` (Shopee, Mercado Livre, devoluções) e
  `oraculo_sku_margin_30d` (margem operacional de `/skus`). Kit desconta **por
  componente**, com a origem de cada um.
- Impacto medido (01–14/08): custo de **R$ 1.996.913,36 → R$ 1.777.481,69**, lucro
  fiscal de −R$ 49.567,99 → **+R$ 169.862,34**, margem de −1,30% → **+4,44%** e ROI
  de −2,48% → **+9,56%**. É a primeira vez que a base coberta fecha positiva.
- **Somada à mudança do DIFAL do mesmo dia, a margem do período saiu de −5,16%
  para +4,44% sem que uma única venda mudasse.** O resultado melhorou porque a
  régua mudou — é assim que deve ser comunicado.
- Não há dupla contagem: o PIS/COFINS continua sendo o débito bruto que a NF
  destaca; o crédito aparece uma vez só, do lado do custo.
- O override manual de `/parametros` passa a ser explicitamente **bruto** (o campo
  virou "Custo unitário bruto"); o sistema desconta o crédito.
- A trava de sanidade agora compara o custo líquido com o preço, então algumas
  linhas antes descartadas entraram: receita coberta +R$ 6,37 e impostos +R$ 1,73.
- Pendência: confirmar com o contador que o crédito é integral — fornecedor do
  Simples, produto monofásico ou com ST não geram 9,25% cheios, e a regra hoje é
  uniforme para o portfólio inteiro. Registrado em
  `docs/adr/ADR-005-custo-liquido-creditos.md`.

## [2026-08-14] — DIFAL passa a ser a diferença simples de alíquotas

- Por orientação do contador (Eduardo Faleiros, na planilha de ICMS interestadual
  devolvida em 14/08), o DIFAL deixou de usar a base "por dentro" da LC 190/2022 e
  passou a ser `valor da NF × max(0, interna do destino − interestadual)`. Continua
  existindo só em operação interestadual — venda MG→MG não paga.
- Impacto medido em produção (01–14/08, receita com custo R$ 3.824.978,14,
  cobertura 96,5%): DIFAL de **R$ 570.891,62 → R$ 423.249,36** (−25,9%), imposto
  total de R$ 1.030.082,62 → R$ 882.440,36 (−14,3%), lucro de −R$ 197.210,25 →
  **−R$ 49.567,99**, margem de −5,16% → **−1,30%** e ROI de −9,88% → −2,48%. O
  prejuízo encolhe 75%, mas a operação coberta segue negativa.
- **O motor passa a divergir da NF em mais um campo, de propósito**: na NF 533740
  a nota imprime `vICMSUFDest` R$ 7,21 e o motor calcula R$ 4,45. É o mesmo
  tratamento que o ICMS já tinha (nominal × efetivo do RET). Registrado em
  `docs/adr/ADR-004-difal-diferenca-aliquotas.md`, na ressalva 3 de
  `docs/explicacao-fiscal-oraculo.md` (v5) e nas notas do dashboard e de `/skus`.
- `calcDifalDiferencaAliquotas` entra em `packages/domain/fiscal.js` como espelho
  da função SQL; `calcDifalPorDentro` fica como especificação histórica, com os
  testes da NF 533740 preservados.
- Pendências que continuam abertas: o parecer escrito do contador, a íntegra do RET
  (as 54 linhas de `/parametros` seguem `Pendente`) e o degrau nos sparklines, já
  que as capturas anteriores a 14/08 ficaram com a regra antiga.

## [2026-08-13] — Relatório Shopee convertido em caixas

- O workflow `GJHOwusnuXgaxVaT` passa a enviar às `07:00` e `13:30`, com
  janelas fixas `14:00→06:30` e `08:00→13:00`, respectivamente.
- A planilha de cubagem foi materializada no banco operacional: 77 perfis,
  componentes dos dois perfis `DESTAMPADO` e vínculos explícitos por
  `shop_id + item_id + model_id`.
- Quantidades agora viram caixas completas + unidades avulsas, considerando
  `units_per_sale` para kits. Itens sem vínculo continuam no relatório em
  unidades e com alerta.
- Caixas e sobras dos perfis destampados geram as mesmas caixas e sobras de
  tampas; perfis tampados não são expandidos. Componentes entram no total de
  volumes logísticos.
- Reconciliação conservadora: 440 de 3.954 variações mapeadas, seis ambíguas e
  3.508 ainda sem vínculo. Dois previews reais passaram sem envio ao WhatsApp.
- Depois das partes de texto, o workflow anexa um CSV com unidades físicas,
  caixas, sobras e `shop_id/item_id/model_id/SKU` dos itens vendidos que ainda
  precisam de mapeamento. O slot só é registrado após o envio do documento.

## [2026-08-13] — Etiqueta de palete: texto livre, sem vínculo com o cadastro

- Produto e variações passam a ser **digitados à mão**. Saíram o `<datalist>` de
  produtos da Olist, a coluna "Produto / SKU" do formulário e a derivação
  automática do rótulo. O formulário virou o que foi pedido no início: produto,
  4 variações com quantidade, NF, etiquetas e caixas por palete.
- **Por que**: o primeiro palete de verdade (NF 67554) saiu com
  `Kit pote 10 un 370ml azul 370 - 10 unid.` quando o esperado era
  `Pote de Vidro 370ml - 10 unid.`. O vocabulário do ERP é de anúncio de
  marketplace — nem o `nome` (título de anúncio) nem o `sku` servem como nome de
  produto físico numa etiqueta. O vínculo dava rigor aparente e texto errado.
- `logistica_palete_itens.sku` e `.olist_product_id` viram **colunas legadas**:
  não são mais escritas nem lidas, e ficam no schema apenas para preservar os
  paletes gerados antes da mudança. Sem migration.

## [2026-08-12] — RPA de afiliados Shopee

- Nova aba **RPA Afiliados** (`/rpa`): sobe o Relatório Mensal de Afiliados da
  Shopee em `.csv`, calcula INSS/IRRF/ISS por afiliado, mostra o consolidado e,
  após aprovação, baixa um ZIP com um RPA em PDF por CPF. Documentada em
  `docs/rpa-afiliados-shopee.md`.
- **Por que agora**: desde 01/07/2026 a Shopee opera o repasse como mera
  intermediação — paga o bruto, não retém nada, e a emissão do recibo virou
  obrigação do vendedor. O arquivo de julho tem 772 afiliados.
- **É upload porque a API não abre**: os 4 partner apps seguem com HTTP 403
  `error_api_permission` em `get_conversion_report` (levantamento de 2026-07-27).
- **Primeiro PDF por biblioteca no repo** (`pdf-lib` + `fflate`), desvio
  consciente da política da etiqueta de palete: `window.print()` gera um arquivo
  de N páginas, e a contabilidade precisa de um recibo por pessoa dentro de um
  ZIP. Fontes padrão usam WinAnsi, então nome com caractere fora dela é
  degradado (`?`) em vez de derrubar o lote.
- **`oraculo_rpa_issuers` / `_batches` / `_items` são `service_role`-only**
  (migration `20260812170000`), sem `grant select` para `authenticated` — ao
  contrário da regra geral do AGENTS.md, porque guardam CPF, nascimento e
  endereço de centenas de pessoas físicas.
- **O app passou a consumir `@oraculo/domain` de verdade** (`allowJs` +
  `transpilePackages`). O pacote era só especificação executável; duas
  implementações do mesmo cálculo de dinheiro dariam duas respostas.
- Dinheiro em centavos inteiros, arredondado **por linha**: no arquivo de julho,
  arredondar no fim daria 3 centavos de diferença no total do INSS.
- Verificado com o arquivo real: 772/772 linhas, 772/772 endereços quebrados em
  campos, bruto R$ 26.045,08, INSS R$ 2.864,99, IRRF R$ 0,00 (tabela de 2026
  isenta todo o arquivo), ZIP de 2,31 MB em 4,9 s.
- ⚠️ Pendente com a contabilidade: os coeficientes da tabela do IRRF 2026 e o
  fato de o relatório da Shopee **não trazer PIS/NIT**.

## [2026-08-12] — Documentação do relatório Shopee direto

- Criada documentação operacional completa do caminho Shopee Open Platform →
  n8n → Evolution API → WhatsApp, incluindo regras de período, consolidação,
  paginação das mensagens, dependências, segurança e diagnóstico.
- Registrada a decisão em `ADR-003` e criado um novo snapshot de estado do
  projeto em `docs/project-status-2026-08-12.md`.
- Mapa de deploy, runbook Shopee, Ads, Afiliados, fulfillment, manual da
  diretoria, contexto do projeto e vault interno foram alinhados ao ownership
  atual: n8n renova tokens; funções do Oráculo apenas consomem a réplica.

## [2026-08-11] — Logística: etiqueta de palete com QR Code

- Nova aba **Logística**, primeira sub-aba **Etiqueta**: formulário com produto,
  até 4 variações com quantidade, NF, quantidade de etiquetas e caixas por
  palete. Gera etiquetas 100×150 mm (impressora térmica) já com a caixa de
  impressão aberta. Linha impressa no formato `Pote de Vidro 640ml - 10 unid.`
- **O QR abre a ficha do palete** em `/logistica/palete/<code>` (exige login e a
  aba liberada). Cada palete fica registrado em `logistica_paletes` +
  `logistica_palete_itens` (migration `20260811210000`) — base para cruzar com
  expedição depois.
- **A Olist não tem variação estruturada**: `olist_products` é plana, 1 SKU = 1
  linha, e "640ml" só existe dentro do texto. Por isso cada variação é um SKU
  real do cadastro, escolhido por `<datalist>`, e o rótulo impresso é derivado
  do **SKU** e não do `nome` — o `nome` é o título do anúncio ("Kit 10 Potes de
  Vidro 370ml Hermético Marmita Fit com Tampa 4 Travas - 10 Potes - Azul"), que
  não cabe em etiqueta. O rótulo é editável porque a derivação é um chute.
- Sem lib de PDF: a impressão usa `@page { size: 100mm 150mm }` e o navegador
  salva como PDF quando preciso. Única dependência nova é `qrcode`, gerando SVG
  inline no servidor (PNG sai serrilhado em térmica de 203/300 dpi).
- Detalhes e armadilhas em `docs/logistica-etiquetas.md`.

## [2026-08-11] — Relatório Shopee direto no WhatsApp

- O workflow n8n `GJHOwusnuXgaxVaT` consulta pedidos e itens diretamente na
  Shopee Open Platform, consolida as quatro lojas e todas as variações por
  produto e envia todos os produtos vendidos pela Evolution API, do maior para
  o menor, dividindo listas extensas em partes numeradas.
- O Oráculo deixou de ser fonte do relatório. A antiga RPC
  `shopee_sales_whatsapp_report` foi removida; uma falha do Oráculo não afeta
  a coleta nem o envio das informações.
- O n8n passou a ser o proprietário dos tokens Shopee no workflow
  `Zeptn7GL4bOOsGKj`, com renovação a cada duas horas. O espelho enviado ao
  Oráculo é opcional e não bloqueante.
- Agenda mantida em `06:30` (dia anterior completo) e `12:30` (dia atual).
  Prévia direta da lista completa validada às 12:08 com 1.362 pedidos, 1.450
  unidades e 103 produtos, distribuídos em quatro mensagens.

## [2026-08-10] — Importações: AIS congelado e contêiner entregue no mapa

- **Diagnóstico**: o sync AIS falhava desde 19/07 (86 runs seguidos) com
  `API monthly quota exceeded` — o plano gratuito da VesselAPI dá 150
  chamadas/mês e o sync consumia ~360 (3 navios × 4x/dia). As posições
  ficaram congeladas por 22 dias: o mapa mostrava o EVER OPUS na costa da
  China com os contêineres já entregues em Itapoá.
- **Segundo problema, independente da API**: não existia conceito de entrega.
  O mapa plotava todo navio com fatura, para sempre — contêiner entregue em
  23/07 continuava seguindo um navio que já estava em outra viagem. Isso não
  se resolveria pagando API nenhuma.
- **Troca de provedor**: `importacoes-ais-sync` migrou de VesselAPI (REST)
  para **aisstream.io (WebSocket, gratuito e sem cota)**, que tem a mesma
  cobertura terrestre da paga. A função assina os MMSIs, escuta uma janela de
  75s e encerra; navio sem sinal (alto-mar) conta como pulado, não como falha.
  Chave inválida agora é diagnosticada pelo tempo até o socket cair, em vez de
  virar um genérico "falha na conexão".
- **Status de entrega** (migration `20260810140000`): `delivery_status`
  auto/entregue/em_transito com a regra em
  `importacao_fatura_entregue()` + view `importacao_faturas_status`. O padrão
  segue a chegada prevista; o painel "Entrega dos contêineres" cobre os
  desvios (navio atrasado volta ao mapa, contêiner retirado antes sai). Navio
  sem carga a bordo deixa de ser rastreado.
- **A tela para de mentir**: idade de cada posição no mapa e na lista,
  marcador em rose tracejado acima de 48h, e o alerta de saúde do AIS agora
  aparece na própria `/importacoes` — antes só existia em `/status`.
- Novo `scripts/deploy-edge-function.js` (Management API multipart), que o
  repositório não tinha.

## [2026-08-10] — Aba Agenda: tarefas compartilhadas entre usuários

- Nova aba `/agenda`: cada usuário cria tarefas (título, descrição, prazo),
  inclui outros usuários cadastrados como participantes, e a tarefa aparece na
  agenda de todos os envolvidos. Calendário mensal navegável (`?mes=YYYY-MM`)
  + lista de próximas tarefas, tudo server-rendered no padrão do app.
- Primeira feature com dados por usuário: `oraculo_agenda_tasks` +
  `oraculo_agenda_task_participants` com RLS por linha (só participantes leem,
  via helper `security definer` que evita recursão de policy). Escrita segue o
  padrão do projeto: service-role em Server Actions com autorização no
  TypeScript. Migration `20260810120000` aplicada em produção.
- Aviso in-app: badge por usuário na sidebar contando tarefas pendentes com
  prazo até hoje (`lib/agenda-count.ts`, sem `unstable_cache` — chave global
  vazaria a contagem entre usuários). O badge de `/alertas` foi generalizado
  para um mapa `badges` em `SidebarNav`, sem tocar as páginas existentes.
- Diretório de usuários (`lib/users.ts`): id/nome/email via auth admin API com
  cache de 5 min, exposto a qualquer usuário com a aba Agenda; abas e logins
  continuam restritos ao gate master de `/usuarios`. Mock de dev usa uuid
  sentinela (`local-dev` não existe em `auth.users`).
- Regras: quem cria edita/exclui (masters também); qualquer participante
  conclui/reabre. Sem cron, sem WhatsApp — aviso é o badge, por decisão.
- Verificado: build + 30 testes fiscais, CRUD completo no dev server, RLS
  provada no banco (participante vê 1, intruso vê 0). Após o deploy, marcar a
  caixinha "Agenda" em `/usuarios` para os usuários existentes.
- **Pop-up e sub-tarefas** (mesmo dia, a pedido): abrir uma tarefa agora exibe
  um modal sobreposto (overlay server-rendered, sem JS de cliente — o backdrop
  é um link que fecha ao clicar fora) em vez do painel abaixo do calendário.
  Dentro do pop-up, checklist de sub-tarefas colaborativa
  (`oraculo_agenda_subtasks`, migration `20260810130000`, mesma RLS por
  participante): qualquer participante adiciona, conclui/reabre e remove
  sub-tarefas, com autor da conclusão registrado e progresso `x/y` na lista.
  Participantes não-criadores veem os detalhes e interagem com a checklist no
  mesmo pop-up.

## [2026-08-10] — Diagnóstico visível da margem fiscal negativa

- O bloco `Margem e ROI fiscais` agora explica o prejuízo quando o resultado é
  negativo: mostra quanto custo, impostos e marketplace consomem da receita
  coberta, o total comprometido e quanto falta a cada R$ 100 faturados.
- O diagnóstico usa os valores do período/filtro ativo e mantém explícito que a
  leitura se refere somente à receita com custo confiável.
- No mês corrente, a justificativa também mostra a participação da Shopee no
  faturamento fiscal e os cinco SKUs que mais geram prejuízo, com receita,
  perda e margem individual, usando o snapshot fiscal já materializado.
- A lista acionável exclui tapetes — já reconhecidos pelo negócio — e detalha
  por unidade a venda, custo, tributos e marketplace dos demais ofensores.

## [2026-08-09] — Funil de expedição Shopee × Bip

- `shopee-sync` passa a materializar pacote, prazo, rastreio e status logístico
  sem criar um segundo renovador de token.
- Confirmação real validada: `LOGISTICS_PICKUP_DONE`; entrega concluída também
  prova que a coleta ocorreu. O rastreio vem de `get_tracking_number`.
- Espelho incremental e idempotente dos bipes Comercial/Logística, sem
  dual-write no scanner e com saúde visível em `/status`.
- Nova aba estratégica `/expedicao` e TVs reais do Bip para Comercial e
  Logística, com simulação local como contingência antes da configuração.
- Contrato, segredos, ativação e rollback documentados em
  `docs/fulfillment-pipeline.md`; decisão estrutural em ADR-002.

## [2026-08-09] — Auditoria fiscal e cobertura híbrida da margem

- Auditoria do CNPJ Jacartta, planilhas fiscais de Shopee/Amazon/ML, NFs Olist,
  custo médio, DIFAL, RET, FCP, CBS/IBS 2026 e escrow Shopee documentada em
  `docs/fiscal-audit-jacartta-2026-08-09.md`.
- `oraculo_fiscal_margin_lines` agora parte exclusivamente de
  `oraculo_fiscal_invoices_valid`: uma NF residual status 3 deixou de entrar.
- Fonte híbrida por NF: item do pedido primeiro; item fiscal como fallback.
  Receita continua sendo `vNF` rateado, NF zero permanece zero e a taxa fixa
  do marketplace não multiplica pelos componentes fiscais de um kit.
- Cobertura de agosto: itens 81,45% → 95,95%; custo 79,71% → 93,43%.
  A margem ampliada ficou -4,92%, praticamente igual aos -4,93% anteriores:
  o negativo foi confirmado, não criado pela cobertura parcial.
- Migration `20260809120000` aplicada em produção e snapshot regravado. Os 30
  testes do domínio fiscal seguem passando.

## [2026-08-07] — Relatório IA de Shopee Ads no n8n

- Edge Function `shopee-ads-report-data`: coleta read-only por loja, 30 dias de
  desempenho e settings das campanhas ativas; nunca renova token.
- Camada idempotente `shopee_ads_*` para campanhas, série diária, runs e
  mensagens; RPCs service-role-only isolam o n8n do banco/segredos.
- Workflow n8n `Oráculo - Relatório IA Shopee Ads 3d` (`YpzBJxJkHeMLsunB`):
  08:00 BRT, trava persistente de três dias, regras determinísticas, Ollama Chat
  com schema estruturado, fallback e Evolution API.
- Preview real das quatro lojas: 163 campanhas ativas, 4.890 linhas diárias,
  nove partes abaixo de 3.400 caracteres e zero envios.
- Workflow mantido inativo até o preview final. O nó Ollama legado retornava
  texto vazio; foi substituído por `lmChatOllama` com `qwen2.5-coder:7b` e
  filtros contra causas inventadas. Gemma4/qwen3.5 excederam a memória segura da
  VPS; o qwen2.5 passou no JSON estruturado com payload real.
- Ollama ficou restrito ao resumo da loja; diagnóstico e ação por campanha são
  determinísticos. Resumo com número ou tendência incompatível é descartado.
  Montagem validada sobre a execução `16358`: nove mensagens, máximo 3.379
  caracteres, sem envio pela Evolution.
- Contrato e operação: `docs/shopee-ads-ai-report.md`; prompt:
  `docs/prompts/shopee-ads-analysis-agent.md`.

## [2026-08-07] — Rodada de peso: gru1, cache, paralelização e visual

Diagnóstico completo em `reports/analise-projeto-2026-08-07.md`. Três causas
do app "pesado", três frentes:

- **Functions da Vercel em gru1** (`vercel.json`): rodavam em iad1 (Washington)
  com o banco em sa-east-1 — ~140ms por ida ao banco, várias em série por
  página. Agora ~2ms.
- **Índice parcial fiscal** (`20260807150000`): as views fiscais da home
  faziam seq scan de olist_invoices inteira (2,4-8s por chamada, a query dos
  incidentes de 05-06/08). Com o índice: 60ms.
- **Sessão deduplicada**: `getCurrentUser` em `React.cache` — página e
  AppShell compartilham a validação (antes: 4 round-trips de auth por
  navegação). Leitura do `.env` fallback memoizada (era I/O síncrono
  repetido no request path).
- **Waterfall paralelizado em 15 páginas**: `requireTabAccess`, contador de
  alertas e load de dados agora vão em `Promise.all` (eram 3 esperas em fila).
- **Cache de leitura** (`unstable_cache`): badge de alertas (60s), curvas de
  venda/estoque (5min), `/status` (60s) e `loadMlData`/`loadShopeeData` (5min
  — troca de aba ML/Shopee não refaz mais a paginação da tabela inteira).
  Fetch interno passa ao admin client (cache não lê cookies; dado é global).
- **Visual**: metric card 152→92px sem o padding morto do sparkline e sem o
  glow radial; `--faint` de 3.3:1 para contraste legível; tabelas com zebra,
  hover e th sticky; `.muted` definida (7 blocos de /devolucoes renderizavam
  em 16px branco); `accent-purple`→`accent-violet` em /mais-vendidos.

## [2026-08-04] — Acesso por aba: uma caixinha por aba, por usuário

Antes disto o Oráculo só distinguia **logado** e **não logado**: as 18 páginas
chamavam `requireCurrentUser()` e liberavam tudo. O campo `app_metadata.role`
existia mas era lido num único lugar (`/usuarios`), e mesmo lá o gate era só na
renderização — um POST direto nas Server Actions `createUser`/`updateUser`
passava. `/status`, que expõe tokens e saúde das integrações, aparecia no grupo
Admin da sidebar sem checar nada além da sessão.

No lugar dos perfis nomeados entrou uma matriz explícita: **uma caixinha por
aba, por usuário**, marcada em `/usuarios` e gravada em `app_metadata.tabs`
(sem migration — mesmo padrão que o `role` usava; o RLS `authenticated read`
de `20260710092000` segue valendo, o controle aqui é de navegação).

- **`lib/auth/tabs.ts`** é a fonte única das 15 abas (chave, label, href, grupo
  e os `paths` que cada uma governa). Substitui os arrays `MAIN_LINKS`/
  `ADMIN_LINKS` que viviam soltos no `sidebar-nav.tsx`. Sub-rotas e exports
  herdam a aba-mãe: `/shopee` cobre `/shopee/estoque/export`.
- **`lib/auth/access.ts`** concentra as checagens: `requireTabAccess` nas
  páginas (renderiza `<NoAccess />`, sem redirect para não dar loop na home),
  `assertTabAccess`/`assertMaster` nas Server Actions (lança — fecha o furo do
  POST direto) e `canAccess` nos 7 route handlers de export (403).
- **Administradores são fixos por email** (`juliano@oliverhome.com.br` e
  `oliveiros_cardoso@hotmail.com` — a conta que o Oliveiros usa de fato;
  ajustáveis por `ORACULO_ADMIN_EMAILS`): acesso total e únicos que editam as
  caixinhas.
  A linha deles em `/usuarios` mostra "Administrador — acesso total" no lugar
  das caixas, para ninguém se trancar do lado de fora.
- **A sidebar lista só o que a pessoa pode abrir.** `AppShell` virou async e
  resolve as abas uma vez; o skeleton do `loading.tsx` passou a usar
  `AppShellSkeleton` com o mesmo formato de árvore (um `<nav>` de forma
  diferente deixava nó órfão na sidebar depois do swap do Suspense). A
  `.sidebar` virou flex para o rodapé não esticar quando sobram poucos links.
- **`/` redireciona** para a primeira aba liberada quando Analytics não está
  marcada, e o `next=` do login só é honrado se a aba for permitida.
- **`scripts/backfill-tab-access.js`** (rodar uma vez, aceita `--dry-run`) dá as
  13 abas de Principal a quem ainda não tem a chave — exatamente o que essas
  pessoas já enxergavam. Sem ele, todo mundo ficaria trancado no primeiro deploy.

## [2026-08-04] — Cobertura NF→pedido travada em 6%: três causas empilhadas

Diagnóstico a partir de "por que minha cobertura está em 6%?". O card lê
`order_link_invoice_pct` — % de NFs válidas com pedido vinculado. Agosto marcava
**708 de 11.687 NFs (6,06%)**. O dado existia: numa amostra de 300 links
`unmatched` de agosto, **251 (84%) já tinham o pedido importado**; em julho,
300/300. A cobertura de *itens* da NF seguia sadia (99,98%) — o gargalo era só o
vínculo. Três causas independentes, todas necessárias para o número voltar:

- **O linker era insert-only.** `refresh_oraculo_fiscal_invoice_order_links`
  gravava `unmatched` quando o pedido ainda não existia e nunca reavaliava
  (`on conflict do nothing`). Agora os candidatos incluem os links com
  `order_id null` e o upsert promove unmatched → matched, com guard no `where`
  do `DO UPDATE` para nunca sobrescrever nem desfazer um vínculo bom
  (`20260804180000`). Dispensa o `DELETE` que o runbook de 17/07 exigia.
- **O sync de pedidos rodava a 1/8 da vazão necessária.** O cron
  `oraculo-olist-orders-hourly` usava `maxPages:1` = 100 pedidos/hora (2.400/dia)
  contra ~7.000-9.000/dia reportados pela Olist — o de NFs faz 800/hora. Por isso
  a NF chegava antes do pedido. Vai a `maxPages:6` (600/h, ~2x o volume; o loop
  para sozinho em `completed`) e `lookbackDays` 1 → 3, porque com janela de 1 dia
  um pedido perdido nunca mais era revisitado (`20260804180100`).
- **Regressão do mesmo dia.** `20260804140000_marketplace_fee_in_fiscal_margin`
  recriou `oraculo_capture_fiscal_margin_snapshots()` para levar comissão ao
  payload e copiou a função **sem o bloco final** que `20260713120000` havia
  acrescentado — o que atualiza os vínculos e grava o snapshot `sku_coverage`.
  O snapshot vinha sendo capturado 24x/dia e **parou em 04/08 12:15**, enquanto
  `fiscal_margin_summary` seguiu normal. Sem isso, nenhuma correção de vínculo
  apareceria no card. Restaurado em `20260804180200`.

Aplicação: `docs/runbook-fix-fiscal-coverage-2026-08-04.sql` (as três migrations
+ reconciliação de junho a agosto + regravação do snapshot + conferência).

Pendência conhecida: `supabase/functions/olist-sync-orders/index.ts` está
**atrás do que roda em produção** — a versão deployada tem resume por
`next_offset` (tabela `olist_order_sync_runs`), a do repo pagina sempre do
offset 0. O bundle em produção é minificado; o fonte precisa ser reconstruído a
partir do que está publicado antes do próximo deploy dessa função, senão um
`supabase functions deploy` reverte o resume.

## [2026-08-04] — Devoluções: funil horizontal, uma aba por canal e analytics

- **Uma aba por canal** (`DevolucoesTabs`), com contador de volume. Só aparecem
  canais que têm dado no período — aba vazia sugere que o canal não devolve nada.
- **Funil horizontal** reconstruído sobre uma cadeia que se contém de verdade:
  `Abertas ⊃ Decididas ⊃ Reembolso concedido ⊃ Produto retorna ⊃ NF confere`.
  Cada fita afunila proporcionalmente e o que NÃO avançou é rotulado acima dela.
  Um "funil" cujos estágios não se contêm é um gráfico de barras mentindo sobre
  causalidade — por isso a partição (aguardando/cancelada/recusado/concedido, que
  soma o topo exatamente) virou uma **barra de decisão** separada em vez de
  estágios da mesma cadeia.
- **Analytics no padrão do dashboard principal**: `MetricCard` extraído de
  `app/page.tsx` para `components/metric-card.tsx` (duas cópias divergiriam na
  primeira mudança de design), com sparkline e variação contra o mês anterior;
  área de devoluções por dia; donut de motivos. RPCs novas
  `oraculo_returns_daily` e `oraculo_returns_channels` (`20260804240000`).
  A série diária agrega em **America/Sao_Paulo**: em UTC, tudo aberto após as 21h
  cairia no dia seguinte — ~12% das linhas do TikTok.

### O bug que a comparação entre canais revelou

- **`return_solution` da Shopee estava invertido.** 0 é `RETURN_REFUND` (o produto
  volta) e 1 é `REFUND_ONLY`; o código tinha o contrário. Confirmado no dado: os
  2.534 casos com `solution=0` têm `needs_logistics=true`.
- Efeito: as devoluções **com produto retornando** entravam como `refund_only`,
  que por definição não exige NF de devolução — então o cruzamento fiscal
  simplesmente **não as cobrava**. A Shopee aparecia com 4 casos "NF confere"
  contra 658; ao lado do TikTok (253 de 554) o número era absurdo.
- Corrigido na função e nas 3.803 linhas já gravadas. Shopee: "NF confere"
  **4 → 494**, "sem NF de devolução" 558 → 419.

Julho/2026, três canais, depois da correção: 5.089 devoluções abertas
(R$ 306.614) → 2.519 concedidas → 1.650 com produto retornando → **753 sem NF de
devolução (R$ 39.998)**.

## [2026-08-04] — Devoluções: `/status`, valor do ML e janela quente do cache

- **As rotinas de devolução aparecem em `/status`**: Devoluções Shopee,
  Devoluções/claims ML e o cache de NF de venda. Duas armadilhas resolvidas no
  caminho: `shopee_sync_runs` é multi-fonte (filtro por prefixo de `source`) e
  `mercadolivre_sync_runs` **não tem coluna `source`** — a rotina de devoluções
  passou a se marcar em `meta->>'source'`, senão `/status` mostraria a execução
  do sync principal como se fosse a dela. Alerta novo para cache não atualizado
  no dia: cache parado é falha silenciosa, já custou 45 dias neste projeto.
- **O Mercado Livre não informa valor de reembolso** — o `/claims/search` não traz
  e o `/claims/{id}/returns` falhou nos 4 casos. Em vez de insistir na API, o
  valor vem da **NF de venda já casada pelo número do pedido** (R$ 65,90 e
  R$ 139,90 nos casos conferidos). O ML deixou de sumir dos totais em R$.
  `refund_amount` (o que o canal informou) nunca é sobrescrito: o fallback entra
  em `refund_amount_effective`, com `refund_amount_source` dizendo a origem e a
  tela contando quantas linhas são estimadas. **É o valor do pedido, não do
  estorno** — em devolução parcial superestima, e isso está escrito na tela.
  A checagem de `divergencia_valor` continua usando só o valor informado pelo
  canal. Migration `20260804220000`.
- **Janela quente do cache de NF de venda: 20h → 1h** (`20260804230000`). A regra
  antiga só reprocessava um dia depois de 20 horas — correto para dia fechado,
  errado para o dia corrente, que recebe NF o tempo todo. Uma venda emitida após
  a passagem do cron ficava fora do cache até o dia seguinte, e uma devolução
  sobre ela cairia em `sem_nf_venda`: falso positivo que manda o time procurar
  nota que existe. Ao aplicar, 8.164 NFs de 02–03/08 que estavam paradas entraram.

## [2026-08-04] — Motor fiscal passa a calcular como a NF: base faturada, DIFAL por dentro, custo fora dos impostos

Origem: análise contábil da NF real 533740 (Shopee, MG→RJ, SKU 212961) contra o
que o motor produzia. Migration `20260804190000`; espelho JS
`calcDifalPorDentro` + testes com os números da própria NF (30 no total).

- **Base = valor faturado na NF, rateado por item.** O motor usava o valor do
  pedido; 30% das NFs de 01/08 divergem (cupom do vendedor fica no pedido pelo
  preço cheio, a NF sai pelo pago) e a receita estava **inflada 6,95%**. Caso
  extremo: pedido R$ 149,90 → NF R$ 51,89. O item da NF não serve de base
  direta (kit vira componentes; item da NF também é preço cheio com desconto só
  no `vDesc` do total), então o `vNF` é rateado pela participação de cada item
  do pedido — o que também conserta pedido com 2 NFs (contava em dobro).
- **Custo não entra em imposto** (decisão do negócio: custo é gestão interna).
  PIS/COFINS deixa de ser `max(0, base − custo) × 9,25%` e vira **débito bruto
  `base_NF × 9,25%`**, como a NF destaca. Conservador por construção: o crédito
  das entradas existe na apuração, só não é simulado por linha.
- **DIFAL só interestadual** — venda MG→MG zera (era a ressalva nº 1 do doc de
  explicação: 6/14% indevidos dentro de MG).
- **DIFAL por dentro** (base única, LC 190/2022), como a NF calcula:
  `vNF/(1−interna)×interna − vNF×interestadual`. A NF 533740 prova: 44,51/0,78
  = 57,06 × 22% − 5,34 = **7,21**; o motor antigo dava 4,45 (−40%).
- **Impostos não dependem mais de custo** — linhas sem custo confiável agora
  têm ICMS/PIS/COFINS/DIFAL calculados; só o lucro segue exigindo custo. As
  somas do resumo filtram por `cost is not null` para manter os cards coerentes
  com a base "Receita com custo".
- **Verificado no centavo** em 3 NFs reais: MG zera DIFAL (42 linhas), RJ
  reproduz o gross-up do XML, CE idem. Efeito no mês coberto (01–04/08):
  receita R$ 48,5k → 44,5k, impostos R$ 9,8k → 12,1k, lucro **+R$ 3,6k →
  −R$ 2,4k, margem −5,5%** — a base coberta (tíquete baixo, Shopee-pesada)
  opera no prejuízo quando medida pelos valores realmente faturados.
- Pendências contábeis registradas: Tema 69/STF (exclusão do ICMS destacado da
  base de PIS/COFINS — reduziria o débito) e confirmação do crédito presumido
  RET que sustenta o ICMS efetivo 1,3%/6%/14%.

## [2026-08-04] — Devoluções: Shopee e ML por API, e o dashboard em funil

- **Três canais na mesma camada canônica.** `shopee-returns-sync` e
  `mercadolivre-returns-sync` (novas edge functions) gravam em `oraculo_returns`
  junto com o upload do TikTok. A tela lê só da canônica — trocar upload por API
  não mexe na UI.
- **Volume medido em julho/2026 — três ordens de grandeza:** Shopee ~2.700 ·
  TikTok 1.728 · **Mercado Livre 4**. A tela sempre abre por canal; um
  consolidado apagaria o ML por completo. Volume baixo no ML é volume de venda
  menor no canal, não qualidade melhor.
- **Funil de 8 estágios** (`oraculo_returns_funnel`), SVG server-rendered.
  Os quatro estágios de decisão somam o topo exatamente; os recuados e
  tracejados são recorte, não nova fatia. Julho, três canais:
  3.196 abertas → 464 aguardando · 523 canceladas · 650 recusadas ·
  1.559 concedidas → 843 com produto voltando → **540 sem NF de devolução
  (R$ 28.922)**.

### Armadilhas medidas contra a API real

- **Shopee limita a janela `create_time` a 15 dias.** Pedir 16 devolve
  `error_param` e a janela inteira volta vazia **sem falhar o processo** — o
  dado some em silêncio. A função quebra qualquer intervalo em blocos de 14 dias.
- **Shopee: 4 lojas numa invocação estouram o teto da edge function.** O
  backfill de julho morreu no meio, sem log, deixando a Donacor de fora e a
  Oliverhome parada em 23/07. Mesma causa do `shopee-sync-products`; mesma
  solução: cron **por loja**, escalonado (`20260804210000`).
- **O `/claims/search` do ML ignora filtro de data e ordenação.**
  `date_created_from`, `date_created_to` e `sort=date_created,desc` retornam
  HTTP 200 e não têm efeito: o conjunto vem sempre completo, começando em 2021.
  Só `offset` funciona, e a API exige ao menos um filtro (`stage`/`type`), senão
  400 `atLeastOneFilterProvided`. A função pagina de trás para frente e filtra do
  nosso lado.
- **O funil não fechava**: 464 + 650 + 1.559 = 2.673 contra um topo de 3.196.
  Faltava o estágio `cancelada` (523 — comprador desistiu ou o prazo expirou).
  Perder 16% do topo sem dizer para onde foi é exatamente o que torna funil
  enganoso; corrigido em `20260804200000`.
- **Nenhum dos dois syncs renova token** — renovadores exclusivos seguem sendo
  `shopee-sync` e `mercadolivre-sync`.

Ressalvas escritas na própria tela: é distribuição de estado e não coorte;
"sem NF de venda" não é furo (a base de NFs começa em junho/2026); o casamento
com a NF de devolução é heurístico (CPF + SKU + 90 dias); e reembolso recusado é
vitória financeira, não necessariamente vitória com o cliente.

## [2026-08-04] — Aba Devoluções: camada canônica, upload do TikTok e cruzamento com a NF da Olist

- **A NF de devolução sempre esteve no banco — descartada de propósito.**
  `oraculo_fiscal_invoices_valid` exclui NF de entrada desde
  `20260622180146`. Nova view `oraculo_olist_devolucoes` a resgata. **O filtro
  é `fiscal_origin_type='devolucao'`, nunca `fiscal_invoice_type='E'`**: em
  julho/2026 a origem dá 4.074 NFs / R$ 296.171, o tipo dá 5.446 / R$ 5,58 mi
  porque arrasta compra e importação — 18x de inflação.
- **Camada canônica `oraculo_returns`** (migration `20260803120000`), PK
  `(channel, return_id)`: reimportar atualiza, nunca duplica. Shopee e ML
  entram por API nas próximas fases gravando na mesma tabela; a UI lê só dela.
- **Upload da planilha do TikTok** em `/devolucoes` (`lib/returns-import.ts`).
  Primeira carga real: **1.728 linhas, 3 lojas, 0 erros, 0 duplicadas**.
  As abas têm layouts diferentes (19 vs 25 colunas), então o parser mapeia por
  **nome de cabeçalho**, nunca por posição.
- **`Refund rejected` não é perda** — 635 das 1.728 linhas (37%). Contá-las
  infla a devolução em ~60%. `oraculo_return_counts_as_loss()` deixa só
  `aberta`/`aceita` nos agregados. `refund_only` (474 linhas) também não gera
  NF de devolução: sinalizá-las produziria 474 falsos "sem NF".
- **Cruzamento em dois saltos**: devolução → NF de **venda** por
  `ecommerce.numeroPedidoEcommerce` (exato) → NF de **devolução** por CPF +
  SKU + 90 dias (heurístico, com `match_score`). A NF de devolução tem
  `order_id`/`order_number` **zerados** e bloco `ecommerce` vazio — não existe
  chave direta.
- **Cache `oraculo_olist_order_ref_cache` + cron** (`:07`/`:37`): extrair o
  número do pedido do `raw_json` ao vivo custa **~64 s por mês** (129k NFs,
  tabela de 516 MB, detoast). Nunca pode ir para a tela.

### Três defeitos encontrados e corrigidos pela primeira carga real

- **SKU do canal não casa com o da NF** (`20260804120000`): só 21 de 108 SKUs
  do TikTok existem em `olist_invoice_items` (19%) — a mesma armadilha já
  documentada para a Shopee. Resultado: zero matches exatos e custo unitário
  nulo. Correção: o SKU Olist vem da **NF de venda já casada**, que em 1.084 de
  1.111 casos (97,6%) tem SKU único. Matches exatos: 0 → 277.
- **Cache travava em dia vazio** (`20260804150000`): a função inferia "dia
  processado" pela existência de linhas. Maio/2026 não tem NF (a base começa em
  junho), então todo dia de maio ficava eternamente pendente e o laço girava em
  falso — 62 dias processados, 0 linhas. O cron horário travaria igual, do jeito
  mais caro: rodando, sem erro, sem avançar. Correção: tabela de controle
  `oraculo_olist_order_ref_cache_days`, onde dia sem NF é dia processado.
- **Comparação de valor contra a coluna errada** (`20260804170000`): usava
  `olist_invoice_items.total_value` (preço cheio do item) em vez de
  `olist_invoices.total_amount` (valor da NF). Mediana da razão exatamente
  2,003 — assinatura de erro sistemático. `divergencia_valor`: 327 → 25. Contra
  o `total_amount` o valor bate no centavo, o que confirma o casamento por CPF.

Julho/2026, TikTok: 1.090 devoluções contam como perda, R$ 51.708 estornados.
**334 sem NF de devolução (R$ 16.053)** — o número acionável. 262 sem NF de
venda porque a base de NFs começa em junho e a venda é anterior.

## [2026-08-04] — `/parametros` deixa de ser decorativa: as alíquotas passam a valer

- **`oraculo_state_tax_params` era escrita pela tela e lida por ninguém.** As
  alíquotas de ICMS estavam fixas dentro de `oraculo_fiscal_margin_lines`;
  trocar uma exigia migration e deploy. Agora o motor consulta a tabela por
  linha (**UF + origem da mercadoria + data de emissão da NF**) e usa o
  parâmetro quando `params_configured = true` e a vigência cobre a data.
  Migration `20260804160000`.
- **Duas colunas novas, porque a tabela não conseguia expressar as regras:**
  `merchandise_origin` (entrou na PK — a alíquota interestadual depende da
  origem: importado 4% vs nacional 7/12%; sem essa dimensão, uma linha por UF
  aplicaria a do nacional no importado) e `outbound_icms_rate` (o ICMS de
  **saída** não tinha campo — `icms_rate` sempre foi a alíquota **interna do
  destino**, que só alimenta o DIFAL).
- **FCP ligado e desligado no mesmo dia.** Chegou a somar ao DIFAL nesta
  migration; por decisão do negócio (não se aplica ao portfólio) saiu do cálculo
  e da tela em `20260804180000`. Estava 0% nas 27 UFs, então nenhum número
  mudou nas duas direções — verificado. A coluna fica no banco, zerada, porque
  o trigger `calculate_oraculo_state_tax_difal` a usa em `effective_tax_rate` e
  a volta atrás sai barata.
- **Custo de importado por transferência: pendência fechada, não implementada.**
  A regra `×0,8425` do app Financeiro (crédito de 4% ICMS + 11,75% PIS/COFINS
  na NF de transferência) **não se aplica** — mercadoria que entra por
  transferência e vai para o estoque geral tem o mesmo custo do produto normal.
  O custo cheio que o motor usa está correto. Era o item apontado como maior
  distorção em aberto; não era.
- **27 UFs × 2 origens semeadas com os valores que o motor já aplicava**, como
  `Pendente` — a tela mostrava 27 linhas zeradas que não diziam nada. Validar
  agora é revisar e marcar, não digitar do zero. As linhas placeholder antigas
  (todas zeradas e não configuradas) foram removidas.
- **Verificação em produção:** (1) aplicar a migration não mudou nenhum número;
  (2) validar uma linha semeada produz resultado **idêntico** à regra fixa, o
  que prova que a semente reproduz o motor; (3) mudar ICMS de saída 6→10% e FCP
  0→2% em MG/nacional alterou impostos só nas linhas de MG/nacional, no valor
  exato esperado; (4) revertido, voltou ao baseline.
- Tela `/parametros`: campos **Origem da mercadoria** e **ICMS de saída**,
  coluna `ICMS saída` na tabela (mostra "matriz" quando nulo) e nota explicando
  que só linha `Validado` vale.

## [2026-08-04] — Comissão de marketplace entra na margem fiscal

- **A margem fiscal deixa de ser só tributária.** Até aqui era
  `receita − custo − impostos`; comissão, frete, ads e embalagem ficavam de
  fora, então o número exibido era estruturalmente otimista. Decisão do
  negócio: tratar **frete, ads, embalagem e despesa operacional como já
  embutidos no desconto do marketplace**, em vez de criar uma linha para cada
  um. Migration `20260804140000`.
- **Efeito medido (01/08, 302 linhas com custo):** margem fiscal de **32,3% →
  5,3%**, ROI de 69,4% → 11,5%, com R$ 5.072 de comissão (27,0% da receita).
  Não é piora do negócio — é o número que sempre esteve faltando.
- **`oraculo_marketplace_fee_params`**: faixas como **dado editável**, não
  código. Casadas com `olist_invoices.fiscal_channel_label` via `ilike`
  (menor `match_priority` vence). Shopee 20/14% + fixo por faixa · ML Clássico
  13% + fixo até R$ 78,99 · TikTok 6% + R$ 4 · Amazon 15% · Shein 18% ·
  Kwai 20% + R$ 4. Fontes e ressalvas de cada alíquota em
  `docs/fiscal-financeiro-port.md`.
- **A faixa é escolhida pelo preço UNITÁRIO, não pelo total da linha**, e o
  fixo multiplica a quantidade — nos três marketplaces com degrau o fixo é
  cobrado por unidade e os limites (R$ 28,99 / 49,99 / 78,99 no ML) são por
  unidade. Escolher pela linha jogaria 2 un. de R$ 64,90 na faixa errada.
- **Validado contra dado real:** o escrow da Shopee
  (`oraculo_shopee_take_rate_shop_daily_cache`) mostra take rate de **27% a
  34%** por loja/dia; as faixas produzem 28,5% no mix real de 01/08 — dentro do
  observado e conservador, já que o escrow não inclui ads nem subsídio de frete.
- **Canal sem faixa não inventa comissão**: fica em 0 com `fee_missing = true`
  e a receita é reportada em `revenue_without_fee_params`, com aviso no
  dashboard de que o lucro dessas linhas está superestimado. Hoje o campo está
  zerado (todos os canais ativos têm faixa).
- **Dashboard**: card "Comissão marketplace" (grid de margem fiscal foi para 7
  colunas, `.metric-grid-seven`), lucro passa a descontar comissão e a nota de
  rodapé foi reescrita. `/skus` ganhou a linha de comissão no painel do SKU.
- `packages/domain/fiscal.js`: `MARKETPLACE_FEE_TIERS`,
  `marketplaceKeyForChannel`, `calcMarketplaceFeeForLine` e
  `calcMarketplaceFeeForChannel`, com 5 testes novos (27 no total).

## [2026-08-03] — Cache de SKU estava congelado há 45 dias; margem sai do zero

- **`oraculo-unified-sku-cache` criado (`30 * * * *`).** A função
  `refresh_oraculo_unified_sku_cache()` sempre existiu, mas **nenhum job a
  chamava** — `oraculo-olist-derived-hourly` a pula explicitamente. O cache
  tinha sido populado à mão em **2026-06-19** e ficou parado 45 dias.
  Consequência medida: o alerta de ruptura reportava **5 SKUs** quando eram
  **170**, com **R$ 2,07 mi/mês (17,2% da receita)** em risco — chaleira
  elétrica com 1,5 dia de estoque, as duas balanças zeradas (R$ 335 mil/mês) e
  o kit `213992` com saldo negativo. `/skus`, `/alertas`, a home e a curva de
  estoque liam junho. Roda ~5 min: **só funciona por `pg_cron`**, o caminho da
  API estoura o statement timeout de 2 min e faz rollback da função inteira
  (os dois inserts estão na mesma transação).
- **`oraculo_margin_channel_params` configurada** (2 linhas, `channel_key='*'`,
  antes zeradas com `params_configured = false`): imposto 12,59%, comissão
  23,51% (olist) / 28,83% (shopee), taxa de pagamento 6%, frete R$ 1,00/un,
  embalagem 0. A comissão da Shopee é **medida no escrow real**, não tabelada.
  Fonte das alíquotas: `apps/web/app/calculadora/calculator.tsx:9`. Detalhes e
  advertências de leitura em `docs/glossario-cards-dashboard.md` §3.4.
- **Diagnóstico: 80% da receita aparece como `sem_custo`, e 99,4% disso é
  defeito da view, não custo faltando na Olist.** A CTE `olist_costs` fixa
  `'olist'::text AS source` (539 SKUs / R$ 7,64 mi da Shopee nunca casam) e
  filtra `tipo IS DISTINCT FROM 'K'` (211 SKUs / R$ 3,61 mi de kits, que têm
  custo na Olist). Só R$ 15 mil está genuinamente sem custo. A CTE reimplementou
  resolução de custo em vez de usar `oraculo_sku_unit_cost`, contrariando
  `AGENTS.md:46`. Correção testada — trocar pelo resolvedor canônico leva a
  cobertura do lado Olist de ~1% para **98,8%** — **proposta, ainda NÃO
  aplicada**.
- **Achados de auditoria** documentados em
  `docs/glossario-cards-dashboard.md` ("Achados de 2026-08-03"):
  `oraculo_fiscal_channel_sales` não devolve nenhuma linha de Shopee (esconde
  ~70% do faturamento em qualquer mix de canal); catálogo duplicado entre
  `source` olist/shopee dupla-conta receita; status de produto não normalizado
  entre as duas fontes; `importacao_*` praticamente vazio; histórico fiscal só
  desde 2026-06-01.
- ⚠️ **Dívida registrada:** o cron e os parâmetros foram aplicados direto no
  banco e **não têm arquivo de migration**, somando ao histórico já
  dessincronizado de `supabase_migrations`.

## [2026-07-28] — Mais Vendidos: ranking vira de marketplace; documentação do achado

- **Venda fora de canal saiu dos rankings.** O pedido `663383` (27/07) tem
  213.960 unidades de cabide a R$ 0,84 — dado legítimo no Olist, mas venda
  B2B/atacado lançada direto no ERP (`payload.ecommerce.nome` vazio). É 1
  pedido em 25.365 e sozinho valia mais unidades que todos os marketplaces
  somados, fazendo um cabide virar o produto mais vendido do dia por 200x.
  Agora os rankings são de marketplace; o volume fora de canal continua no
  cache (`has_channel = false`), é devolvido à parte por
  `oraculo_olist_period_coverage` e a tela mostra quando existe.
- **Refresh lê o `payload` uma vez só.** Com a dimensão de canal no cache de
  SKU, o job passou a destoastar o jsonb duas vezes e estourou o
  statement_timeout. Materializa em temp table e reusa: 21 dias caiu de 106s
  para 77s, fazendo mais trabalho.
- **Documentação**: novo `docs/olist-item-coverage-2026-07-28.md` com todas as
  medições (cobertura por dia, custo do payload, análise da Shopee direta como
  fonte alternativa de itens). Regras incorporadas ao `docs/metric-contract.md`
  e às armadilhas do `AGENTS.md`.
- Confirmado que o atraso do importador é variável, não permanente: em 27/07 o
  pedido mais novo era de 26/07; em 28/07 a base já tinha 28/07. A tela segue
  ancorando no último dia com dados.

## [2026-07-27] — Nova aba "Mais Vendidos" + achado: itens cobrem 34% dos pedidos

Nova página `/mais-vendidos` (produtos e lojas por **quantidade**, filtro de
1 / 3 / 7 dias). A primeira versão contava pedidos a partir de
`olist_order_items` e devolvia 1.989 pedidos em 3 dias, contra ~6.890 contados
na Olist. A investigação achou dois problemas reais, não um erro de tela:

- **Cobertura de itens parcial.** `olist_order_items` só tem o detalhe de SKU
  de parte dos pedidos: 26% em 21/07, 58% em 24-26/07, 34% na janela de 7 dias.
  O backfill de itens corre atrás do importador de pedidos, que por sua vez
  reescreve dias já passados (21/07 saiu de ~1.500 para 6.057 pedidos). Contar
  pedidos pelos itens subestimava o volume em ~3x.
  Agora **quantidade** vem dos itens (parcial, rotulada como piso) e **pedidos**
  vem de `olist_orders` (completo), com a cobertura exibida num card e num aviso.
- **Importador atrasado.** Em 27/07 o pedido mais novo da base era de 26/07 —
  por isso o filtro "hoje" vinha vazio. As janelas agora ancoram no último dia
  com pedidos na base e a tela avisa o atraso, em vez de mostrar tela vazia.

Outros ajustes:

- Ranking de **lojas veio para cima** do de produtos: ficava soterrado embaixo
  de uma tabela de 257 linhas e o usuário não achava.
- **Cache diário + pg_cron** (`20 * * * *`, migration `20260727120000`), no
  padrão do take rate Shopee: a janela de 7 dias estourava o statement_timeout
  do compute Nano (a agregação ao vivo custava 8-12s; destoastar o `payload` de
  957 MB é o gargalo). Leitura agora é de tabela pronta, em milissegundos.
- Colunas por loja: quantidade, pedidos, cobertura e participação — dá para ver
  que Shopee Oliver tem mais pedidos que Donacor mas menos unidades apuradas,
  justamente por diferença de cobertura.

## [2026-07-17] — Diagnóstico: margem fiscal travada em 49,5% (importação de pedidos)

Investigação do card "Margem e ROI fiscais" (badge "Cobertura 49,5% da
receita"). A margem exige custo, que só vem por `NF → pedido Olist →
olist_order_items → custo do produto`.

- **Achado**: não é por marketplace (cobertura ~40-52% uniforme em Shopee,
  TikTok, ML, Amazon, Shein). Das 35.869 NFs de julho sem pedido vinculado,
  **0 tinham o pedido importado no banco** — os pedidos não foram puxados da
  Olist (37k importados vs 67k NFs). Como toda NF nasce de um pedido, o pedido
  existe na API; falta importar.
- **Duas engrenagens quebradas**: (1) cron `oraculo-olist-orders-hourly` com
  `maxPages:1, lookbackDays:1` e função `olist-sync-orders` **sem resume**
  (`orderBy=desc`, recomeça do offset 0) → em pico perde tudo além dos 100
  pedidos mais novos/hora, permanentemente; (2) cron
  `oraculo-olist-order-items-backfill-overnight` **congelado numa janela de
  junho** (`2026-06-01→06-19`), não processa julho.
- **Runbook do fix** (executar nesta ordem):
  1. Backfill de cabeçalhos:
     `ORDER_BACKFILL_START_DATE=2026-06-01 ORDER_BACKFILL_END_DATE=2026-07-17 ORDER_BACKFILL_WINDOW_DAYS=3 node scripts/import-olist-orders-full.js`
  2. Re-vincular (SQL editor):
     `select public.refresh_oraculo_fiscal_invoice_order_links('2026-06-01','2026-07-17');`
  3. Hidratar itens (SQL editor):
     `select private.invoke_oraculo_sync_function('olist-backfill-order-items','{"startDate":"2026-06-01","endDate":"2026-07-17","limit":100,"delayMs":1000,"maxRuntimeMs":180000}'::jsonb,240000);`
     e apontar o cron overnight para janela rolante do mês corrente.
  4. Verificar: `select oraculo_fiscal_order_item_backfill_progress('2026-07-01','2026-07-31');`
- **Fix durável (código)**: adicionar resume/offset + escopo de data à
  `olist-sync-orders`, desacoplar cabeçalho de itens e subir o throughput do
  cron — obrigatório para segurar 98% em pico. Detalhes em
  `docs/fiscal-sku-items-coverage.md` (seção "Custo por SKU travado em ~49,5%").

## [2026-07-17] — Cobertura SKU cruza o gate (98%) + speed-up do sync em prod

- **Diagnóstico**: o card "Cobertura SKU" mostrava 97,7% das NFs porque a
  cobertura subia num padrão "serrote" — cruzava 98% perto da meia-noite e
  despencava para ~92% quando as NFs do dia entravam no denominador e a
  varredura recomeçava. Causa: o cron `oraculo-olist-invoices-15m` estava com
  `maxPages: 2` (9,6k detalhes/dia), empatado com a demanda diária, então o
  gate nunca segurava.
- **Ação**: aplicado em produção o `cron.schedule` da migration
  `20260714150000_speed_up_invoice_items_sync.sql` (`maxPages: 2 → 4`,
  ~19,2k detalhes/dia). O ledger de migrations estava parado em 02/07 — a
  mudança nunca tinha chegado à prod. A janela de 3 dias passa a ser varrida
  ~4x/dia e a cobertura segura acima de 98% durante o dia.
- **Resultado**: cobertura de julho passou de 97,7% → **98,09% das NFs**
  (receita coberta 98,53%); o gate de liberação (≥98% das NFs) foi atendido.
- **Residual**: 4 NFs (R$ 195,81, 0,004%) não hidrataram — a de 14/07 se
  auto-resolve pelo cron; as 3 de 13/07 exigem fix de código (fora da janela
  de lookback + cauda antiga de dia de alto volume). Limitação e fix
  recomendado documentados em `docs/fiscal-sku-items-coverage.md` (seção
  "Limitacao conhecida do sync de itens de NF").
- **Docs**: entrada do card "Cobertura SKU / Margem e ROI operacionais"
  adicionada ao `docs/glossario-cards-dashboard.md` (seção 2.7), que não o
  cobria.

## [2026-07-17] — Export .xlsx também nas abas de estoque (Shopee e ML)

Paridade de export entre os canais: além das sugestões, as abas de estoque
agora exportam.

- `/shopee/estoque/export`: planilha com **uma aba por relatório da tela** —
  Ruptura FBS · Cobertura FBS · Parado FBS · Ruptura local · Parado local;
  respeita o filtro de loja (pills) e nomeia o arquivo com a loja.
- `/mercado-livre/export`: Ruptura · Ruptura variações · Cobertura Full ·
  Estoque parado (com ação sugerida e margem unitária).
- `lib/xlsx.ts` ganha `buildXlsxWorkbook([...])` para múltiplas abas; nome de
  aba é saneado (31 chars, sem caracteres proibidos) e aba sem linhas não
  recebe autofiltro. Verificado gerando arquivo com aba vazia e nome inválido.
- `build-estoque.ts` (Shopee) segue a regra da casa: a mesma função alimenta a
  página e o export — a planilha não pode divergir da tela.
- Nota: o fix de layout (`.workspace > *`) é global e já valia para a Shopee;
  a aba de reposição da Shopee já tinha export.

## [2026-07-17] — Fix de layout: tabelas largas não arrastam mais a página

- **Bug**: em telas com tabela larga (sugestão de envio/reposição, 11+ colunas)
  a PÁGINA INTEIRA rolava na horizontal e a sidebar saía da tela.
- **Causa**: `.workspace` já tinha `min-width: 0`, mas seus filhos (`.panel`,
  `.topbar`) são grid items e nascem com `min-width: auto` — incham até o
  tamanho intrínseco do conteúdo. Medido: painel com 1.986px dentro de uma
  coluna de 1.017px, documento rolando 2.258px em viewport de 1.265px, e o
  `.table-wrap` nunca ativando seu próprio `overflow-x`.
- **Fix**: `.workspace > * { min-width: 0 }` (uma linha) — agora só o
  `.table-wrap` rola, a sidebar fica fixa e a página não rola na horizontal.
  Vale para TODAS as páginas do shell, não só as novas.
- Barra de rolagem da tabela passa a ser sempre visível (10px, estilizada nos
  tokens do tema) — no macOS a barra overlay só aparecia ao rolar e ninguém
  descobria que a tabela continuava para o lado.
- Verificado no navegador em 1440px e 1280px: `paginaRolaHorizontal: false`,
  sidebar em `left: 0` antes e depois de rolar a tabela até o fim.

## [2026-07-17] — Export .xlsx das sugestões (ML e Shopee)

- Botão **Exportar .xlsx** nas abas de sugestão; a planilha respeita os mesmos
  parâmetros da tela (alvo, coleta/prazo, curva, loja, itens por loja).
- **Regra de correção**: a lógica de sugestão foi extraída para
  `build-suggestions.ts` em cada canal e é compartilhada por página e rota de
  export — a planilha é, por construção, o que está na tela (não há um segundo
  cálculo para divergir).
- Helper `lib/xlsx.ts` (exceljs): cabeçalho congelado, autofiltro, larguras,
  números como número (não texto), moeda `R$ #,##0.00`, decimais `#,##0.0` e
  linhas de contexto no topo (regra usada, parâmetros, totais, data).
- Colunas do export vão além da tela: MLB/Item ID, SKU, origem, estoque,
  trânsito, alvo em unidades, preço, custo unitário, custo do envio, armazéns
  (FBS) e a justificativa completa.
- Nome do arquivo com carimbo BRT: `oraculo-envio-full_2026-07-16_1432.xlsx`,
  `oraculo-reposicao-shopee_oliverhome_...xlsx`.
- Verificado gerando e relendo um arquivo real (tipos, formatos, autofiltro).

## [2026-07-17] — Tooltips explicativos nos cabeçalhos das tabelas

- `SortableColumn` ganha o campo opcional `hint`: o cabeçalho exibe uma marca
  "?" e um tooltip com a explicação da coluna no hover (CSS puro, sem JS;
  texto também disponível para leitores de tela via `.sr-only`).
- Textos centralizados em `apps/web/lib/column-hints.ts` para que ML e Shopee
  expliquem cada métrica exatamente igual. Cobre Tendência, Curva, Média/dia,
  Perda/dia, Cobertura, Trânsito, Margem, Enviar/Repor, Venda protegida,
  Situação, Armazém e demais colunas calculadas das 4 abas.
- Verificado no navegador: tooltip não é cortado pelo `overflow-x` do
  `.table-wrap` (abre para baixo, sobre as linhas), fonte sans e alinhado à
  esquerda mesmo em colunas numéricas.

## [2026-07-16] — Reposição Shopee: filtro por loja em abas, sem kits, nomes corretos

- Fix: `shopee_shops` não tinha leitura para `authenticated` (migration
  `20260716250000`) — as páginas mostravam o shop_id em vez do nome da loja.
- Filtro por loja vira "abas" (pills) nas duas páginas de estoque/reposição,
  no lugar da coluna/select; com loja selecionada a lista traz os 15 daquela
  loja; em "Todas", a loja aparece na justificativa do item.
- **Kits fora da sugestão de reposição** (detecção por nome "Kit ..."): kits
  são compostos de produtos simples — repõe-se o componente, não o bundle.
  Nota na página informa quantos ficaram de fora.

## [2026-07-16] — Custos ancorados no SKU do marketplace

- Nova view `oraculo_sku_unit_cost` (migration `20260716240000`): resolvedor
  unificado de custo por SKU — override manual (oraculo_margin_sku_params,
  qualquer source) > olist_products (ignorando custos R$ 0, que são a maioria
  no ERP) > custo efetivo de kits. Páginas Shopee e ML passam a usar o mesmo
  livro de custos.
- Cadastro em massa de custos na aba /shopee/reposicao (linhas "SKU valor",
  server action, source='shopee') — pensado para cobrir os 15 itens/loja das
  sugestões primeiro.
- Achado da investigação: o "com custo" do Take Rate contava custos R$ 0 do
  Olist (ex.: SKU 0770 existe no ERP com custo zero); a cobertura real de
  custo era ~nula. O livro manual por SKU do marketplace corrige na origem.

## [2026-07-16] — Shopee: FBS multi-armazém, estoque local e sugestão de reposição

O canal Shopee ganha a mesma analítica do ML — com uma vantagem: as 4 lojas
estão inscritas no FBS (7 armazéns BR) e o módulo SBS da Shopee entrega
velocidade, cobertura, trânsito e janelas de venda prontos por SKU × armazém.

- **`shopee-sync-sbs`** (cron :42): materializa `/api/v2/sbs/get_current_inventory`
  em `shopee_sbs_inventory` + snapshot diário. Oliverhome já opera FBS
  (8 SKUs em ruptura na primeira carga).
- **`shopee-sync-products`** (cron 6h POR LOJA — as 4 juntas estouram o teto
  da edge function): popula `shopee_products` (3.747 modelos, 98% com SKU),
  snapshot diário, e recalcula `shopee_sales_daily` (derivada dos ~46k
  pedidos) + agregados 30/60d via RPCs (migration `20260716220000`).
- **Página `/shopee` com 3 abas**: Take Rate (existente) + **Estoque & FBS**
  (ruptura FBS por armazém com perda R$/dia, cobertura da Shopee, ruptura e
  parado do estoque local, ABC por loja, tendência, filtro por loja) +
  **Sugestão de reposição** (repor = média/dia × (alvo + prazo) − estoque −
  trânsito; FBS limitado ao estoque local p/ envio; justificativa por item;
  máx. 15 itens/loja).
- Diagnóstico da primeira carga: 76 rupturas locais ≈ R$ 12,9k/dia + FBS.
- Regra do renovador único respeitada: novas funções só LEEM o token
  (adiam a loja se faltar <2min); renovação segue exclusiva do shopee-sync.

## [2026-07-16] — Importações: balão do mapa vira popup rolável

- **Bug**: navio com muitos itens (EVER LEADING, 13 itens) tinha o balão
  cortado pela borda do mapa — tooltip do Leaflet vive dentro do container,
  que tem `overflow: hidden`, e estourava o topo.
- **Fix**: tooltip → **popup** do Leaflet, que resolve na raiz: `autoPan`
  reposiciona o mapa para o balão caber inteiro e `maxHeight` rola a lista
  por dentro. Abre no hover e continua aberto enquanto o mouse estiver no
  marcador ou no balão (para conseguir rolar); largura fixa de 250px para o
  texto não quebrar.
- Verificado no navegador com o pior caso: `fitsInsideMap: true`, lista
  rolável (300px visíveis de 2.445px) e último item legível.

## [2026-07-16] — Importações: aba de rastreamento com mapa AIS e cadastro

Porta o MVP local `~/rastreamento-importacoes` para dentro do Oráculo
(migration `20260716180000`):

- **Nova aba `/importacoes`** (sidebar Principal): mapa Leaflet dark com um
  ponto por navio, nome do navio visível no marcador e **tooltip no hover com
  os itens a bordo** (quantidade × descrição), destino, chegada e faturas;
  cards (navios em rota, faturas, itens, próxima chegada) e tabela ordenável
  de embarques.
- **Sub-aba `/importacoes/cadastro`**: formulários (server actions) para
  fatura/embarque com todos os campos do follow-up em Excel, itens por fatura
  (com remoção) e registro de navio (nome oficial + aliases + IMO/MMSI, que
  liga o navio à posição no mapa).
- **Dados**: tabelas `importacao_faturas`, `importacao_itens`,
  `importacao_navios`, `importacao_posicoes` (RLS padrão: leitura
  authenticated, escrita service_role). Seed via
  `scripts/import-rastreamento-followup.js`, que lê o último import da
  planilha `FOLLOW UP - COMPLETO.xlsx` e **considera apenas as linhas ≥ 419**
  (embarques anteriores são antigos e ficam fora) + registro de navios e
  últimas posições AIS do MVP local (9 faturas, 30 itens, 59 navios/posições).
- Novidade de stack: dependência `leaflet` no `apps/web` (client component
  com `next/dynamic` ssr:false; tiles OSM escurecidos por CSS filter;
  `scrollWheelZoom` desligado para não sequestrar o scroll da página).
- **Posições AIS autônomas na nuvem**: Edge Function `importacoes-ais-sync`
  (VesselAPI REST) atualiza `importacao_posicoes` a cada 6h via pg_cron
  (migration `20260716200000`, job `oraculo-importacoes-ais-sync`,
  03/09/15/21h BRT), só para navios citados em faturas e só quando a posição
  é mais recente. Secret no Vault + `x-sync-secret`, runs em
  `importacao_ais_sync_runs` com linha própria no `/status`. A coleta local
  do MVP (`~/rastreamento-importacoes`) deixou de ser necessária.

## [2026-07-16] — ML: aba "Sugestão de envio Full" com justificativa por item

- Nova aba `/mercado-livre/envio` (tabs na própria página): sugestão de
  reposição com a regra Magiic — `enviar = média/dia × (dias de estoque alvo +
  dias até coleta) − estoque Full − trânsito`, parâmetros ajustáveis no topo
  (alvo 7–90d, coleta 0–30d, filtro por curva).
- Cada item traz o **porquê** sob o título: curva ABC, velocidade/dia com
  rótulo de tendência (crescendo/estável/caindo), situação (Em ruptura com
  perda R$/dia · Crítico <7d · Abaixo do alvo · Fora do Full) e a conta do
  envio (alvo ⇒ un − Full − trânsito ⇒ enviar).
- Inclui anúncios pausados por ruptura (o ML pausa ao zerar; pausado COM
  estoque é decisão do seller e fica de fora) e oportunidades fora do Full
  limitadas ao estoque local disponível.
- Cards: itens sugeridos, unidades, venda protegida (GMV do envio), perda
  estancada/dia; coluna de custo do envio quando o SKU tem custo Olist.
- **Máx. 15 itens por loja** (ajustável na tela): regra de produto — a lista
  serve para executar, não para contemplar. Vale para os dois canais; a
  Shopee nasceu com a mesma regra.
- Refatoração: camada de dados compartilhada em `app/mercado-livre/data.ts`
  (loaders paginados, velocidade, curvas, tendência) usada pelas duas abas.

## [2026-07-16] — ML: variações, margem Olist, trânsito e saúde da Curva A

Segundo pacote do estudo Magiic (migration `20260716160000`):

- **Variações (SKU-level)**: novas tabelas `mercadolivre_variations` e
  `mercadolivre_variation_sales_daily`; o sync ingere atributos, preço,
  estoque Full por variação (inventories por variação) e vendas por
  `variation_id` dos pedidos. Seção "Ruptura — variações" na página (pega a
  cor/tamanho que rompeu dentro de anúncio saudável). Realidade da conta:
  96 anúncios com variação, nenhum com venda em 60d — seção fica vazia até
  venderem, mas o rastreamento é contínuo.
- **Margem unitária via custo Olist**: cruzamento do SKU ML/variação com
  `oraculo_product_effective_cost` (colunas "Margem unit." em ruptura e
  cobertura + card de cobertura de custo). Limite atual é operacional: só
  20/1930 anúncios têm SKU preenchido no ML e 0 variações — preencher os
  SKUs no ML com os códigos do ERP destrava o cruzamento.
- **Estoque em trânsito** (`mercadolivre_transit`): formulário na própria
  página (linhas "MLB123 qtd", server action + service-role); cobertura e
  ruptura passam a somar o trânsito, como a Magiic.
- **Card "Saúde da Curva A"**: % dos itens Curva A fora de risco (ruptura ou
  cobertura crítica).
- Sync: janelas de backfill agora podem exceder 150s do gateway — a execução
  continua em background e é auditada em `mercadolivre_sync_runs`.

## [2026-07-16] — ML: analítica v2 (estudo Magiic aplicado)

Melhorias na página `/mercado-livre` derivadas do estudo da base de
conhecimento da Magiic (concorrente de referência em gestão Full):

- **Velocidade por dias-com-estoque**: a média de vendas passa a ser calculada
  sobre os dias em que o item TINHA estoque (via `inventory_snapshots`),
  extrapolada com piso de 15% enquanto o histórico é curto — a média bruta de
  30d subestimava a venda perdida de itens parcialmente em ruptura.
- **Janela de 60d** (`sold_qty_60d`/`revenue_60d`) como critério de
  probabilidade de venda para ruptura + colunas 30/60d (migration
  `20260716150000`, RPC v2).
- **Backfill de ~120 dias de pedidos** (19,2k pedidos em 2 janelas; novo
  parâmetro `toDaysAgo` no sync — o offset do `/orders/search` satura em 10k,
  períodos longos são buscados em fatias). Habilita a coluna de **tendência
  120/90 · 90/60 · 60/30 · 30/0**.
- **Curva ABC 80/15/5** por contribuição de receita 30d (conta toda), como
  coluna em todos os relatórios + card "Curva A em risco".
- **Ruptura e estoque parado agora cobrem anúncios fora do Full** (badge de
  origem Full/Local), como a Magiic faz.
- **Ação sugerida no estoque parado** (heurística: 120d+ sem venda → avaliar
  retirada; Curva A parada → investigar; demais → ativar promoção).
- **Fix**: paginação das consultas da página — o PostgREST corta em 1.000
  linhas e o catálogo tem 1.930 anúncios; a página anterior analisava um
  subconjunto silenciosamente truncado.

## [2026-07-16] — ML: tópicos ativos, backlog saneado e limpeza automática

- DevCenter topics enabled by the operator; webhook inbox now receives live
  events (items, prices, stock, orders, shipments, payments and others).
- 14,122 stale pending notifications (accumulated before the processor went
  live) bulk-ignored — all predated the 13:55 full sync, whose item refresh
  already captured that state. Processor now handles only fresh events.
- New weekly cleanup cron `oraculo-mercadolivre-notifications-cleanup-weekly`
  (Sun 06:37 UTC, migration `20260716143000`): deletes `ignored`/`processed`
  notifications older than 30 days; `failed` rows kept for inspection.
- Post-fix verification: hourly syncs held correct aggregates for 36h
  (10 stockout items ≈ R$ 2.882/day, steady).

## [2026-07-14] — ML: correção dos agregados 30d, inbox quase em tempo real e /status

- **Fix (correctness)**: o cron horário (`lookbackDays=2`) sobrescrevia
  `sold_qty_30d`/`revenue_30d` com a janela curta, distorcendo ruptura e
  capital parado. Novo RPC `mercadolivre_refresh_item_aggregates` (migration
  `20260714230000`) recalcula os agregados a partir de
  `mercadolivre_sales_daily` (fonte da verdade); `mercadolivre-sync` não
  escreve mais agregados no upsert de itens. Recalculado em produção —
  valores restaurados (10 itens em ruptura ≈ R$ 2.882/dia).
- **Nova função `mercadolivre-process-notifications`** + cron
  `oraculo-mercadolivre-notifications-10m` (`*/10 * * * *`, migration
  `20260714220000` com helper genérico `invoke_oraculo_mercadolivre_function`):
  processa a inbox do webhook; tópicos `items`/`items_prices` atualizam o
  anúncio (detalhe + estoque Full) em até 10 min. Não renova token (regra:
  renovação exclusiva do `mercadolivre-sync`); lote é adiado se o token
  estiver a <2min de expirar. Tópicos do DevCenter ainda precisam ser
  ativados pelo operador para o fluxo receber eventos.
- **`/status`** agora monitora o ML: linha "Mercado Livre (Full)" nas últimas
  execuções + alertas de falha/reautorização/sync não rodou hoje.

## [2026-07-14] — Ingestão analítica Mercado Livre Full (ATIVADA em produção)

- Added migration `20260714203000` with read-model tables `mercadolivre_items`,
  `mercadolivre_sales_daily`, `mercadolivre_inventory_snapshots` and
  `mercadolivre_sync_runs` (service-role writes, authenticated reads via
  grant + policy on base tables).
- Added edge function `mercadolivre-sync` (GET-only ingestion: items, Full
  stock, paid orders 30d) — the single owner of rotating refresh-token renewal,
  guarded by `x-sync-secret` and audited in `mercadolivre_sync_runs`.
- Added `/mercado-livre` page (AppShell + SortableTable): estimated revenue
  loss per day from Full stockouts, stock coverage with 7/15-day thresholds
  and idle capital in fulfillment; sidebar entry "Mercado Livre Full".
- Activated in production on 2026-07-14: migration applied, function deployed,
  `MERCADOLIVRE_SYNC_JOB_SECRET` set (Edge Secrets + Vault), hourly cron
  `oraculo-mercadolivre-sync-hourly` (`55 * * * *`, lookbackDays=2) scheduled,
  web deployed. First 30-day load: 1,928 items (435 fulfillment), 1,932 paid
  orders; initial stockout diagnosis ~R$ 2.881/day of estimated lost revenue.
- Owner decision: keep the current broad DevCenter grant (scope reduction to
  read-only stays as a future recommendation; the sync code is GET-only).
- No existing metrics touched.

## [2026-07-14] — Fundação da conexão Mercado Livre

- Added service-role-only tables for Mercado Livre OAuth state, connected
  sellers, rotating tokens, notification inbox and connection audit runs.
- Added PKCE OAuth callback that exchanges the authorization code and validates
  the connected seller through `/users/me`.
- Added a fast, idempotent notification receiver that validates the application
  ID and queues events without fetching resources in the webhook request.
- Added `scripts/connect-mercadolivre.js` to create a short-lived PKCE state and
  generate the seller authorization URL without reading or printing the Client Secret.
- No Mercado Livre orders/products/financial data or Oráculo metrics were changed.
- Production OAuth validated for seller `112538836` (`JACARTTA ATACADOEVAREJO`,
  site `MLB`) with offline refresh token and successful `/users/me` verification.

## [2026-07-14] — Cobertura SKU passa a medir itens da própria NF

Na Olist toda NF carrega seus produtos — o card "NFs com pedido + itens" (23,5k
de 53,3k, via `olist_order_items`) subestimava a cobertura e sugeria NF "sem
produto", quando o gap real é só fila de sync.

- **RPC `oraculo_fiscal_order_item_backfill_progress`** agora mede cobertura por
  `olist_invoice_items` (itens da NF, sincronizados NF a NF da API Olist), mesmo
  shape de JSON — snapshot `sku_coverage`, loaders e auditorias intactos.
  Migration `20260714120000`. Julho: 46,5k NFs (87,2%), R$ 3,53M (88,3%) de
  receita coberta, 304 SKUs; converge para 100% conforme o sync avança.
- **Margem fiscal não muda:** `oraculo_fiscal_margin_*` segue no caminho
  NF → pedido → itens (custo via `olist_products`), com cobertura própria na
  seção "Margem e ROI fiscais".
- **Dashboard:** card renomeado para "NFs com itens sincronizados", legenda
  "aguardando sync de itens" (antes "ainda em backfill") em `/` e `/skus`;
  removido o pill "Regra: status 6/7 · saída · sem devolução" do header fiscal.
- **Backfill direcionado:** `sync-olist-invoice-items.js` ganhou `--ids-file`
  (processa exatamente as NFs sem itens, sem re-hidratar as demais). Rodado para
  as 6,7k NFs de julho pendentes (gaps de 05-07 e 12-14/07 — dias em que a fila
  do job de 15 min não acompanhou o volume).
- **Sync quase em tempo real:** migration `20260714150000` sobe o job
  `oraculo-olist-invoices-15m` de 2 para 4 páginas por rodada (100 → 200
  detalhes/run; 9,6k → 19,2k NFs/dia), re-hidratando a janela de 3 dias ~4x/dia
  — capacidade acima do volume diário (~4-5k NFs), a fila não acumula mais.

## [2026-07-13] — Sync Shopee trazido para dentro do Oráculo (edge function)

O sync das lojas Shopee saiu do n8n e passou a rodar no próprio Supabase do Oráculo, como o time pediu ("tudo no Oráculo").

- **Tabelas de credencial** no Oráculo (`shopee_app_config/shops/tokens`, RLS service_role). Migration `20260713140000`.
- **Handoff:** n8n `Dc6cFKsiWmI2kDJk` (renovação Shopee) desativado; o Oráculo virou o único renovador de token (a Shopee rotaciona o refresh_token — dois renovadores quebram a auth). Credenciais copiadas máquina-a-máquina, sem exposição.
- **Edge function `shopee-sync`:** assinatura HMAC, refresh de access_token, `get_order_list`+`get_order_detail` página-por-página (progresso persiste, teto 800/run), upsert idempotente em `shopee_orders`/`order_items`, log em `shopee_sync_runs`. Protegida por `x-sync-secret`.
- **Agendamento:** pg_cron a cada 15 min, escalonado por loja. Migration `20260713160000`.
- **Validado em produção:** Donacor (token válido) e Oliverhome (refresh) — sync + upsert OK; caminho do cron (x-sync-secret) OK.
- **Jacartta live:** partner_key cadastrada máquina-a-máquina no Oráculo; teste
  `shop_id=279375549` finalizou com `status=success`,
  `records_fetched=234`, `records_upserted=234`, `error_message=null`; cron
  `shopee-sync-jacartta` criado em `9-59/15 * * * *`.
- **BI — dupla contagem corrigida:** o Olist já importa as vendas Shopee
  (canais "Shopee *"), então somar o sync direto (`source='shopee'`) por cima
  duplicava a receita no "Total multi-canal" (mês: +1.306 pedidos / +R$ 91.952).
  Decisão: **Olist = verdade da receita** — os painéis de receita/consolidado
  filtram `source != 'shopee'` (`loadUnifiedChannelRows` em `page.tsx`); o sync
  direto serve à camada de SKU/itens (`/skus`, por fonte). Consolidado do mês:
  29.779 → 28.473 pedidos (= agregado só-Olist).
- **Escrow sync (ROI/descontos):** nova edge function `shopee-escrow-sync` +
  tabela `shopee_order_escrow` — comissão, taxa de serviço, vouchers, líquido
  a receber e quebra por item via `payment.get_escrow_detail` (o detalhe de
  pedido não traz esses campos). Nunca renova token (regra de ouro: só o
  `shopee-sync` renova); cron 30 min por loja; backlog desde 2026-07-01.
  Validado: take rate real 26–35% por pedido. Migrations `20260713200000` +
  `20260713205000`.
- **Papel das fontes (decisão):** Olist = fonte primária de receita de todos
  os canais; Shopee direta = double-check + dados financeiros p/ ROI. Nova
  view `oraculo_shopee_coverage_check` (Olist × direto por loja/dia) e
  bucketing do Shopee direto corrigido p/ BRT (`America/Sao_Paulo`) na
  unificação. Migration `20260713203000`.
- **Pendente:** backfill histórico do Shopee direto.

**Commits:** `27dcfa5`, `8c49721` (+ schedule/harden nesta leva).

---

## [2026-07-13] — Cobertura SKU: automática, ligada ao filtro e denominador honesto

O painel "Cobertura SKU" lia um snapshot fixo escrito por um script manual para uma janela de junho — então o dashboard de julho mostrava cobertura de junho, e nunca atualizava sozinho.

- Captura da cobertura entrou no **job horário** de snapshots fiscais: primeiro dá `refresh` nos links NF→pedido do mês (senão o denominador defasa e infla o %), depois materializa `sku_coverage` do mês corrente. Migration `20260713120000`.
- Painel **ligado ao filtro**: mês corrente lê o snapshot; janela customizada calcula ao vivo via RPC (grant de execução liberado pro role `authenticated`), com fallback pro snapshot. Rótulo do período no painel.
- Cobertura real de julho corrigida para **~43% da receita / 45% das NFs** (48.219 NFs, 21.689 com item) — antes mostrava os 44,8% de junho sobre uma base de 21,7k NFs porque a tabela de links estava defasada.

**Nota de arquitetura (Shopee):** confirmado que **todas as vendas Shopee (4 lojas) geram NF pelo Olist**. Logo o item da nota já vem do Olist — integrar as APIs Shopee enriquece o canal Shopee (produtos/pedidos), mas **não** muda a cobertura fiscal, que é 100% baseada em NF Olist + item de pedido Olist. O sync das lojas Shopee vive no **n8n** (`~/espacodebicho-integracoes`), não no Supabase. O que move a cobertura é o **backfill de itens do Olist**.

**Commit:** `bd47eec`. **Deploy:** `1rn2ezz7k`.

---

## [2026-07-12] — Identidade visual: logo, favicon e marca

Nova identidade do Oráculo: logomark de **orbe/íris dourado com gema facetada (◆) no centro** — amarra ao motivo de losango dos acentos e da paleta joia. Legível de 16px a grandes formatos.

- **Favicon** (`app/icon.svg` + `favicon.ico` 16/32/48/64 + `apple-icon.png` 180) — abas e atalhos passam a exibir a marca.
- **Logomark no app** via componente `BrandMark` (SVG inline) — substitui o "O" na sidebar e no login; fonte única, idêntica ao favicon.
- **Kit de marca** em `public/brand/`: mark isolado (SVG/PNG), logo horizontal dark e claro, e imagem social 1200×630 (`oraculo-og.png`) para preview de link.
- **Metadata**: título "Oráculo · BI multicanal", descrição, Open Graph/Twitter com a imagem social, theme-color.
- Nome padronizado para **Oráculo** (com acento) e subtítulo "BI multicanal".
- Guia de identidade em `docs/brand-oraculo.md`.

**Commit:** `5bc3d28` (+ `9969492` middleware). **Deploy:** `dtky866qf`.

---

## [2026-07-12] — Dashboard com hero cards (layout aprovado)

A produção agora abre com o layout do mockup aprovado: header "Visão geral" + pills (sync fiscal saudável, período, botão Exportar ouro) e **5 hero cards** — Receita fiscal, Lucro fiscal, Margem, ROI e Cobertura — com valor grande em mono, chip de variação (▲/▼) e sparkline. Tudo com dado real: variação da receita compara com o **mesmo trecho** do mês anterior (12 dias vs 12 dias); lucro/margem/ROI/cobertura usam o histórico de capturas horárias do snapshot (última de cada dia). Deltas somem com elegância sem base de comparação; em janela custom os históricos ficam ocultos. Nova rota `/export-fiscal` (CSV da receita diária). Migration `20260712100000` libera leitura do histórico de snapshots pro role authenticated. Seção de margem perdeu os cards duplicados (Lucro/Margem/ROI agora só no hero).

**Commit:** `e401a4f`. **Deploy:** `95tsf4huw`.

---

## [2026-07-12] — Calculadora: presets de marketplace

Seletor de marketplace nas faixas de comissão: **Shopee** (faixas originais, intocadas), **ML Clássico** (13% padrão; público 10–14% por categoria), **ML Premium** (18%; 15–19%) — ambos com custo fixo por unidade até R$ 78,99 (R$ 6,25/6,50/6,75) — e **TikTok Shop** (6%; 5–8% por categoria + R$ 4 fixo/item até R$ 78,99, vigente fev/2026). Faixas com tamanho variável por preset, tudo editável, "Restaurar padrão" volta ao preset selecionado, notas honestas sobre o que não é modelado (regra de 50% do ML abaixo de R$ 12,50; SFP ~6% do TikTok).

**Commit:** `36f08a1`. **Deploy:** `b225adqn3`.

---

## [2026-07-11] — Calculadora de Precificação como feature do Oráculo

Porte fiel da calculadora.oliverhome.com.br para dentro do Oráculo (`/calculadora`, novo item na sidebar). Mantém as regras **próprias** da calculadora (norte rápido de precificação): modos por markup e por preço, kits, taxas editáveis (ICMS MG, DIFAL, PIS/COFINS sobre valor agregado, ads, custo fixo, reembolso) e faixas de comissão editáveis com restauração de padrão. **Não usa nem altera o motor fiscal do Oráculo** — nota explícita na página. Status Rentável / Margem baixa (<10%) / Prejuízo.

Validação: teste de paridade extraiu o `calculate()` do app.js original e comparou 7 casos (bordas de faixa, kit, modo preço, custo zero) — todos idênticos, incluindo o exemplo validado do vault (lucro R$ 12,94 / margem 10,35%).

**Commit:** `ffa1edb`. **Deploy:** `dev40aeho`. O site original continua no ar na VPS, intocado.

---

## [2026-07-10 noite] — Consistência de dados entre páginas

**Badge de alertas verdadeiro e global:** o badge da sidebar mostrava no máximo 8 (derivado das 8 linhas que o dashboard buscava) e só aparecia no dashboard; o /alertas contava as 120 linhas da página. Agora `loadActionableAlertCount()` faz contagem exata (~1,9k acionáveis) e toda página passa ao AppShell; cards do /alertas usam contagens exatas da base inteira e a tabela declara "mostrando os 120 mais urgentes de N".

**Painéis fiscais respeitam o filtro:** margem/donut/gauges/canais liam snapshot fixo do mês corrente e ignoravam o filtro de data. Modo híbrido: mês corrente → snapshot; janela custom → RPC ao vivo com try/catch (timeout degrada pra "indisponível" em vez de mostrar o mês errado).

**Snapshot de hora em hora:** captura fiscal passou de 1×/dia (06:20) para horária (migration `20260710190000`, retenção 14 dias) — defasagem intradia cai de até ~18h para ≤1h.

**Nota auxiliar no /pedidos:** deixa explícito que a visão é por pedidos (data do pedido), não a receita fiscal oficial.

**Commit:** `b42ba8d`. **Deploy:** `3j06vr7kk`.

---

## [2026-07-10 tarde] — Sidebar global + correções de cálculo + melhorias gerais

**Shell global:**
- Sidebar presente em **todas** as páginas autenticadas (antes só no dashboard) via `AppShell` + `SidebarNav` (link ativo automático por pathname). Back-links "← Analytics" removidos.
- `app/loading.tsx`: skeleton shimmer com a sidebar sólida — navegação com feedback instantâneo.

**Correção de cálculo (bug real):**
- `parseMoney`/`asNumber` assumiam pt-BR e inflavam strings `"123.45"` em **100×** (removiam o ponto decimal como se fosse milhar). Parser agora detecta o formato (vírgula → pt-BR; vários pontos → milhar; ponto único → decimal).
- Ticket médio com 0 unidades mostrava a receita inteira como ticket; agora mostra "-".

**Gráficos:**
- Área de receita: linha de média tracejada (ouro), marcador do último dia, eixo x com datas (primeiro/meio/último).
- Donut de impostos: valores R$ na legenda além dos percentuais.

**Tabelas:**
- `SortableTable` genérico (células serializáveis) aplicado em `/alertas`, `/curva-de-venda`, `/curva-de-estoque` — **todas** as tabelas do app agora ordenam por clique.

**Commit:** `43d418e`. **Deploy:** `d8bxw0g71`.

## [2026-07-10] — Dark theme + fiscal snapshots + sortable tables

**Theme & visual redesign:**
- Switched to dark theme inspired by "4 levels" design: cool near-black background (#0b0e15), ouro accent (#f6c453), jewel palette for data viz (indigo/violet/cyan/emerald/rose).
- KPI cards now feature colored top-rail (2px) with subtle accent glow.
- Numbers in monospace tabular throughout.

**Fiscal layer robustness:**
- Materialized three fiscal snapshots (nightly via pg_cron): `fiscal_margin_summary`, `fiscal_sku_margin`, `fiscal_channel_metrics`. Eliminated on-the-fly RPC calls that exceeded statement timeout.
- All dashboard queries tested under authenticated role; none timeout.
- Dashboard degrades gracefully if snapshot unavailable (never crashes).

**Charts:**
- Three new SVG server components: tax composition donut (ICMS/PIS/DIFAL %), margin/ROI gauges, daily revenue area chart with gradient + peak marker.

**Table interaction:**
- `/skus` table now sortable by clicking headers (Receita, Un., Ticket, Margem, ROI, Margem fiscal, ROI fiscal, Var., Estoque, Cobertura, etc.).
- Sorting defaults to descending for numbers, A→Z for text; nulls always last.

**Migrations:**
- `20260710160000` — tax split (ICMS/PIS/DIFAL) added to fiscal margin snapshot.
- `20260710170000` — channel metrics materialized to snapshot.

**Commits:**
- `78a8ed9` — Dark theme foundation
- `4b1484c` — Phase 2: jewel accents + top-rail KPI cards
- `22a7e06` — Phase 2 charts: donut, gauges, area
- `65b4924` — Fix dashboard 500: snapshot channel metrics
- `93528ef` — Fix KPI overflow + sortable table

**Deployments:**
- `hta311us5`, `b61jx0l07`, `az9ic9qmv`, `6zxs4f46n`, `55xro0qty` (final)

---

## [2026-07-10 morning] — Fiscal margin per SKU + statement timeout fix

**Fiscal layer:**
- Added per-SKU margin/ROI calculation (Financeiro rules, Jacarta profile, Lucro Real + RET).
- Decomposition in `/skus` detail panel: receita, custo, ICMS, PIS/COFINS, DIFAL, impostos, lucro.
- Dashboard seção "Margem e ROI fiscais" shows consolidado numbers.

**Robustness:**
- Discovered `oraculo_fiscal_channel_metrics` RPC exceeded statement_timeout on live dashboard (Postgres 57014 → HTTP 500).
- Hardened `loadNfMetrics` with try/catch to degrade gracefully.
- Validated all dashboard queries under authenticated role with 8s timeout.

**Migrations:**
- `20260710150000` — materialized fiscal margin snapshots (captured nightly, read instantly on pages).

---

## [2026-07-09–10] — Fiscal margin foundation

**SQL layer:**
- Created `oraculo_fiscal_margin_lines(start,end)` — per-invoice-item fiscal calculation.
- Created `oraculo_fiscal_sku_margin(start,end,limit)` — aggregated by SKU.
- Created `oraculo_fiscal_margin_summary(start,end)` — totals + coverage.
- Created `oraculo_product_effective_cost` view — expands kit costs by component.

**Discoveries:**
- Kit expansion (tipo K by components) increased cost coverage from 29% → 61.5% of fiscal revenue (June 01–19).
- ~47% of lines were kits without direct cost; expanding them to components fixed the coverage issue.

**Migrations:**
- `20260710093000` — fiscal margin layer + product effective cost.
- `20260710094000` — RLS fix for fiscal read chain (ICMS/PIS/DIFAL tables needed grants).

---

## [2026-07-09] — RLS authenticated read + observability

**Security:**
- Migrated business-data reads from service-role to authenticated client (anon key + user JWT) under RLS.
- Service-role now reserved for writes, `/usuarios`, `/status`.
- Added `requireCurrentUser()` to all protected page renders.

**Observability:**
- New `/status` page: Olist token health + last sync/backfill runs.
- Historical logs: `olist_sync_runs`, `olist_stock_sync_runs`, `olist_invoice_sync_runs`, `olist_order_items_backfill_runs`.

**Migrations:**
- `20260710092000` — RLS authenticated read layer.

---

## [2026-07-03 → 2026-07-09] — Performance + data quality

**Data quality:**
- Fixed `formatBrDate` timezone bug (−1 day in `/skus`, `/curva-de-venda`, exports).
- Fiscal test suite: 22 test cases in `packages/domain/fiscal.test.js` (node --test).
- Removed dead code: `OLIST_STOCK_ENDPOINT` unused variable.

**Performance:**
- Dashboard now uses cached views instead of heavy RPCs.
- `/curva-de-venda` and `/curva-de-estoque` read cached Supabase RPCs (backed by pg_cron refresh).

**Migrations:**
- `20260709172000`, `20260709173500`, `20260709184500` — backfill prioritized by revenue.
- `20260710090000` — backfill window moved to overnight UTC (`50 3-8 * * *`).

---

## [2026-07-06] — Inventory curves

- Launched `/curva-de-venda` (sales curve, A/B/C by days since last sale).
- Launched `/curva-de-estoque` (stock curve, A/B/C by months of coverage).
- Both pages support filtering and CSV export.
- Switched to cached Supabase RPCs (`oraculo_sales_curve()`, `oraculo_stock_coverage_curve()`).

---

## [2026-07-03] — Fiscal dashboard MVP

- Official fiscal dashboard based on issued/authorized outbound invoices (status 6/7, excluding devoluções).
- Daily revenue chart by invoice emission date.
- Channel breakdown (Olist, Shopee, direct).
- SKU ranking with operational margin (30d rolling).
- Reconciled Supabase fiscal layer with Olist API (36.055 invoices, R$ 2.7M).

---

## [2026-06 onwards] — Foundation

- Oraculo operations platform built on Supabase + Next.js on Vercel.
- Canonical order/invoice/product sync from Olist API (incremental, pg_cron scheduled).
- SKU ranking, rupture watchlist, stock coverage estimation.
- Manual parameter management per channel, SKU, UF.
- Read-only Shopee Donacor data.
