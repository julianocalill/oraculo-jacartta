# Identidade Visual — Oráculo

Guia de marca do Oráculo (BI multicanal · Grupo Jacartta).

## Conceito

*Oráculo* é quem enxerga além. O logomark é um **orbe/íris dourado** (a esfera do oráculo, que também forma o "O" de Oráculo) com uma **gema facetada (◆) no centro** — o mesmo losango que a plataforma usa como acento nos cards e na paleta de dados. Marca geométrica, legível de 16px (favicon) a grandes formatos.

## Arquivos

| Arquivo | Uso |
|---|---|
| `apps/web/app/icon.svg` | Favicon SVG (navegadores modernos) |
| `apps/web/app/favicon.ico` | Favicon multi-tamanho (16/32/48/64) |
| `apps/web/app/apple-icon.png` | Ícone iOS (180×180) |
| `apps/web/app/components/brand-mark.tsx` | Logomark inline no app (sidebar, login) |
| `public/brand/oraculo-mark.svg` | Marca isolada, fundo transparente |
| `public/brand/oraculo-mark-512.png` | Marca em PNG (512) |
| `public/brand/oraculo-logo-dark.svg` / `.png` | Logo horizontal (fundo escuro) |
| `public/brand/oraculo-logo-light.svg` / `.png` | Logo horizontal (fundo claro) |
| `public/brand/oraculo-og.png` | Imagem social 1200×630 (link preview) |

Fonte única da geometria: todos derivam do mesmo desenho. Para regerar rasters: `rsvg-convert`.

## Cores

| Token | Hex | Uso |
|---|---|---|
| Ouro claro | `#f9d071` | Topo do gradiente da marca |
| Ouro | `#e3a93a` | Base do gradiente / assinatura |
| Tinta (fundo) | `#0b0e15` | Fundo do app |
| Painel | `#141a26` | Cards e superfícies |
| Chip da marca | `#0e131c` | Fundo do quadrado do logomark |
| Texto | `#eef1f8` | Texto principal (dark) |
| Texto marca (light) | `#1f2a44` | Wordmark em fundo claro |

**Paleta de dados (data-viz):** índigo `#6d8bff` · violeta `#a97bff` · ciano `#3ecfd6` · esmeralda `#34d399` · rosa `#fb6f84`. Semânticas: bom = esmeralda, atenção = âmbar `#f0a93b`, crítico = rosa/vermelho.

## Tipografia

- **Interface e wordmark:** Aptos / Segoe UI / system-ui (sans-serif), peso 800 no wordmark.
- **Números (readouts):** monoespaçada tabular (SF Mono / JetBrains Mono) — dá o ar de "console de dados".

## Uso

- Preferir o logomark sobre fundo **escuro**; em fundo claro, usar `oraculo-logo-light`.
- Manter área de respiro ao redor da marca de pelo menos metade da sua altura.
- Não distorcer, não trocar o ouro por outra cor, não aplicar o ouro sobre ouro.
- O ouro é assinatura: usar com parcimônia (marca, um acento por tela). Cor de dados vem da paleta joia, não do ouro.
