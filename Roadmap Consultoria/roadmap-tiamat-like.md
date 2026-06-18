# Roadmap — Painel estilo Tiamat (Espaço de Bicho)

> Guia pro Juliano construir uma ferramenta própria no estilo do Tiamat: **vendas
> consolidadas + estoque/operação + alertas**. Existem **dois caminhos** pra chegar no mesmo
> lugar. Este doc explica como escolher e o que os dois compartilham. Depois, escolha um:
>
> - **[Caminho A — Lovable](roadmap-a-lovable.md)** (visual, sem terminal)
> - **[Caminho B — Supabase + Vercel](roadmap-b-supabase-vercel.md)** (código, stack real do Tiamat)

> ℹ️ **Sobre o nome "Tiamat":** é o codinome do painel que eu (Marvin) construí e rodo na Sebem —
> uso ele aqui só como referência do que dá pra fazer. **Batize o seu como quiser** (Espaço de Bicho
> Hub, Patas Painel, o que for); o nome não muda nada da construção.

---

## O que vamos construir (o "destino", igual nos dois caminhos)

Um painel que lê os dados de vendas e estoque **do seu ERP** (Tiny ou Bling), guarda numa base
de dados (Supabase) e mostra:

1. **Vendas** — faturamento de hoje/mês, nº de pedidos, ticket médio, gráfico de receita por dia, top produtos.
2. **Estoque** — saldo por produto, ruptura (acabou), produtos parados (sem giro), status dos pedidos.
3. **Alertas** — um motor que olha os números e te avisa: "produto X caiu Y% essa semana", "produto Z vai romper", etc.

O **coração** (e a parte mais difícil) é o **motor de ingestão**: o pedaço que puxa os dados do
ERP pra dentro do Supabase, sozinho, todo dia. Tudo antes disso é "tela bonita".

---

## Como escolher entre os dois caminhos

|  | **A — Lovable** | **B — Supabase + Vercel** |
|---|---|---|
| Você escreve código? | Quase nada (descreve em texto) | Sim (com Claude Code te guiando) |
| Velocidade pra ver algo na tela | Muito rápida (minutos) | Rápida (uma tarde) |
| Controle / robustez do motor | Limitado | Total — é o stack real do Tiamat |
| Cron / ingestão complexa | Fica chato no teto | Feito pra isso |
| Precisa de terminal/git? | Não | Sim |
| Deploy | 1 clique no Lovable | `vercel` no terminal |
| Quando trava? | Lógica de ingestão/cron pesada | Curva inicial (setup) |

**Sugestão honesta pro seu nível (intermediário):**
- Quer **ver funcionando rápido** e validar a ideia? Comece pelo **Caminho A (Lovable)**.
- Quer **a coisa de verdade**, igual o Tiamat, e topa usar o terminal? Vá de **Caminho B**.
- **Melhor dos dois mundos (o que o Marvin fez):** comece no A pra UI, e quando o motor de
  ingestão começar a doer, "evolua" pro B só naquela parte. É o **Framework 4 Fases da Elo**:
  *Identificar → Pensar → Construir → Evoluir.*

> Não dá pra errar feio: os dois usam **o mesmo banco (Supabase)** e o **mesmo modelo de dados**
> abaixo. Migrar de A pra B depois é trabalhoso mas não é recomeçar do zero.

---

## Fundação comum (vale pros dois caminhos)

### Antes de codar — decida (Fase 0, "Identificar/Pensar")

1. **Qual é o 1 número que importa?** (ex: faturamento do mês, ou margem). O painel inteiro gira em torno dele.
2. **Qual ERP?** Tiny ou Bling? Tem API/token?
   - **Tiny v2:** token estático simples (mais fácil de começar).
   - **Tiny v3 / Bling v3:** OAuth2 (token expira, precisa renovar — um pouco mais de trabalho).
   - *Isso muda só os detalhes da Fase 2 (ingestão), não o resto.*
3. **Sem dados sensíveis.** A gente **não guarda nome/CPF/telefone/endereço de cliente.** Só
   números de venda e produto. Isso simplifica tudo (LGPD, segurança) e é suficiente pro painel.

### Modelo de dados mínimo (o mesmo nos dois caminhos)

```
channels      → id, nome, tipo                      (ex: "Loja física", "Mercado Livre")
products      → id, sku, nome, categoria, custo, preco, ativo
orders        → id, ext_id (id no ERP), channel_id, status, data_venda, total, frete, created_at
order_items   → id, order_id, product_id, sku, qtd, preco_unit
stock         → product_id, saldo, atualizado_em
alert_rules   → id, tipo, params (jsonb), ativo
alerts        → id, tipo, ref, mensagem, severidade, status (open|resolved), created_at, resolved_at
```

Regras de ouro do modelo:
- **`ext_id`** (o id do pedido no ERP) é o que evita pedido duplicado — a ingestão faz *upsert* por ele.
- **Nada de cliente.** Se o ERP manda dados do cliente, **descarte** na ingestão.

### As 6 fases (mesma espinha nos dois caminhos)

| Fase | Nome | O que entrega |
|------|------|---------------|
| 0 | Fundação | decisões acima + ambiente pronto |
| 1 | Esqueleto + vendas | banco + auth + dashboard com **dados de exemplo (fake)** |
| 2 | ⭐ Motor de ingestão | ERP → Supabase, automático, todo dia |
| 3 | Estoque & operação | telas de saldo/ruptura/status |
| 4 | Alertas/performance | motor de regras + notificação |
| 5 | Polir & publicar | deploy, domínio, segurança |

> **Dica:** na Fase 1, use **dados fake** (uns 50 pedidos inventados) pra montar as telas. Só
> conecte o ERP de verdade na Fase 2. Assim você vê o painel funcionando antes de mexer em API.

---

## Armadilhas que vão te pegar (as cicatrizes do Marvin — leia antes!)

Estas valem nos **dois** caminhos. São erros que custaram horas em projetos reais:

1. **Banco corta em 1000 linhas calado.** Toda consulta no Supabase devolve no máximo **1000 linhas**
   sem avisar. Em loops de processamento, **sempre pagine** (`.range()`). Senão seu painel some 30% dos dados e você nem percebe.
2. **Ingestão tem que ser idempotente.** Rodar a sincronização 2x não pode duplicar pedido. Use
   *upsert* por `ext_id`. Sempre.
3. **Segredo (token do ERP) NUNCA no front.** Ele vive no backend (Supabase Secrets / variável de
   ambiente do servidor). No Lovable e no Next, variáveis com prefixo público (`VITE_*` / `NEXT_PUBLIC_*`)
   **vão parar no navegador de qualquer um** — nunca ponha token lá.
4. **O motor de alerta precisa FECHAR alerta, não só criar.** Depois do loop "cria alerta se a
   condição bater", precisa de um loop "fecha alerta se a condição passou". Senão acumula centenas
   de alertas velhos e ninguém mais olha (erro clássico — já vi acontecer feio na prática).
5. **Segurança por dono.** Se você ligar login, **toda** consulta tem que filtrar pelo dono dos
   dados, e o cadastro do usuário tem que gravar o `user_id` certo — senão o app fica "vazio" (os
   dados existem mas a regra de segurança esconde até de você).

---

## Próximo passo

Escolha o caminho e abra o doc:
- **[→ Caminho A — Lovable](roadmap-a-lovable.md)**
- **[→ Caminho B — Supabase + Vercel](roadmap-b-supabase-vercel.md)**

Dúvida em qualquer fase: manda no WhatsApp pro Marvin. 1 dúvida = 1 conversa.
