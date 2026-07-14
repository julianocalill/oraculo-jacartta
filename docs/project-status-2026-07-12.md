# Project Status — 2026-07-12

Consolida o estado real da plataforma após as sessões de 2026-07-10 a 2026-07-12.
Supersede `docs/project-status-2026-07-10-final.md` como retrato do "agora" —
aquele documento permanece como registro histórico daquela entrega.
Tudo abaixo está em produção (`https://oraculo.oliverhome.com.br`), deploy
`dtky866qf`.

## Onde estamos

O Oráculo tem hoje: (1) shell de navegação persistente em todas as páginas;
(2) camada fiscal materializada e atualizada de hora em hora; (3) cards de
métrica com curva de crescimento e variação real em toda a plataforma; (4)
tabelas ordenáveis em todo lugar; (5) uma feature nova — Calculadora de
Precificação, com presets por marketplace; (6) identidade visual própria
(logo, favicon, kit de marca); (7) documentação de negócio para diretoria e
treinamento.

## Atualização em 2026-07-14 — conexão Mercado Livre

- Aplicativo Mercado Livre criado para o Oráculo; credencial exposta durante o
  setup foi rotacionada antes da integração.
- Migration `20260714170000` cria estado OAuth PKCE, sellers conectados, tokens
  rotativos, inbox idempotente de notificações e auditoria da conexão, todos
  restritos ao `service_role`.
- Edge Functions `mercadolivre-oauth-callback` e `mercadolivre-webhook` formam a
  base da conexão. O callback valida `/users/me`; o webhook só enfileira.
- Nenhum pedido, anúncio, estoque ou dado financeiro do Mercado Livre entra no
  Oráculo nesta fase e nenhuma métrica existente foi alterada.
- OAuth validado em produção para `JACARTTA ATACADOEVAREJO` (`MLB`, seller
  `112538836`), com refresh token presente e run de conexão `success`.
- O grant retornado contém escopos de escrita amplos; o código atual usa apenas
  leitura, e a redução das permissões no DevCenter é requisito antes da ingestão.
- Runbook: `docs/mercadolivre-integration.md`.

## 1. Navegação

- `AppShell` + `SidebarNav` (client, `usePathname`) substituem a sidebar que só
  existia no dashboard — presente agora nas 10 páginas autenticadas, incluindo
  `/calculadora`.
- Badge de alertas **exato e global**: `loadActionableAlertCount()` faz um
  `count` real (ruptura + ruptura iminente) direto no banco; antes o badge
  mostrava no máximo 8 (as linhas que o dashboard buscava) e só existia na
  página inicial. Hoje o mesmo número aparece em toda página.
- `app/loading.tsx`: skeleton com a sidebar sólida — navegação com feedback
  instantâneo entre páginas (todas são `force-dynamic`).

## 2. Camada fiscal — snapshot horário

- Três snapshots pré-computados: `fiscal_margin_summary`, `fiscal_sku_margin`,
  `fiscal_channel_metrics`. Migration `20260710190000` trocou o refresh de
  1×/dia (06:20 BRT) para **horário** (`**:15`, retenção 14 dias) — a
  defasagem entre a receita ao vivo e os painéis de margem caiu de até ~18h
  para no máximo 1h.
- **Painéis fiscais híbridos**: no mês corrente (default) leem o snapshot
  (instantâneo); em janela de data customizada calculam ao vivo via RPC com
  try/catch — timeout degrada para "indisponível" em vez de mostrar o mês
  errado silenciosamente. Cobre margem, canais e composição de impostos.
  (Antes, os painéis fiscais ignoravam o filtro de data do dashboard.)
- Migration `20260712100000`: libera leitura do **histórico** de snapshots
  (não só o mais recente) para o role `authenticated` — alimenta as curvas de
  crescimento dos cards de margem/lucro/ROI/cobertura.
- Todas as queries do dashboard foram testadas sob o role `authenticated` com
  timeout de 8s; nenhuma estoura.

## 3. Cards de métrica com curva de crescimento

Todo card numérico relevante da plataforma (não só o dashboard) ganhou um
componente `MetricCard` compartilhado: valor grande em mono tabular,
**sparkline** (curva dos últimos dias/capturas) e **chip de variação**
(▲/▼) contra uma base de comparação honesta:

- Receita, NFs, ticket fiscal → variação vs. **mesmo trecho** do mês anterior
  (12 dias de julho vs. 12 dias de junho, nunca contra o mês inteiro).
- Lucro, margem, ROI, cobertura, receita-com-custo, custo, impostos →
  variação a partir do **histórico horário** do snapshot (primeira vs. última
  captura do período visível). Custo e impostos têm a cor do delta
  **invertida** (subir é ruim, não bom).
- Pedidos/itens/ticket auxiliar → curva da série diária de pedidos.
- Cards sem série real por trás (ex.: Canceladas, Pendentes) ficam sem
  sparkline — nunca inventa dado.
- Iteração de design: uma primeira versão introduziu uma seção "hero" nova
  (cards adicionais); foi revertida a pedido — o tratamento visual vive nos
  cards que **já existiam**, não em elementos novos.

## 4. Tabelas ordenáveis em toda a plataforma

- `SortableTable` (componente genérico, células serializáveis: texto, valor
  de ordenação, link, badge, subtítulo) aplicado em `/alertas`,
  `/curva-de-venda`, `/curva-de-estoque`.
- `/skus` mantém seu componente dedicado (`sku-table.tsx`), com o mesmo
  padrão de interação (clique ordena, clique de novo inverte, nulos por
  último).
- `/pedidos` usa cards, não tabela — sem mudança.

## 5. Correções de cálculo

- `parseMoney`/`asNumber` assumiam formato pt-BR e inflavam strings tipo
  `"123.45"` (formato do Postgres) em **100×**, tratando o ponto decimal como
  separador de milhar. Corrigido: heurística detecta vírgula (pt-BR) vs.
  ponto único (decimal) vs. múltiplos pontos (milhar).
- Ticket médio com 0 unidades vendidas mostrava a receita inteira disfarçada
  de ticket; agora mostra "-".
- `/pedidos` ganhou a mesma nota "auxiliar, não é a receita oficial" que o
  dashboard já tinha, para não ser confundido com o número fiscal.

## 6. Calculadora de Precificação — feature nova

- `/calculadora`: porte fiel de `calculadora.oliverhome.com.br` (projeto
  separado, `~/projetos/08-calculadora-marketplace`) para dentro do Oráculo,
  como página própria na sidebar.
- Mantém as **regras próprias** da calculadora (markup/preço, kits, taxas
  editáveis) — **não usa nem altera o motor fiscal do Oráculo**; aviso
  explícito na página.
- **Presets por marketplace**, selecionáveis e editáveis: Shopee (faixas
  originais), Mercado Livre Clássico (13%, público 10–14%), Mercado Livre
  Premium (18%, 15–19%), TikTok Shop (6%, 5–8% + R$4 fixo/item até R$78,99).
  Cada preset com nota sobre o que não é modelado (regra dos 50% do ML abaixo
  de R$12,50; SFP do TikTok).
- Validado por teste de paridade: extrai o `calculate()` do `app.js`
  original e compara com o porte em 7 casos (bordas de faixa, kit, modo
  preço, custo zero) — todos idênticos, incluindo o exemplo do vault (lucro
  R$ 12,94 / margem 10,35%).

## 7. Identidade visual

- Logomark: orbe/íris dourado com gema facetada (◆) no centro — usa o mesmo
  motivo de losango dos acentos de card e da paleta joia.
- `app/icon.svg`, `favicon.ico` (16/32/48/64), `apple-icon.png` (180) — fonte
  única, rasterizada com `rsvg-convert`.
- `BrandMark` (componente React, SVG inline) substitui o "O" solto na sidebar
  e no login.
- Kit de marca em `apps/web/public/brand/`: mark isolado, logo horizontal
  dark/claro, imagem social 1200×630 para preview de link.
- Metadata: título "Oráculo · BI multicanal", Open Graph/Twitter com a
  imagem social, theme-color.
- Nome padronizado para **Oráculo** (com acento).
- Correção no caminho: o middleware redirecionava `/icon.svg`,
  `/apple-icon.png` e `/brand/*` para `/login` (307) — quebrava favicon SVG e
  preview de link. Liberado como público.
- Guia completo em `docs/brand-oraculo.md`.

## 8. Documentação de negócio

- `docs/manual-oraculo-diretoria.md` + `.docx`: manual não-técnico para
  diretoria e treinamento — o que é a plataforma, como ler os números (NF
  válida, cobertura, o que a margem não inclui, variação justa), todas as
  áreas, cards e fórmulas em linguagem de negócio, curvas A/B/C, calculadora,
  alertas, checklist de reunião semanal, glossário.

## Migrations desta janela (07-10 tarde → 07-12)

- `20260710190000` — snapshot fiscal horário (era diário) + retenção 14 dias.
- `20260712100000` — leitura do histórico de snapshots liberada para
  `authenticated` (alimenta as curvas de crescimento).

Nota operacional (mantida de sessões anteriores): aplicar SQL via
`npx supabase db query --linked --file <migration>`, nunca `db push`. Projeto
linkado: ref `bbtiipnmdxfxnxbemgjr`.

## Commits e deploys desta janela

| Commit | O quê | Deploy |
|---|---|---|
| `43d418e` | Sidebar global + calc fixes + gráficos + tabelas ordenáveis | `d8bxw0g71` |
| `b42ba8d` | Badge exato, painéis híbridos, snapshot horário, nota /pedidos | `3j06vr7kk` |
| `ffa1edb` | `/calculadora` (porte fiel) | `dev40aeho` |
| `36f08a1` | Presets de marketplace na calculadora | `b225adqn3` |
| `e401a4f` | Hero cards (layout aprovado) — **depois revertido** | `95tsf4huw` |
| `2c24240` | Reversão do hero; curva de crescimento nos cards existentes | `elymplm14` |
| `5bc3d28` + `9969492` | Identidade visual + fix de middleware | `dtky866qf` |

## Validação

- Typecheck (`tsc --noEmit`) e build de produção (`pnpm --filter web build`)
  limpos em cada etapa.
- Queries fiscais testadas sob role `authenticated` com timeout de 8s.
- Teste de paridade da calculadora (7 casos) contra o `app.js` original.
- Identidade visual conferida via harness com o `globals.css` real (sidebar,
  login, favicon, imagem social) antes do deploy.
- Assets de marca e middleware confirmados com `curl` em produção (200 em
  `/favicon.ico`, `/icon.svg`, `/apple-icon.png`, `/brand/oraculo-og.png`).

## Próximos passos

- [ ] Cadastrar comissão de marketplace/frete por canal no motor fiscal (para
      margem líquida, não só fiscal) — a Calculadora já modela isso
      separadamente, o motor oficial ainda não.
- [ ] Curar fonte de custo pra SKUs simples sem custo (complementar a
      expansão de kits).
- [ ] Reconciliar o histórico `supabase_migrations` (dívida técnica separada,
      documentada desde 07-10).
- [ ] Avaliar categoria real do catálogo para ajustar os defaults de comissão
      ML Clássico/Premium na calculadora (hoje usam ponto médio 13%/18%).
