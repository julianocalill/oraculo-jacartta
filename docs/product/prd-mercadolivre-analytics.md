> **Proveniência (2026-07-16):** este PRD foi escrito em 2026-07-14 para um
> produto SaaS standalone de analytics do Mercado Livre (protótipo em
> `~/full`, hoje aposentado), inspirado no estudo da plataforma Magiic
> (magiic.com.br). A decisão registrada no decision-log foi construir a
> analítica DENTRO do Oráculo — o que foi feito: ver
> `docs/mercadolivre-integration.md` e `docs/project-status-2026-07-17.md`.
> O documento permanece como registro da tese de produto (wedge analítico,
> ruptura como "aha", pipeline histórico como ativo) e do roadmap original,
> parcialmente entregue e superado pela realidade do Oráculo (custo Olist,
> multicanal). Mantido no original, sem edições.

# PRD — Plataforma de Analytics para Mercado Livre Full
### (inspirado na Magiic, escopo apenas analítico / BI)

> **Status:** rascunho v1 · **Objetivo desta fase:** validar o negócio rápido com sellers reais
> **Autor:** Juliano · **Data:** 2026-07-14

---

## 1. Visão em uma frase

Uma plataforma que se conecta à conta do vendedor no Mercado Livre e transforma seus dados de vendas, estoque Full e anúncios em **diagnósticos acionáveis** — mostrando onde ele está **perdendo dinheiro** (ruptura, estoque parado, preço errado) sem que ele precise mexer em planilha.

**O que NÃO é:** não gera envios, não etiqueta, não faz checkout, não escreve nada na conta do ML. É **read-only / diagnóstico**. O seller lê e age por conta própria.

---

## 2. Estratégia de validação (a parte mais importante desta fase)

O objetivo agora **não é** ter todas as telas — é provar que o seller sente valor e pagaria. Estratégia:

### 2.1. Comece pelo "aha" que funciona no dia 1
Nem toda análise precisa de histórico. Ordem de prioridade por **valor imediato × esforço**:

| Análise | Precisa de histórico? | Impacto emocional | Prioridade |
|---|---|---|---|
| **Ruptura + R$ de vendas perdidas** | Não (snapshot) | 🔥 Altíssimo ("estou perdendo R$ X/dia") | **1ª** |
| **Estoque parado / anúncios pausados** | Não (snapshot) | 🔥 Alto ("tenho capital parado") | **2ª** |
| **Cobertura de estoque** (dias que dura) | Pouco (30d de vendas) | Alto | **3ª** |
| **Vendas / BI + Curva ABC** | Sim (semanas) | Médio | 4ª |
| **Elasticidade de preços** | Sim (meses) | Alto, mas maturidade | 5ª |

> **Insight-chave:** lidere a validação com **Ruptura + vendas perdidas em R$**. É visceral, entrega valor no primeiro login, e não depende de acumular histórico. A elasticidade (a "joia") entra depois, enquanto o histórico é coletado em segundo plano desde o dia 1.

### 2.2. Como validar barato
1. **Landing page + waitlist** com a proposta ("Descubra quanto você perde de vendas por ruptura no Full — grátis").
2. **Diagnóstico único gratuito**: seller conecta a conta, roda o relatório de ruptura, recebe o número em R$. Zero mensalidade para provar valor.
3. **10–20 sellers de teste** (começar pelos nichos certos, ver §4). Meta: 40%+ dizerem "isso resolve uma dor real / eu pagaria".
4. Só depois construir o restante das telas.

### 2.3. Métrica de sucesso da validação
- ≥ 40% dos testadores ativam a conta e voltam em 7 dias (retenção W1)
- ≥ 30% respondem "ficaria muito decepcionado se isso deixasse de existir" (Sean Ellis PMF test)
- ≥ 5 sellers dispostos a pagar antes do produto completo

---

## 3. Público-alvo (ICP)

**Vendedores do Mercado Livre que usam o Full**, com dor real de estoque/análise:

- **Foco inicial (nichos com muitos SKUs/variações):** autopeças/motopeças, vestuário/calçados.
- **Porte:** Gold e Platinum em crescimento (têm volume suficiente para a análise fazer sentido, mas ainda operam "no chute").
- **Não-alvo no MVP:** sellers 100% envio próprio (sem Full), quem já usa ERP maduro com BI.

---

## 4. Escopo do MVP (MoSCoW)

### ✅ MUST (v1 — o núcleo vendável)
- [ ] Login + integração OAuth com o Mercado Livre (escopos de **leitura**)
- [ ] Suporte a **múltiplas contas** ML por usuário
- [ ] **Relatório de Ruptura** com valor em R$ de vendas perdidas
- [ ] **Estoque parado / sem venda** no Full + **anúncios pausados**
- [ ] **Cobertura de estoque** (dias de estoque com base na demanda)
- [ ] Ingestão contínua que **começa a acumular histórico** desde o dia 1

### 🔜 SHOULD (v2 — logo após validação)
- [ ] **Dashboard de Vendas / BI** (dia/semana/mês/ano, comparativos, por grupo)
- [ ] **Curva ABC**
- [ ] **Tags** para filtrar relatórios
- [ ] **Metas mensais**

### 💡 COULD (v3 — diferenciação)
- [ ] **Elasticidade de preços** (vendas × visitas × conversão × preço × Ads)
- [ ] **Evolução de anúncios**
- [ ] **Análise de Ads / ROAS**
- [ ] Alertas por e-mail/WhatsApp ("produto X vai romper em 3 dias")

### ❌ WON'T (fora do produto — é o "lado operacional" que decidimos cortar)
- Geração de envios · Etiquetagem · Checkout Full · Auto-ajuste · Volumetria · Engenharia reversa de SKU/Kits

---

## 5. Funcionalidades detalhadas (user stories do MUST)

### 5.1. Integração ML
> *Como seller, quero conectar minha conta do ML em poucos cliques para ver meus dados, com segurança (app oficial/certificado).*
- OAuth 2.0 do Mercado Livre, escopos somente leitura.
- Armazenar `access_token`/`refresh_token` criptografados; renovar automaticamente.
- Após conectar, disparar carga inicial (backfill do que a API permitir) + assinar webhooks.

### 5.2. Relatório de Ruptura (o wedge)
> *Como seller, quero ver quais produtos estão em falta/esgotados no Full e quanto isso me custa em R$.*
- Lista de itens com estoque Full = 0 ou abaixo de um limiar.
- Cálculo de **vendas perdidas** = (venda média diária do item) × (dias em ruptura) × preço.
- Ordenar por R$ perdido (maior impacto no topo).

### 5.3. Estoque parado / anúncios pausados
> *Como seller, quero ver o que está no Full sem vender e o que está pausado sem eu saber.*
- Itens com estoque no Full e **0 vendas em N dias**.
- Anúncios com status pausado/fora de venda no Full.

### 5.4. Cobertura de estoque
> *Como seller, quero saber quantos dias meu estoque dura por produto.*
- Cobertura = estoque Full atual ÷ venda média diária.
- Sinalização visual (vermelho < 7 dias, amarelo < 15, verde OK) — limiares configuráveis.

---

## 6. Modelo de dados (essencial)

```
users            (id, email, ...)
ml_accounts      (id, user_id, ml_user_id, nickname, tokens, status)
items            (id, ml_account_id, mlb_id, title, sku, status, price, category)
inventory_snap   (id, item_id, date, full_stock, available_qty)      ← série temporal
sales_daily      (id, item_id, date, qty_sold, revenue)              ← série temporal
visits_daily     (id, item_id, date, visits)                        ← série temporal (p/ elasticidade)
ads_daily        (id, item_id, date, spend, clicks, acos/roas)      ← v3
tags             (id, user_id, name)
item_tags        (item_id, tag_id)
```

> As tabelas `*_daily` e `inventory_snap` são o **coração histórico**. Precisam ser preenchidas todo dia desde o início — é o que habilita cobertura, evolução e elasticidade.

---

## 7. Integração com a API do Mercado Livre (referência)

> ⚠️ Validar endpoints/escopos exatos na doc oficial ao implementar — a API muda.

| Necessidade | Recurso ML (aprox.) |
|---|---|
| OAuth | `/authorization` + `/oauth/token` |
| Anúncios do seller | `/users/{id}/items/search` + `/items/{id}` |
| Estoque Full | recursos de **fulfillment / inventory** (`/inventories`, stock por item) |
| Vendas | `/orders/search` (por seller, por data) |
| Visitas | `/items/{id}/visits` (série temporal) |
| Ads | **Advertising API** (product ads / ACOS-ROAS) — v3 |
| Tempo real | **Webhooks/Notifications** (tópicos: items, orders, stock) |

**Escopos:** somente leitura. Isso é um diferencial de risco vs. a Magiic completa (que precisa de escrita para envios).

---

## 8. Pipeline de dados (o verdadeiro desafio de engenharia)

1. **Webhooks do ML** → fila (ex.: Vercel Queues / fila gerenciada) → processador grava snapshot/venda no banco.
2. **Jobs agendados (cron diário)** → para dados que o webhook não cobre (visitas, consolidação diária, snapshot de estoque).
3. **Backfill inicial** ao conectar a conta (histórico que a API permitir).
4. **Idempotência**: notificações do ML chegam duplicadas/fora de ordem — processar com dedupe.

> Regra de ouro: **o dashboard é fácil; o pipeline confiável é o produto.** Priorize captura correta de série temporal desde o primeiro cliente.

---

## 9. Stack sugerido (otimizado p/ validar rápido)

- **Front + API:** Next.js (App Router) na **Vercel** — deploy instantâneo, um repo só.
- **Banco:** Postgres (Neon via Vercel Marketplace) — relacional serve bem série temporal no início.
- **Fila/jobs:** Vercel Cron + Queues (ou fila gerenciada) para ingestão.
- **Auth do app:** Clerk/Auth.js (OAuth do ML é à parte, no nível de conta ML).
- **UI:** shadcn/ui + Recharts para os gráficos.

> Não otimizar cedo demais. Postgres + crons resolvem os primeiros 50 clientes. Data warehouse dedicado só quando o volume exigir.

---

## 10. Hipótese de precificação (validar, não fixar)

- **Isca:** diagnóstico de ruptura **gratuito** (mostra R$ perdido) → gera o "aha".
- **Trial:** 7 dias, sem cartão (igual Magiic).
- **Planos por porte** (faturamento/nº de anúncios), sob consulta ou faixas públicas:
  - Starter (analytics básico: ruptura, cobertura, parado)
  - Pro (+ Vendas/BI, Curva ABC, Tags)
  - Advanced (+ Elasticidade, Ads, alertas)
- Analytics puro tende a sustentar ticket menor que a Magiic completa — compense com **volume** e caminho de upsell futuro para operacional.

---

## 11. Roadmap sugerido

| Fase | Entrega | Objetivo |
|---|---|---|
| **0 — Validação** (semanas 1–2) | Landing + waitlist + diagnóstico manual/semi-automático de ruptura | Confirmar dor e interesse |
| **1 — MVP** (semanas 3–8) | OAuth ML + ingestão + Ruptura/Cobertura/Parado + multi-conta | Primeiros pagantes |
| **2 — BI** | Vendas/BI, Curva ABC, Tags, Metas | Aumentar retenção |
| **3 — Diferenciação** | Elasticidade, Ads/ROAS, alertas | Defensabilidade |

---

## 12. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Espaço concorrido (Nubimetrics, Real Trends, métricas do próprio ML) | Focar em **Full + ruptura em R$** — ângulo específico e visceral |
| Menos "lock-in" que o operacional | Alertas proativos + histórico acumulado criam dependência ao longo do tempo |
| Dependência total do ecossistema ML | Aceitar no MVP; avaliar Shopee/Amazon só após PMF |
| Elasticidade exige histórico longo | Coletar desde o dia 1; entregar valor antes com análises de snapshot |
| Aprovação/limites da API do ML | Usar só escopos de leitura (aprovação mais simples); respeitar rate limits |

---

## 13. Perguntas em aberto (decidir antes do build)

- [ ] Nome/marca do produto?
- [ ] Faixas de preço públicas ou "sob consulta"?
- [ ] Alvo de nicho para os primeiros testes (autopeças? vestuário?)
- [ ] Já temos acesso de dev à API do ML (app registrado)?
