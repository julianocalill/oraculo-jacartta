# Análise Preço-Produto Shopee — custos preenchidos pelo Oráculo

**Data:** 16/08/2026 · **Arquivo final:** `Análise Preço-Produto - custos preenchidos - 2026-08-16.xlsx`

Planilha do catálogo ativo Shopee (4 lojas: Donacor, Jacartta, Espaço De Bicho,
Oliverhome — 1.598 produtos/variações, snapshot de preços de 14/08 **repuxado em
16/08**) com o bloco "ANÁLISE JULIANO" preenchido: QTD, Custo Unitário, Custo
Olist e Lucro/Prejuízo por anúncio.

## As regras do custo (definidas pelo Juliano em 16/08)

1. **De-para anúncio → produto Olist**: derivado dos **pedidos casados** — o
   mesmo pedido existe na Shopee (Item ID + Variação ID) e na Olist (SKU na NF
   de venda), casado pelo nº do pedido do marketplace. Só entram pedidos
   inequívocos (1 SKU de cada lado). A API pública da Olist/Tiny v3 **não
   expõe** o vínculo de anúncios; por isso a derivação por evidência.
2. **QTD** = quantas unidades do produto Olist o anúncio baixa por venda
   (razão de quantidade dos pedidos casados). Ex.: anúncio "60 unidades" que
   despacha 2× o produto de 30un → QTD 2.
3. **Anúncio de KIT** (existe kit na Olist com aquela composição, ex.:
   "1× 212961"): custo unitário = **o valor da aba de kits da Olist**
   (que exibe o custo médio do componente). A coluna Origem nomeia o kit.
4. **Produto unitário** (sem kit correspondente): custo = **preço de custo do
   cadastro** do produto.
5. Custos **conferidos ao vivo na API da Tiny em 16/08** — o espelho
   `olist_products` do banco estava congelado desde 21/06 (consertado em
   sessão paralela; ver memória `olist-stock-sync-cursor`).
6. **Preços** (colunas I e K): repuxados do sync Shopee do Oráculo de 16/08
   ~13h50 (o sync roda de hora em hora). Coluna H mantém o preço de tabela.
7. **Lucro/Prejuízo (P)**: a fórmula do Juliano, estendida às 1.598 linhas,
   com guarda — fica em branco quando não há custo (antes calculava lucro
   falso com custo zero). Fórmula: preço final − custo − comissão Shopee
   (20% ≤79,99 / 14%) − taxa fixa por faixa (4/16/20/26/28) − 1,3% − 6% −
   9,25%×(preço−custo) − 3% − 3% − R$ 1.

## Colunas adicionadas (V a Y)

| Coluna | Conteúdo |
|---|---|
| **V — SKU Olist** | Produto do ERP que o anúncio baixa |
| **W — Origem do custo** | De onde veio: `venda casada (N pedidos)` / `SKU do de-para` / `SKU idêntico` / `herdado do anúncio (escalado 30→120 un)` / `custo do KIT <sku> (QTD× componente)` — mais ressalvas (`custo de JUNHO`, `CUSTO ZERADO`, `ATENÇÃO`) |
| **X — Pedidos casados** | Quantos pedidos sustentam o vínculo (confiança) |
| **Y — Checagem de modelo** | `ok` ou `⚠` quando dimensão/volume/peso do anúncio conflita com o produto Olist, ou quando a evidência é de 1 pedido só |

## ⚠ Antes de usar para precificar

**Filtrar a coluna Y por "⚠"** e revisar:

- **Linha 71** — anúncio diz Good Pad **60x60**, mapeado no **80x60** (26,19)
  com 1 pedido só de evidência. Custo não confiável até confirmar o que o
  anúncio despacha. (80x60 30un = 212959 = R$ 26,19 · 60x60 30un = 212960 =
  R$ 18,75 — são modelos diferentes.)
- **10 linhas de potes** anúncio "500ml" vs cadastro "550ml" (SKU 214802) —
  evidência forte, provável nomenclatura, mas conferir.
- **123 linhas** com evidência de 1 pedido.
- **91 SKUs com custo zerado no cadastro da Olist** (conferido ao vivo) — só
  se resolve preenchendo o custo no ERP; essas linhas ficam sem lucro
  calculado de propósito.
- **5 SKUs** com valor de junho (a busca por código falhou na API):
  `BALANÇA-COZ`, `KIT6-CUECA-INFANTIL-PRETO/CINZA-G`, `Mop-9 Litros-Preto/Vermelho`,
  `NEXGARD-SPECTRA-7,5-15`, `TOP-LUPO-MAX-G-AZUL-ANIL`.
- **SKU 215511 (areia 4kg)**: campo "preço de custo" no ERP está **errado
  (R$ 111,80)** — o custo médio real é ~28,27 e os anúncios dela são kits,
  então a planilha está certa; **corrigir o cadastro no ERP**.
- 54 linhas com QTD/custo manuais do Juliano foram **mantidas** (nota
  `ATENÇÃO: Olist hoje diz X` quando o valor de hoje diverge).

## Como regenerar (ordem dos scripts em `scripts/`)

Pré-requisitos: `.env` do Oráculo (Supabase + credenciais Olist), venv Python
com `openpyxl`. Os insumos intermediários já estão em `dados/` (snapshot de
16/08); para regenerar do zero, os scripts leem/gravam na pasta apontada por
`ANALISE_DIR`:

```bash
export ANALISE_DIR="$(pwd)/dados"
```

1. `01-derivar-de-para.sql` — de-para (Item ID, Variação ID) → SKU Olist por
   pedidos casados. Rodar com `npx supabase db query --linked --file`.
2. `02-buscar-custos-vivos.py` — custos ao vivo na API Tiny (usa o
   `access_token` já armazenado em `olist_oauth_tokens`; o sync de pedidos o
   renova de hora em hora — **não** mexer no refresh_token).
3. `03-extrair-kits.sql` — composições de kit do espelho `olist_products`.
4. `04-preencher.py` — preenche QTD/Custo/fórmulas na planilha fonte
   (aplica as regras 1–4 e 7).
5. `05-repuxar-precos.py` — atualiza preços (I/K) do sync Shopee do banco.
6. `06-checagem-modelo.py` — gera a coluna Y (conflitos de modelo).

> **ATUALIZAÇÃO 17/08/2026: esta análise virou a aba `/shopee/precos` do
> Oráculo**, recalculada de hora em hora (edge function
> `shopee-price-product-refresh`, cron :57) com export .xlsx. Esta pasta fica
> como registro histórico e referência das regras. O de-para também existe como
> cache `oraculo_sku_channel_map_cache` + export em `/skus/de-para/export`.

## Fontes

- `oraculo_olist_order_ref_cache` + `olist_invoice_items` (lado Olist dos pedidos)
- `shopee_order_items` / `shopee_products` (lado Shopee; sync horário)
- API Tiny v3 `GET /produtos?codigo=` e `GET /produtos/{id}` (custos ao vivo 16/08)
- `olist_products.payload->'kit'` (composições; espelho de 21/06 — composição muda raro)
