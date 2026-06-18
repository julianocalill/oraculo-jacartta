# Caminho B — Supabase + Vercel (com Claude Code)

> O **stack real do Tiamat**: você escreve um app Next.js (com o Claude Code te guiando no
> terminal), usa o Supabase direto e publica na Vercel. Mais controle, motor de ingestão robusto,
> escala de verdade. Leia primeiro o [índice + fundação comum](roadmap-tiamat-like.md).

**Stack (igual ao Tiamat):** Next.js 16 + React 19 · shadcn/ui + Recharts · Supabase (Postgres +
Auth + Edge Functions + pg_cron) · deploy na **Vercel** · **Claude Code** como par de programação.

**Quando esse caminho brilha:** ingestão e cron de verdade, testes, controle total. **Onde aperta:**
o setup inicial (terminal, git, contas) — passada essa curva, é tranquilo.

---

## Fase 0 — Fundação & ambiente
Instale e crie contas (uma vez só):
- **Node.js** (LTS), **git**, um editor (VS Code).
- **Claude Code** (`npm i -g @anthropic-ai/claude-code` ou via instalador) — seu par no terminal.
- **Supabase CLI** (`npm i -g supabase`) e um **projeto Supabase** novo (anote a URL e as keys).
- **Vercel CLI** (`npm i -g vercel`) e conta na Vercel.
- Crie a pasta do projeto, `git init`, e um **`CLAUDE.md`** curto descrevendo o app (o Claude Code lê isso sempre).

Decida o número-chave, o ERP e o token (fundação comum). **Confirme: sem dados de cliente.**

**Pronto quando:** `claude` abre na pasta do projeto e o `supabase` + `vercel` respondem no terminal.

---

## Fase 1 — Esqueleto + vendas (com dados fake)
Peça ao Claude Code, em tarefas pequenas (ele trabalha melhor assim):
1. **Scaffold:** `create-next-app` (App Router, TypeScript) + `shadcn init` + `recharts` + `@supabase/ssr`.
2. **Migration do schema:** crie uma migration SQL com as tabelas da fundação comum e aplique
   (`supabase db push` ou via MCP). Versione no git.
3. **Seed fake:** uma migration/script que insere ~50 pedidos e 20 produtos de pet de exemplo.
4. **Auth:** Supabase Auth com **allowlist** de emails (só você).
5. **Dashboard (server components):** cards (faturamento hoje/mês, pedidos, ticket médio), gráfico
   de receita/dia com Recharts, top 10 produtos.
6. **Rode e veja:** `npm run dev` → abra no navegador, confira os números.

> Use **TDD** onde fizer sentido (o Claude Code sabe): teste a função que calcula faturamento/ticket
> médio antes de escrever a tela. Dá segurança e ensina o hábito.

**Pronto quando:** `npm run dev` mostra o dashboard com os dados fake e o login funciona.

---

## Fase 2 — ⭐ Motor de ingestão (ERP → Supabase)
O coração. Aqui o Caminho B ganha do A: é feito pra isso.

1. **Edge Function `ingest`** (Deno, em `supabase/functions/ingest/`): chama a API do ERP, lista
   pedidos por janela de tempo, faz **upsert por `ext_id`** em `orders`/`order_items`. **Descarta dados de cliente.**
   - **Tiny v2:** token estático (mais simples).
   - **Tiny v3 / Bling v3:** OAuth2 — guarde o refresh token e crie uma função de callback que
     renova o access token periodicamente (um "keepalive"). Peça ajuda ao Marvin aqui.
2. **Segredos:** `supabase secrets set ERP_TOKEN=...` — fica só no servidor, nunca no bundle do front.
3. **Paginação + rate limit:** itere todas as páginas da resposta do ERP; respeite o limite (Tiny ~60-120 req/min).
4. **Agendamento:** **pg_cron** no Supabase (ou **Vercel Cron** chamando a function) pra sync
   **incremental** por `updated_at` de hora em hora.
5. **Backfill:** uma função/rota que puxa o histórico (ex: 90 dias) de uma vez.
6. **Estoque:** function `sync-stock` que atualiza `stock`.
7. **Teste:** `deno test` na lógica de transformação ERP→nosso schema (mocke a resposta da API).

**Pronto quando:** os números são reais, atualizam sozinhos via cron, e rodar a sync 2x não duplica nada.

> ⚠️ Armadilhas #1, #2, #3: pagine (`.range()`), upsert idempotente, token só no backend.
> ⚠️ Se ligar service-role numa function, **escope toda query pelo dono** (não vaze entre contas).

---

## Fase 3 — Estoque & operação
- Rota **/estoque:** saldo por produto, ruptura em vermelho, produtos parados (sem venda há N dias).
- Rota **/pedidos:** status, filtros por canal e período (server components + query params).
- Componentes shadcn (Table, Badge, Select) — reaproveite o padrão do dashboard.

**Pronto quando:** "o que acabou?" e "o que não gira?" respondidos em 2 cliques.

---

## Fase 4 — Alertas/performance (motor de sinais)
1. **Tabelas** `alert_rules` + `alerts` (já no schema).
2. **Edge Function `evaluate-performance`:** roda as regras e **cria** alerta
   quando a condição bate (queda de venda %, ruptura iminente, produto sem giro).
3. **⚠️ Armadilha #4 (crítica):** depois do loop "cria se condição", inclua o loop
   **"resolve se a condição não vale mais"** (`status=resolved`, `resolved_at`). Sem isso, acumula
   centenas de alertas mortos e ninguém olha mais.
4. **Cron** que roda o `evaluate-performance` 1-2x/dia.
5. **Notificação:** email via **Resend** (ou um webhook de Slack/WhatsApp). Comece pelo email.
6. **Rota /alertas:** abertos por severidade.

**Pronto quando:** alertas nascem quando algo muda e morrem sozinhos quando normaliza.

---

## Fase 5 — Deploy & hardening
- **Deploy na Vercel:** `vercel` (preview) → `vercel --prod`. Conecte o repo do GitHub pra deploy automático.
- **Variáveis de ambiente:** configure no painel da Vercel. **Segredos do servidor não levam
  prefixo público** (`NEXT_PUBLIC_*` vai pro navegador — só URL/anon key do Supabase ali).
- **Segurança (armadilha #5):** RLS ligada e escopada por dono; "leaked password protection" no Supabase.
- (Opcional) **Painel público read-only** — uma página só-leitura pra sócio/equipe, igual o "Painel
  Executivo" do Tiamat (link + senha, sem login, dados sem PII).
- **Domínio** na Vercel (ex: `painel.espacodebicho.com.br`).

**Pronto quando:** está no ar na Vercel, com domínio, deploy automático no push, e seguro.

---

## Resumo do caminho B
É o Tiamat de verdade, na sua escala. Curva inicial no setup (Fase 0), mas a partir da Fase 2 você
tem um motor de ingestão robusto, testável e agendado — coisa que o no-code não entrega. O Claude
Code carrega o peso técnico; seu trabalho é decidir o quê e revisar. Quando travar, manda pro Marvin.
