# Design System — Oráculo

Redesign de 2026-08-23. Fonte da verdade dos estilos: `apps/web/app/globals.css`
(tokens no topo). Este documento explica as decisões para quem for mexer na UI.

## Princípios

- **Identidade preservada**: tinta quase-preta + ouro como assinatura + paleta
  joia para dados. O redesign mudou composição, tipografia e profundidade —
  não a identidade.
- **Zero dependência de UI**: CSS puro + SVG server-side. Sem Tailwind, sem
  lib de componentes, sem lib de gráficos, sem JS de cliente para visual
  (exceções: toggle de tema e nav ativa, que precisam de estado).
- **Ouro com parcimônia**: assinatura (marca, CTA, setor ativo, média nos
  gráficos). Cor de dados vem da paleta joia.

## Temas (dark + light)

Dois temas completos via tokens CSS. O dark é o default; o claro vive em
`:root[data-theme="light"]` com a mesma estrutura de tokens.

**Como funciona a escolha:**

1. `ThemeToggle` (`app/components/theme-toggle.tsx`) — radiogroup
   Escuro/Claro na sidebar. Grava cookie `oraculo-theme` (1 ano) e troca
   `document.documentElement.dataset.theme` na hora.
2. `readTheme()` (`lib/theme-server.ts`) lê o cookie no servidor; o layout
   renderiza `<html data-theme="...">` já correto — **sem flash** no load.
3. Constantes compartilhadas em `lib/theme.ts` (sem `next/headers`, para o
   client component poder importar).

**Regras ao adicionar cor nova:**

- Nunca hex direto em componente — sempre token com par claro/escuro.
- Ouro tem três papéis com tokens distintos: `--gold`/`--amber`
  (preenchimento), `--gold-text` (ouro como cor de texto — escurece no claro
  para manter 4.5:1) e `--on-gold` (texto sobre fundo ouro).
- Superfícies auxiliares tokenizadas: `--tooltip-bg/text`, `--zebra`,
  `--chip-soft`, `--link-indigo/violet`, `--surface-highlight`, sombras.
- Paleta joia (índigo/violeta/ciano/esmeralda/rosa) é compartilhada entre os
  temas, com versão um passo mais saturada no claro.

## Tipografia

Pareamento **IBM Plex Sans + IBM Plex Mono** ("Financial Trust"), via
`next/font/google` no `layout.tsx` — self-hosted no build, nenhum request a
fonts.googleapis.com em runtime. Variáveis: `--font-sans`/`--font-mono`,
consumidas por `--sans`/`--mono` no CSS.

- Base 15px, line-height 1.5.
- Todo readout numérico usa `--mono` + `font-variant-numeric: tabular-nums`.
- Plex vai só até o peso 700; não usar 750/800/850 em CSS novo.

## Bento grid (Visão geral)

A home é composta em `.bento` — grid de 12 colunas com tiles de tamanhos
variados (`.span-N`, `.row-2`). Responsivo: 12 → 6 colunas (≤1180px) → 1
coluna (≤760px).

- `.tile` é a base (borda, radius, reflexo de 1px no topo, container query).
- `.tile-hero` — tile assinatura (Receita faturada): gradiente ouro radial,
  valor grande, sparkline preenchida, sub-stats com divisor.
- Padrões prontos: `.tile-stack` (lista rótulo → valor), `.comp-bar` +
  `.comp-legend` (barra segmentada de composição), `.tile-substats`,
  `.tile-note` (details recolhido para texto metodológico).
- **Cuidado**: `.span-N` só funciona em filho direto de `.bento`. Um
  `span-12` solto dentro de `.workspace` força 12 colunas implícitas no grid
  pai e quebra a página inteira.
- Tiles de fonte da home têm span dinâmico pela quantidade de canais
  (2 tiles → span-6; 3 → span-4; 4+ → span-3).

## Gráficos (linguagem única)

Tudo SVG server-side em `app/components/fiscal-charts.tsx`:

| Componente | Uso | Traços |
|---|---|---|
| `RevenueArea` | curva diária (home, devoluções) | curva suave, área em gradiente, média tracejada ouro, pico marcado, legenda |
| `DailyBars` | volume por dia (pedidos) | barras com gradiente e cantos arredondados, pico sólido, média tracejada, tooltip nativo `<title>` |
| `Sparkline` | cards de métrica | curva suave; `fill` opcional (área) no hero |
| `TaxDonut` / `MarginGauge` | composição e saúde fiscal | legenda sempre com rótulo + valor + % (nunca só cor) |

- Suavização compartilhada: `smoothPath()` (Catmull-Rom → Bézier, tensão 0.5).
- Gramática comum: gridlines `var(--line)`, média tracejada `var(--gold-text)`
  (6 5), legenda `.chart-legend`, eixo `.axis-row` com 3 marcas.
- Gradientes SVG: id derivado da cor (`gradId`) — RSC não usa hooks.

## Métricas e números

- `.metric` usa **container queries**: o valor (`strong`) escala pela largura
  do card (`clamp(0.9rem, 12.5cqi, 1.65rem)`) — nunca mais "R$ 5.902.8…".
  Ellipsis fica só como última defesa.
- `MetricCard` aceita `className` (ex.: `span-2` dentro de um bento).

## Interação

- **Links nunca sublinham** (regra global `a { text-decoration: none }`).
  Hover é mudança de cor com transição 140–150ms: row-links/back-link → ouro,
  doc-link → ouro escuro, pills clicáveis → fundo um passo mais escuro +
  borda forte. Pills não-clicáveis (span) não reagem.
- Foco por teclado: anel único `:focus-visible` (2px `--ring` + offset).
- `prefers-reduced-motion` global zera animações/transições.
- Todo clicável tem `cursor: pointer`.

## Mobile (≤1180px / ≤760px)

- Shell vira 1 coluna (`minmax(0,1fr)` — nunca `1fr`, senão a nav horizontal
  estoura o viewport); sidebar vira faixa horizontal rolável.
- Alvos de toque ≥44px: chips da nav, inputs/botões de filtro, pills
  clicáveis, toggle de tema. Links de tabela têm área expandida com padding
  compensado por margin negativa.
- Tabelas densas rolam dentro de `.table-wrap` (a página nunca rola
  horizontal). `.dashboard-section` usa `minmax(0,1fr)` — coluna `auto`
  dimensiona por max-content e um SVG de viewBox 720 estoura o mobile.

## Sidebar

232px no desktop, ícones SVG inline por aba (`app/components/nav-icons.tsx`,
traço estilo Lucide, chaveado pela `key` de `lib/auth/tabs.ts`). Ícone ouro no
hover/ativo. Aba nova = adicionar o path em `PATHS` (senão cai no ícone
genérico).
