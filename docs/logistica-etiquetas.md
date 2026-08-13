# Logística · Etiqueta de palete

Primeira peça do módulo de Logística (2026-08-11). Gera a etiqueta 100×150 mm
que vai colada no palete, com produto, variações, quantidades, NF, caixas por
palete e um QR Code que abre a ficha do palete dentro do Oráculo.

## Por que existe

O palete saía do estoque sem identificação padronizada: conferente e
transportadora não sabiam o que tinha dentro sem abrir a caixa ou caçar a NF.
A etiqueta resolve isso e, de quebra, deixa cada palete registrado no banco —
base para cruzar com expedição e importações depois.

## Texto livre, sem vínculo com o cadastro (2026-08-13)

Produto e variações são **digitados à mão**. A etiqueta não consulta o cadastro
de produtos, não valida nada contra o ERP e não guarda referência a SKU.

A primeira versão (11/08) amarrava cada variação a um SKU real da Olist, via
`<datalist>`. Não sobreviveu ao primeiro palete de verdade. O motivo está no
formato do cadastro:

- **A Olist não tem variação estruturada.** `olist_products` é plana: 1 SKU = 1
  linha, sem produto-pai, sem grade. "640ml" só existe dentro do texto. A única
  hierarquia é kit (`tipo = 'K'` + `payload->'kit'`), que não serve aqui.
- **O `nome` é o título do anúncio de marketplace** — "Kit 10 Potes de Vidro
  370ml Hermético Marmita Fit com Tampa 4 Travas - 10 Potes - Azul" — e não cabe
  em etiqueta nenhuma. O `sku` é mais curto ("Kit pote 10 un 370ml azul"), mas
  ainda é nome de anúncio, não nome de produto físico.

O resultado prático: o palete `X3TDN5NQXBRK` (NF 67554) saiu com

```
Kit pote 10 un 370ml azul 370 - 10 unid.
Kit pote 10 un 370ml azul 640 - 10 unid.
```

quando o que se queria era `Pote de Vidro 370ml - 10 unid.`. O cadastro forçava
o nome do anúncio no lugar do nome do produto. Com texto livre, sai certo.

**A lição, não o detalhe:** o vocabulário do ERP é do marketplace, não da doca.
Amarrar um documento físico a ele parece rigor e entrega ruído. Antes de vincular
uma tela nova ao cadastro, olhe o texto que ele realmente contém.

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
| Produto e variação | Texto livre, sem validação | O vocabulário do ERP é de anúncio de marketplace, não serve para etiqueta física (ver seção acima) |
| Acesso à ficha | Exige login | Decisão do produto. Quem bipar sem sessão cai no `/login?next=` e volta depois |
| N etiquetas | Cópias idênticas | Um palete, um código. Numeração 1/12, 2/12 ficou fora do escopo |

## Regra do texto impresso

`formatLabelLine(produto, variação, quantidade)` em `app/logistica/data.ts`:

| Produto | Variação | Sai impresso |
|---|---|---|
| `Pote de Vidro` | `640ml` | `Pote de Vidro 640ml - 10 unid.` |
| `Pote de Vidro` | `Pote de Vidro 1L` | `Pote de Vidro 1L - 5 unid.` (não duplica) |

A comparação ignora acento, caixa e espaço duplicado. A variação é obrigatória
quando a linha tem quantidade — linha em branco é simplesmente ignorada.

## Arquivos

| Caminho | Papel |
|---|---|
| `supabase/migrations/20260811210000_logistica_paletes.sql` | Tabelas, RLS e grants |
| `apps/web/lib/auth/tabs.ts` | Registro da aba (1 linha) |
| `apps/web/lib/qrcode.ts` | Wrapper do `qrcode` → SVG dimensionado em mm |
| `apps/web/app/logistica/data.ts` | `loadPaleteByCode`, `formatLabelLine`, `generatePaleteCode` |
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
- **`logistica_palete_itens.sku` e `.olist_product_id` são colunas legadas.**
  Ficaram do vínculo com a Olist e não são mais escritas nem lidas desde
  13/08/2026; existem só para não descartar os paletes gerados antes disso.
  Não volte a preenchê-las sem antes reler a seção "Texto livre".

## Fora de escopo (por ora)

Listagem/histórico de paletes, código de barras além do QR, vínculo com
expedição/embarques e paletes numerados (1/12, 2/12).
