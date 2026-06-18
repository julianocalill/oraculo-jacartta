# Caminho A — Construir no Lovable

> Painel estilo Tiamat **sem terminal**: descrevendo o que você quer em texto, o Lovable escreve
> o código, o banco (Supabase) e publica. Leia primeiro o [índice + fundação comum](roadmap-tiamat-like.md)
> (schema, regra de "sem dados de cliente" e as armadilhas).

**Stack:** Lovable (frontend + edge functions) · Lovable Cloud / Supabase (banco) · Publish do Lovable (hospedagem).

**Quando esse caminho brilha:** ver algo na tela em minutos, sem instalar nada. **Onde ele aperta:**
o motor de ingestão e o cron (Fase 2) — quando essa parte ficar complexa, considere "evoluir" só
ela pro [Caminho B](roadmap-b-supabase-vercel.md).

---

## Fase 0 — Fundação
- Decida o "número que importa", confirme o ERP e que ele tem API/token (ver fundação comum).
- Crie conta no [lovable.dev](https://lovable.dev).
- Rascunhe o schema no papel (já está pronto na fundação comum).

**Pronto quando:** você sabe qual ERP, qual token, e qual é o número principal do painel.

---

## Fase 1 — Esqueleto + vendas (com dados fake)
1. **Crie o projeto** no Lovable. No primeiro prompt, descreva o app inteiro em linhas gerais:
   *"Um painel de vendas pra um pet shop. Tema claro, sidebar com Vendas, Estoque e Alertas.
   Use cards no topo e gráficos."*
2. **Ative o banco** (Lovable Cloud / Supabase) e peça pra criar as tabelas do schema comum
   (`channels, products, orders, order_items, stock, alert_rules, alerts`).
3. **Peça um seed fake:** *"Popule com uns 50 pedidos de exemplo e 20 produtos de pet (ração,
   areia, brinquedo) pra eu ver os gráficos."*
4. **Monte o dashboard:** cards de **faturamento hoje / mês**, **nº de pedidos**, **ticket médio**;
   **gráfico de receita por dia (últimos 30 dias)**; tabela **top 10 produtos**.
5. **Login simples:** peça auth por email com uma **lista de emails permitidos** (só você por enquanto).
6. **Veja no preview** e ajuste o visual conversando.

**Pronto quando:** o dashboard mostra os números a partir dos dados fake e você consegue logar.

> ⚠️ Armadilha #1 (paginação): peça explicitamente *"pagine as consultas, o Supabase corta em 1000 linhas"*.

---

## Fase 2 — ⭐ Motor de ingestão (ERP → banco)
Aqui é o coração. No Lovable isso vira uma **edge function** + um agendamento.

1. **Guarde o token do ERP nos Secrets do Lovable** (NÃO numa variável pública). Peça:
   *"Crie um secret `ERP_TOKEN` e use só no backend."*
2. **Edge function `ingest`:** *"Crie uma edge function que chama a API do [Tiny/Bling], lista os
   pedidos das últimas 24h e faz upsert na tabela orders/order_items usando `ext_id` como chave
   pra não duplicar. Descarte qualquer dado de cliente."*
   - Se **Tiny v2**: token estático no header — mais simples.
   - Se **Tiny v3 / Bling v3**: precisa do fluxo OAuth (renovar token). Peça ajuda ao Marvin nessa parte.
3. **Paginação + limite:** lembre o Lovable de paginar a resposta do ERP e respeitar o rate limit (ex: Tiny ~60-120 req/min).
4. **Agendamento:** peça um **cron** (scheduled function) que roda a `ingest` de hora em hora.
5. **Backfill:** rode a ingestão uma vez "pra trás" (ex: últimos 90 dias) pra encher o histórico.
6. **Estoque:** uma function parecida que sincroniza saldo dos produtos.

**Pronto quando:** os números do dashboard são os **reais** do ERP, e atualizam sozinhos.

> ⚠️ Armadilhas #2 e #3: idempotência por `ext_id`, e token só no backend.
> Se essa fase virar uma luta (cron, OAuth, dados que não batem) → é o sinal pra "evoluir" pro Caminho B.

---

## Fase 3 — Estoque & operação
- Tela **Estoque:** saldo por produto, destaque vermelho pra **ruptura** (saldo 0), lista de
  **produtos parados** (sem venda há N dias).
- Tela **Pedidos:** status (a enviar / enviado / etc.), filtro por canal e período.

**Pronto quando:** dá pra responder "o que acabou?" e "o que não está girando?" em 2 cliques.

---

## Fase 4 — Alertas/performance
1. **Tabelas** `alert_rules` e `alerts` (já no schema).
2. **Edge function `avaliar`:** roda as regras e **cria** alerta quando bate a condição
   (ex: produto caiu >30% na semana; saldo < 5; sem venda há 30 dias).
3. **⚠️ Armadilha #4 (a mais importante):** a mesma função também tem que **FECHAR** (`status=resolved`)
   os alertas cuja condição não vale mais. Peça isso explicitamente.
4. **Notificação:** comece simples — um **email** (integração Resend do Lovable) com o resumo dos
   alertas abertos. WhatsApp depois.
5. **Tela Alertas:** lista de alertas abertos por severidade.

**Pronto quando:** você recebe um aviso quando algo importante muda — e os alertas velhos somem sozinhos.

---

## Fase 5 — Polir & publicar
- Revise a **segurança** (armadilha #5): toda consulta filtra pelo dono; ligue "leaked password protection".
- **Publish** no Lovable → app no ar.
- (Opcional) **domínio próprio** (ex: `painel.espacodebicho.com.br`).
- Coloque um selo **"Beta"** nas áreas ainda cruas.

**Pronto quando:** está no ar, num link/domínio, e só você acessa.

---

## Resumo do caminho A
Você descreve → Lovable constrói → você publica. Rápido e visual. O risco está todo na **Fase 2**
(ingestão): se ela travar, não insista no Lovable — é exatamente o ponto onde o Tiamat "de verdade"
vive em código (Caminho B). Tudo que você fez no banco aproveita.
