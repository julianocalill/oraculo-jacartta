# Logística · Etiqueta de palete

Primeira peça do módulo de Logística (2026-08-11). Gera a etiqueta 100×150 mm
que vai colada no palete, com produto, variações, quantidades, NF, caixas por
palete e um QR Code que abre a ficha do palete dentro do Oráculo.

## Por que existe

O palete saía do estoque sem identificação padronizada: conferente e
transportadora não sabiam o que tinha dentro sem abrir a caixa ou caçar a NF.
A etiqueta resolve isso e, de quebra, deixa cada palete registrado no banco —
base para cruzar com expedição e importações depois.

## A restrição que define o desenho

**A Olist não tem variação estruturada.** `olist_products` é plana: 1 SKU = 1
linha, sem produto-pai, sem grade. "640ml" só existe dentro do texto de
`sku`/`nome`. A única hierarquia no cadastro é kit (`tipo = 'K'` +
`payload->'kit'`), que não serve para isso.

Daí a decisão: **cada variação é um SKU real da Olist**, escolhido no
`<datalist>`; o campo "Produto" no topo é um agrupador digitado livre.

Segunda armadilha, descoberta olhando o cadastro real: o `nome` da Olist é o
título do anúncio de marketplace —

> Kit 10 Potes de Vidro 370ml Hermético Marmita Fit com Tampa 4 Travas - 10 Potes - Azul

— que não cabe em etiqueta nenhuma. O `sku` é o apelido curto que o estoque já
usa (`Kit pote 10 un 370ml azul`). Por isso o rótulo da variação é derivado do
**SKU**, nunca do nome. E como essa derivação é um chute educado, o campo é
editável: quem digita "640ml" manda mais que o algoritmo.

## Fluxo

1. `/logistica/etiqueta` — formulário (Server Action `gerarEtiqueta`).
2. Grava `logistica_paletes` + `logistica_palete_itens` e gera o `code`.
3. Redireciona para `/logistica/etiqueta/imprimir?code=<code>`, que renderiza N
   etiquetas idênticas e chama `window.print()` sozinho.
4. O QR aponta para `/logistica/palete/<code>` — ficha do palete, **exige login**
   e a aba `logistica` liberada.

## Decisões

| Tema | Decisão | Por quê |
|---|---|---|
| Saída | HTML com `@page { size: 100mm 150mm }` | Vai direto na térmica (Zebra/Argox) e o navegador salva como PDF quando alguém quiser arquivar. Evitou adicionar `pdf-lib`/`puppeteer` ao projeto |
| QR | SVG inline, gerado no servidor (`lib/qrcode.ts`) | PNG base64 sai serrilhado em impressora térmica de 203/300 dpi; SVG imprime na resolução nativa |
| Correção de erro do QR | Nível `M` (15%) | Etiqueta em palete pega sujeira e raspão; `H` inflaria o QR sem necessidade |
| `code` | 12 chars, alfabeto sem `0/O/1/I/L` | Fica impresso embaixo do QR para digitar quando o leitor não pega — e é aí que a confusão de caracteres acontece |
| Texto da variação | Congelado no banco | A etiqueta impressa é um documento: precisa continuar dizendo o que dizia no dia da impressão, mesmo que o cadastro da Olist mude |
| Acesso à ficha | Exige login | Decisão do produto. Quem bipar sem sessão cai no `/login?next=` e volta depois |
| N etiquetas | Cópias idênticas | Um palete, um código. Numeração 1/12, 2/12 ficou fora do escopo |

## Regra do texto impresso

`formatLabelLine(produto, variação, quantidade)` em `app/logistica/data.ts`:

| Produto | Variação | Sai impresso |
|---|---|---|
| `Pote de Vidro` | `640ml` | `Pote de Vidro 640ml - 10 unid.` |
| `Pote de Vidro` | `Pote de Vidro 1L` | `Pote de Vidro 1L - 5 unid.` (não duplica) |
| `Pote de Vidro` | *(vazia)* | usa o SKU escolhido |

A comparação ignora acento, caixa e espaço duplicado.

## Arquivos

| Caminho | Papel |
|---|---|
| `supabase/migrations/20260811210000_logistica_paletes.sql` | Tabelas, RLS e grants |
| `apps/web/lib/auth/tabs.ts` | Registro da aba (1 linha) |
| `apps/web/lib/qrcode.ts` | Wrapper do `qrcode` → SVG dimensionado em mm |
| `apps/web/app/logistica/data.ts` | Loaders, `formatLabelLine`, `deriveVariationLabel`, `generatePaleteCode` |
| `apps/web/app/logistica/etiqueta/page.tsx` | Formulário + Server Action |
| `apps/web/app/logistica/etiqueta/imprimir/` | Etiquetas 100×150 mm + `PrintTrigger` |
| `apps/web/app/logistica/palete/[code]/page.tsx` | Ficha que o QR abre |

Dependência nova: `qrcode` (+ `@types/qrcode`) — a única do projeto para isso.

## Armadilhas já pagas

- **A lib `qrcode` não emite `width`/`height`**, só `viewBox`. Um SVG sem essas
  medidas estica para 100% do container: o QR saiu com 89 mm em vez de 38 mm no
  primeiro teste. `renderQrSvg` injeta os atributos em mm — não confie em
  `replace` de atributo que pode não existir.
- **O CSS da etiqueta mora na própria página, não em `globals.css`.** O tema do
  Oráculo é escuro e o layout raiz o carrega em toda rota; a etiqueta precisa de
  preto sobre branco e usa `!important` no `body` para vencê-lo.
- **Dev usa o banco de produção.** Todo teste de geração cria palete real —
  apague o palete de teste depois (`delete from logistica_paletes where code = ...`).

## Fora de escopo (por ora)

Listagem/histórico de paletes, código de barras além do QR, vínculo com
expedição/embarques e paletes numerados (1/12, 2/12).
