# Estado do projeto — 2026-08-21

Snapshot posterior a [project-status-2026-08-19.md](project-status-2026-08-19.md).
Entrega desta data: **a aba `/documentacao` — a documentação do banco**.

## Por que existe

O banco é consumido por Metabase e PowerBI (a conexão já existia), mas não havia
nenhuma documentação de schema. Quem precisava montar um relatório abria o
DBeaver, via uma lista de nomes e adivinhava.

O agravante não era a falta de nomes. Era que **as armadilhas do dado viviam só
no `AGENTS.md`** — um arquivo que quem escreve SQL no Metabase nunca abre.
Qualquer pessoa conseguia produzir, de boa-fé, um relatório errado e não tinha
como saber:

- somar Olist e Shopee conta a mesma venda duas vezes (R$ 12,7 mi contra
  R$ 8,27 mi de NF realmente faturada em 30 dias);
- contar pedidos em `olist_order_items` subestima cerca de 3x;
- devolução por `fiscal_invoice_type='E'` infla 18x;
- `olist_orders.payload` tem 1,1 GB e derruba a consulta que agrupa por canal.

## O que foi feito

### A fonte da verdade é o catálogo do Postgres

A decisão central: as descrições vivem como `COMMENT ON` no banco, e a tela lê
`pg_catalog` em tempo real. Duas consequências que um markdown paralelo não
entrega:

1. **A mesma descrição aparece dentro do Metabase** (Admin → Table Metadata) e
   do DBeaver. Quem nunca abrir o Oráculo ainda assim é avisado.
2. **A tela mostra o banco real.** As migrations descrevem objetos que não
   existem em produção (`product_fiscal_rules`, `product_cost_snapshots`, toda a
   família `tiktok_*` — confirmado no catálogo). Um dicionário escrito a partir
   das migrations nasceria mentindo.

Quatro RPCs `security definer` (migration `20260821120000`), com `revoke from
anon` explícito — sem ele o mapa inteiro do banco ficaria acessível com a anon
key pura, sem login:

| Função | Serve |
|---|---|
| `oraculo_catalog_objects()` | inventário dos 121 objetos com cobertura, tamanho e se `authenticated` lê |
| `oraculo_catalog_columns(p_object, p_search, p_limit)` | colunas de um objeto, ou busca por nome/descrição |
| `oraculo_catalog_functions()` | as funções com assinatura, retorno e quem pode executar |
| `oraculo_catalog_view_sql(p_object)` | o SQL que monta uma view |

`oraculo_catalog_columns` tem `p_limit` com default 400 e a página nunca a chama
sem `p_object` ou `p_search`: o schema inteiro tem 1.456 colunas e o PostgREST
corta em 1.000.

### Cobertura de descrição

| | Antes | Depois |
|---|---|---|
| Objetos descritos | 18 / 121 | **121 / 121** |
| Colunas descritas | 1 / 1.456 | **158 / 1.456** |
| Funções de BI descritas | 0 / 50 | **50 / 50** |

As 158 colunas são as dos 16 objetos que o BI realmente consome (`olist_orders`,
`olist_invoices`, `olist_order_items`, `olist_invoice_items`, `olist_products`,
`oraculo_sku_unit_cost`, `oraculo_sku_current_unified`,
`oraculo_stock_watchlist_unified`, `oraculo_returns`, `oraculo_products_unified`,
`dim_channels`, `dim_order_status`). O resto entra em ondas por domínio.

**A tela é o monitor da própria documentação**: cada objeto tem medidor de
cobertura e `?pendentes=1` é a lista de trabalho. Sem isso a documentação
apodrece invisivelmente — o mesmo modo de falha do cache sem cron que serviu
dados de junho por 45 dias sem nenhum erro.

### As telas

| Rota | Conteúdo |
|---|---|
| `/documentacao` | mapa dos domínios, cobertura, as 3 armadilhas mais caras |
| `/documentacao/perguntar` | busca em linguagem natural — ver `docs/documentacao-perguntar-ia.md` |
| `/documentacao/dicionario` | os 121 objetos, filtros por domínio/tipo/cobertura e **busca por coluna** |
| `/documentacao/dicionario/[objeto]` | colunas, tipos, PK/FK, armadilhas do objeto, SQL da view |
| `/documentacao/funcoes` | as 50 funções de BI (triggers e refresh atrás de `?todas=1`) |
| `/documentacao/receitas` + `[slug]` | 11 receitas testadas contra produção |
| `/documentacao/armadilhas` | as 10 armadilhas, cada uma ligada aos objetos que ela machuca |

A **busca por coluna** é o recurso mais útil para quem monta relatório: digitar
`billed_revenue` no dicionário devolve os 4 objetos que têm essa coluna, com
link para cada um. É uma pergunta que ninguém conseguia responder antes.

Busca sem client JS: `<form method="get">`, filtro no servidor, linkável e com
botão de voltar funcionando — o padrão que já existe em `/skus` e `/pedidos`.

### Decisões de acesso e segurança

- A aba nasce **opt-in** (invisível até ser liberada em `/usuarios`), como
  `/rpa`. Ela lista os nomes de `oraculo_rpa_*` e `shopee_order_escrow` e ensina
  a conectar direto no banco.
- **Mostrar tudo, classificado** em vez de esconder. Esconder criaria a pior
  situação: o Metabase lista o schema inteiro de qualquer jeito, e a pessoa
  encontraria `oraculo_rpa_items` sozinha, sem nenhum aviso. Documentar é o
  controle. A página nunca renderiza uma linha de dado.
- **A senha do banco não aparece na tela e não existe como variável de ambiente
  do web app.** A tela ensina o processo de obtê-la; o valor fica no gerenciador
  de senhas do time e no painel do Supabase.
- A tela diz explicitamente que **a conexão de BI consegue escrever** — ela não
  é somente-leitura por configuração, e esse é o único controle que existe hoje.

### CSS e a exceção de client JS

Primeiro bloco de código multi-linha do app: não havia nenhum estilo de `pre` ou
`code` em `globals.css` (só `.detail-code`, um chip inline de uma linha).
`.sql-block` usa `white-space: pre` + `overflow-x: auto` e rola sozinho, como
`.table-wrap`.

O botão "copiar SQL" é o **único `"use client"`** da aba. A justificativa é a
mesma das outras exceções deliberadas do repo: o propósito inteiro desta área é
tirar SQL daqui e colar no Metabase, e selecionar texto num `<pre>` com rolagem
horizontal é ruim de verdade — o arraste rola em vez de selecionar. Sem JS o
`<pre>` continua selecionável e nada quebra.

## Armadilha nova, para o AGENTS.md

**`drop view ... ; create view ...` apaga todos os comentários da view e das
colunas dela.** `create or replace view` preserva (mesmo oid). O repo derruba e
recria views em pelo menos 4 migrations. Toda migration que derrubar uma view
precisa reaplicar os `COMMENT ON` dela no mesmo arquivo — e a barra de cobertura
em `/documentacao` é o detector de quando alguém esquecer.

## Verificação feita

- As 4 RPCs conferidas contra produção: 121 objetos, 23 colunas em
  `olist_invoices`, 42 em `oraculo_returns_reconciled`, 50 funções de BI.
- Grants: `authenticated` executa, `anon` não.
- **As 11 receitas foram executadas contra o banco de produção** e todas
  devolvem linhas. SQL de exemplo quebrado seria pior que nenhum.
- As 14 rotas respondem 200, todas abaixo de 800 ms.
- Gate de acesso testado com `ORACULO_DEV_TABS`: a aba e todas as sub-rotas
  devolvem `<NoAccess>` para quem não tem a permissão.
- Invariante de layout verificado a 1280px e 720px com o SQL mais largo do banco
  (493 caracteres): a página não rola horizontalmente.
- `pnpm typecheck` limpo; sem erros de console e sem erros no servidor.

## Próximos passos

1. Ondas seguintes de comentário de coluna, guiadas por `?pendentes=1`:
   Shopee (249 colunas), Mercado Livre (129), operacionais (~550).
2. Liberar a aba em `/usuarios` para quem monta relatório.
3. Confirmar no Metabase que as descrições aparecem na Table Metadata — é o
   ganho que justificou escolher `COMMENT ON` em vez de markdown.


## Adendo do mesmo dia — Perguntar, e a saída do Conectar BI

A aba **Conectar BI** foi removida a pedido, com tudo que havia nela (rota,
`connection.ts`, passo a passo das ferramentas e os avisos sobre porta 6543 e
sobre a conexão conseguir escrever no banco).

No lugar entrou **`/documentacao/perguntar`**: a pessoa descreve em português o
que quer saber e recebe o caminho — view, receita e armadilhas. Não devolve
número e não escreve SQL, de propósito: as dez armadilhas deste banco existem
porque são os casos em que o SQL *parece* certo, e uma consulta que roda e
devolve o número errado é pior que nenhuma resposta.

A busca tem dois estágios. O determinístico roda sempre e não depende de nada
externo; a IA local (Ollama na VPS) só escolhe entre os candidatos que ele já
encontrou, e todo nome que ela citar é conferido contra o catálogo antes de
chegar à tela. Sem `OLLAMA_URL` configurado, a aba funciona igual — só sem o
parágrafo escrito por IA.

Detalhes, decisões de ranking e os riscos da chamada direta Vercel → VPS
(autenticação do endpoint e carga sobre uma VPS compartilhada) estão em
`docs/documentacao-perguntar-ia.md`.

## Adendo do mesmo dia — Logística Fase 1: estoque por depósito

O Oráculo começou a ganhar a visão logística/depósito planejada em
`docs/plano-logistica-deposito.md`. A Fase 1 entrega a fundação de dados e o
estoque por depósito:

- **`/logistica` virou hub** (Visão geral · Estoque · Etiqueta). A visão geral
  mostra capital em estoque a custo canônico, disponíveis/reservadas, rupturas
  e capital por depósito; `/logistica/estoque` quebra o saldo do ERP por
  depósito com sinal da watchlist, custo e export xlsx.
- **Três dados que a gente coletava e jogava fora** foram materializados:
  a quebra por depósito (nova `olist_stock_deposits` — o payload de
  `produtos/{id}` não traz depósitos, eles vêm de `GET /estoque/{id}`; a conta
  tem 8 depósitos), os dados de envio de `olist_orders.transportador` (trigger
  `oraculo_olist_order_logistics_fields`, backfill de 371 mil pedidos) e as
  dimensões físicas de `payload.dimensoes` (generated columns em
  `olist_products`).
- **Reconciliação**: soma dos depósitos com `desconsiderar=false` = saldo
  consolidado em ~96% dos produtos varridos; o resto é desvio de timing entre
  a varredura de 16h do consolidado e a busca ao vivo dos depósitos.
- Armadilha nova documentada: `olist_stock_items.reservado` é **sempre NULL**
  (o payload de listagem não traz o campo); o reservado real vem da soma dos
  depósitos com `desconsiderar=false`.

Próximas fases (recebimento, endereçamento por posição, inventário, expedição
multi-canal, picking): `docs/plano-logistica-deposito.md`.

## Adendo de 2026-08-22 — Menu lateral por setores

A sidebar foi reorganizada em Analítico · Comercial · Operações (acordeão
nativo via `<details name>`, setor da página atual aberto, Agenda e Parâmetros
soltos, Admin no rodapé). `sector` é metadado em `lib/auth/tabs.ts`; `group` e
o gate de acesso não mudaram. Ver CHANGELOG [2026-08-22].

## Adendo de 2026-08-22 — Logística Fase 2: recebimento

`/logistica/recebimento` fecha o elo entre importações e o galpão: a fatura
vira uma conferência com os itens esperados copiados de `importacao_itens`, e
o time registra item a item (celular) o que chegou, com divergência
classificada e autoria. Concluída, a conferência fica no histórico; o
lançamento de entrada segue no Olist. Ver CHANGELOG [2026-08-22] e
`docs/plano-logistica-deposito.md` (Fase 3 é a próxima: endereçamento por
posição + inventário).
