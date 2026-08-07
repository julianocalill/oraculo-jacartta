# Análise completa do projeto — 2026-08-07

Três frentes auditadas: infraestrutura/latência, arquitetura de dados do front,
e layout/UX. Complementa a [análise do banco de 06/08](analise-banco-2026-08-06.md).

**A queixa ("o app está pesado") tem três causas mensuradas, que se multiplicam:**

1. **Geografia errada**: as functions da Vercel rodam em iad1 (Washington DC),
   o banco fica em sa-east-1 (São Paulo) e o usuário está no Brasil. Cada ida
   ao banco custa ~140 ms de rede; o app faz dezenas delas **em série** por
   página.
2. **Zero cache e queries em cascata**: todas as 20 páginas são
   `force-dynamic`, refazem até 15 queries a cada navegação, validam a sessão
   2× (4 chamadas HTTP de auth antes de qualquer dado) e algumas puxam tabelas
   inteiras do banco em loops sequenciais sem teto.
3. **Peso visual real**: cards de métrica de 152 px com 46 px de padding morto
   (16 deles na home), 4 camadas de decoração por card, rótulos com contraste
   3.3:1 (abaixo do mínimo legível), tabelas de até 16 colunas sem cabeçalho
   fixo/zebra/hover, e três vocabulários diferentes de navegação.

A conta da home hoje: ~140 ms × (4 auth em série + 1 RPC serial) + 13 queries
paralelas onde a mais lenta é uma view que varre 543 MB (2,4–8 s medidos) =
**3 a 9 segundos por navegação**. Com as correções abaixo: **sub-segundo**.

---

## Parte 1 — Infraestrutura e latência

### 1.1 Functions em iad1, banco em sa-east-1 (CRÍTICO, correção = 1 config)

Medido: `serverlessFunctionRegion` não configurado no projeto Vercel → default
iad1. Deployment atual confirma `"regions": ["iad1"]`. O Supabase está em
sa-east-1 e os usuários no Brasil.

Consequência: cada round-trip ao banco ou à API de auth custa ~140 ms. Como o
app faz chamadas **em série** (auth → auth → alertCount → dados), só de rede
são 500–800 ms por página antes de qualquer processamento — e o usuário ainda
paga Brasil→Virgínia na ida.

**Correção**: Vercel → Project Settings → Functions → Region → **São Paulo
(gru1)** (ou `"regions": ["gru1"]` no vercel.json). Um redeploy e cada
round-trip cai de ~140 ms para ~2 ms. É a maior alavanca isolada de todo o
projeto: multiplica o ganho de todas as outras correções de waterfall.

### 1.2 Auto-deploy esclarecido

Push na main do remote `personal` (julianocalill/oraculo-jacartta) **auto-deploya
produção** (confirmado hoje: commit fdb0982 → deployment READY com alias).
O remote `origin` (Grupo-Jacartta) não dispara nada. Manter os dois
sincronizados: `git push && git push origin main`.

---

## Parte 2 — Arquitetura de dados do front

Auditoria página a página em `apps/web/app`. Resumo: 20 páginas, todas Server
Components, todas `force-dynamic`, **nenhum** `revalidate`/`unstable_cache`/
`Suspense` no repositório inteiro.

### 2.1 Sessão validada 2× por página, 4 round-trips de auth (CRÍTICO)

`lib/auth/session.ts:106-116` — `getCurrentUser()` faz `setSession()` (POST
`/auth/v1/token`) + `getUser()` (GET `/auth/v1/user`) = 2 round-trips HTTP.
Cada página chama isso 2× de forma independente: `requireTabAccess()` no topo
e `AppShell` (`app/components/app-shell.tsx:51`) de novo. Total: **4 chamadas
de auth em série por navegação** (560 ms só disso, de iad1).

**Correção em 2 níveis:**
- Mínima (1 linha): envolver em `React.cache()` — deduplica por request,
  corta metade.
- Completa: validar o JWT localmente (o middleware já decodifica exp em
  `middleware.ts:95-104`; falta validar assinatura com a JWKS pública do
  projeto, que pode ficar em memória) e só ir à API de auth no refresh.
  Elimina os 4 round-trips do caminho crítico.

### 2.2 Waterfall `requireTabAccess → alertCount → dados` em 14 páginas

`loadActionableAlertCount()` (`lib/alert-count.ts`) alimenta só o badge da
sidebar, não depende de nada, e mesmo assim bloqueia **em série** o load dos
dados em 14 das 15 páginas (ex.: `app/pedidos/page.tsx:300-305`,
`app/skus/page.tsx:198-205`). Só `/alertas` e parcialmente a home acertam.

**Correção**: `Promise.all([requireTabAccess(...), loadActionableAlertCount(),
loadX()])` — ou melhor, cachear o alertCount (item 2.3) e tirá-lo do caminho.

### 2.3 Zero cache sobre dados que já são pré-computados

A ironia central do app: o banco JÁ TEM caches horários/30min mantidos por
pg_cron (`oraculo_fiscal_latest_snapshots`, `oraculo_shopee_take_rate_*_cache`,
`oraculo_nf_daily_cache`...) — o trabalho pesado já saiu do request path. Mas o
app refaz o fetch desses valores estáticos **em toda navegação, para todo
usuário**, porque tudo é `force-dynamic` sem `unstable_cache`.

**Correção**: `unstable_cache` com TTL de 60–300 s em: `loadActionableAlertCount`,
`loadFiscalDashboardSnapshot`, `loadFiscalMarginSummarySnapshot`,
`loadSalesCurve`, `loadStockCurve`, `loadStatus`. Navegações repetidas passam a
custar ~0 queries.

### 2.4 Loops de paginação sem teto puxando tabelas inteiras (ML e Shopee)

`app/mercado-livre/data.ts:160-207` — `fetchAllPages` puxa TODOS os items
(1000/vez, em série), depois `mercadolivre_sales_daily` de 120 dias × MLB,
e agrega tudo em JS a cada request. `/mercado-livre` e `/mercado-livre/envio`
rodam o MESMO `loadMlData()` completo — trocar de aba refaz tudo. Idem
`loadShopeeData()` em `/shopee/estoque` e `/shopee/reposicao`
(`app/shopee/page.tsx:119-131`).

**Correção**: mover a agregação para o banco (RPC ou cache diário pg_cron, o
padrão que o projeto já usa bem) e retornar só o resultado. Enquanto isso não
sai, `unstable_cache` de 5 min sobre `loadMlData`/`loadShopeeData` elimina o
refetch na troca de aba.

### 2.5 Sem Suspense: a página inteira espera a query mais lenta

Nenhum `<Suspense>` no repo. A home (1505 linhas) trava hero cards, gráficos,
top SKUs e watchlist atrás do mesmo await. O `loading.tsx` global dá um
skeleton, mas nada aparece até a última das 15 queries voltar.

**Correção**: quebrar a home em 3–4 seções com `<Suspense>`: hero cards
primeiro (dados do snapshot, rápidos), fiscal/gráficos streamando depois.
Percepção de velocidade muda completamente mesmo sem acelerar nenhuma query.

### 2.6 Achados menores (lista de execução)

- Curvas ABC sem `.limit()`: todo o catálogo vai no HTML
  (`curva-de-venda/page.tsx:70`, `curva-de-estoque/page.tsx:80`,
  `importacoes/data.ts:74-81`).
- Filtros `<form method="get">` que só fatiam dados já carregados forçam
  reload completo (8 formulários; ex. `?curva=A` em
  `curva-de-venda/page.tsx:107-109`).
- `/pedidos` roda os 2 counts JSON que a home documenta como "caros demais"
  (`pedidos/page.tsx:173-186` vs `page.tsx:410-424`).
- `/parametros` puxa 5000 linhas para calcular 3 números
  (`parametros/page.tsx:250-266`) — devia ser agregação no banco.
- I/O síncrono no request path: `lib/supabase/admin.ts:33` lê .env do disco
  ANTES de checar `process.env`; `lib/auth/access.ts:24` repete isso a cada
  `isMaster()`. Inverter a ordem + memoizar.
- Service-role em leitura de dados de negócio em 3 páginas
  (`shopee/page.tsx:134`, `devolucoes/page.tsx:160`, `status/page.tsx:145`) —
  segurança, não perf.
- Não existe `error.tsx` nem `not-found.tsx`.

---

## Parte 3 — Banco (novidades desta rodada)

### 3.1 View fiscal ao vivo varrendo 543 MB por chamada (CRÍTICO)

`oraculo_fiscal_daily_revenue` → `oraculo_fiscal_invoices_valid` → seq scan
completo de `olist_invoices` a cada SELECT. Medido com EXPLAIN ANALYZE:
**2,4 s** (53 mil páginas, 44 mil do disco) para devolver 31 linhas.
pg_stat_statements mostra 6 variantes dessa query entre as mais lentas do
sistema, 3–8 s de média, centenas de chamadas — é a query que estourava o
statement_timeout nos incidentes.

**Correção** (escolher uma):
- Índice parcial covering:
  ```sql
  create index concurrently olist_invoices_fiscal_valid_date_idx
  on olist_invoices ((emission_date::date)) include (fiscal_amount)
  where status in ('6','7') and fiscal_invoice_type <> 'E'
    and fiscal_origin_type <> 'devolucao';
  ```
  Leva a query de 2,4 s para ~5 ms sem mudar código.
- Ou apontar o app para `oraculo_nf_daily_cache` (que já existe e é
  atualizado de hora em hora) e deixar a view ao vivo só para drill-down.

### 3.2 Pendências da análise de 06/08 (continuam valendo)

- Dropar 3 índices mortos (23 MB de escrita inútil por update):
  `mercadolivre_notifications_seller_topic_idx`,
  `olist_invoice_items_invoice_number_idx`, `olist_orders_numero_ordem_compra_idx`.
- Churn de updates: `olist_orders` tem 4 M updates para 292 k linhas com **0%
  HOT** (o índice em `synced_at` força reescrita dos 10 índices a cada upsert).
  Upsert condicional (`where data_atualizacao is distinct from excluded...`)
  + avaliar dropar `olist_orders_synced_at_idx` (4 scans na vida útil).
- `work_mem` nas funções de cache: 304 GB acumulados de arquivos temporários.
  `set local work_mem = '32MB'` dentro das `refresh_*`.
- Autovacuum mais agressivo nas tabelas de churn alto.

---

## Parte 4 — Layout/UX (o "pesado" visual)

### 4.1 Os 8 problemas por ordem de impacto

1. **Metric cards comem a dobra**: 152 px de altura com 46 px de padding-top
   morto (reservado para sparkline que só existe na home), grid de 6–7
   colunas, 16 cards na home, 4+ na maioria das páginas. 300–450 px de rolagem
   antes do primeiro dado acionável. Cada card: sombra + barra de acento +
   glow radial + hover lift. **Correção**: card de ~92 px, `grid-template-areas`
   para o spark, só borda (sem glow/sombra pesada).
2. **Navegação em 3 camadas com 3 vocabulários de "ativo"**: sidebar plana de
   15 itens sem ícones (`.nav-active` = gradiente dourado), pills de sub-seção
   (`.pill-gold` = fundo dourado), chips de filtro (`.chip-active` = borda
   dourada). **Correção**: um vocabulário só; agrupar sidebar com ícones.
3. **Densidade invertida**: ~80 px de moldura (workspace 24 + panel 22 +
   section-head 16) em volta de dados de 11–13 px. BI pede o contrário.
4. **Contraste reprovado**: `--faint` #5d6980 ≈ 3.3:1 é a cor de TODOS os
   cabeçalhos de tabela, labels de card (10.5 px), eyebrows. **Correção**:
   subir para ~#8593ab (1 linha no :root).
5. **Tabelas de até 16 colunas sem afordances**: sem zebra, sem hover, sem
   thead sticky, sem paginação, `nowrap` em tudo. **Correção**: sticky +
   hover + zebra = ~6 linhas de CSS.
6. **28 classes usadas mas nunca definidas**: `.muted` em 7 parágrafos de
   /devolucoes renderiza texto explicativo em 16 px branco puro (mais pesado
   que os dados); `accent-purple` (só existe `accent-violet`) deixa card sem
   acento em /mais-vendidos.
7. **MetricCard usado em 2 de 21 páginas**: 50 cópias manuais do markup nas
   outras. Pré-requisito para o item 1 pegar em todo lugar.
8. **Skeleton mente**: `loading.tsx` único (6 cards + painel) para todas as
   rotas, com sidebar VAZIA (`tabs={[]}`) — o menu some e volta a cada
   navegação. **Correção**: `loading.tsx` por grupo de rota + passar tabs
   estáticas do usuário.

Menores: fonte "Aptos" não existe fora do Office (cai em Segoe UI/system-ui —
tipografia diferente por SO; pesos 650/750/850 sintetizados); 18 tamanhos de
fonte e 9 radius distintos (falta escala); `.single-workspace` existe e nunca
é usada (ultrawide estica tabela de 15 colunas pela tela inteira); 57 styles
inline; 4 aliases de cor duplicados nos tokens.

### 4.2 O que está bom e não deve ser mexido

- Tokens semânticos do :root (base certa — não trocar por Tailwind).
- `MetricDelta.invert` (verde/vermelho semântico por métrica) — sofisticação real.
- `SortableTable` + 71 hints de coluna (conhecimento de domínio valioso).
- Charts em SVG server-rendered, zero biblioteca (bundle JS de ~150 KB total).
- `lib/auth/tabs.ts` como fonte única de menu/gate/permissões.
- Scrollbar sempre visível no table-wrap, `min-width: 0` defensivo, skeleton
  com `prefers-reduced-motion`, `aria-current`/`sr-only` pontuais.

---

## Plano priorizado (impacto ÷ esforço)

| # | Ação | Esforço | Ganho |
|---|---|---|---|
| 1 | Functions → gru1 (config Vercel) | minutos | −0,5 a −1,5 s TODA navegação |
| 2 | Índice parcial fiscal (3.1) | minutos | home: −2 a −8 s |
| 3 | `React.cache` no `getCurrentUser` | 1 linha | −2 round-trips/página |
| 4 | Paralelizar alertCount + tabAccess + dados | 1 h | −1 round-trip serial/página |
| 5 | `unstable_cache` TTL 60–300 s nos snapshots | 2–3 h | navegação repetida ≈ instantânea |
| 6 | Card 152→92 px + contraste `--faint` + sticky/hover/zebra | 2–3 h | o "pesado" visual some |
| 7 | Corrigir 28 classes fantasma (`.muted`!) | 1 h | /devolucoes para de gritar |
| 8 | Consolidar MetricCard nas 14 páginas | 3–4 h | pré-req do 6 valer em tudo |
| 9 | `unstable_cache` em `loadMlData`/`loadShopeeData` | 1 h | abas ML/Shopee −70% |
| 10 | Suspense na home (hero primeiro, resto streama) | 3–4 h | percepção de velocidade |
| 11 | Limites nas curvas ABC + agregação de /parametros no banco | 2 h | HTML menor |
| 12 | Pendências do banco de 06/08 (índices mortos, HOT, work_mem) | 1–2 h | menos I/O de fundo |
| 13 | Skeleton por rota + sidebar persistente no loading | 2 h | navegação estável |
| 14 | Sidebar com ícones + vocabulário único de "ativo" | 1 dia | orientação |
| 15 | Mover agregação ML/Shopee para o banco (padrão cache diário) | 1–2 dias | elimina loops sem teto |

Itens 1–5 juntos: navegação típica sai de 3–9 s para **menos de 1 s**, sem
tocar em layout. Itens 6–8: a sensação de peso visual. O resto é consolidação.
