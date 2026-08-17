# RPA · Afiliados Shopee

Aba `/rpa` (2026-08-12). Recebe o Relatório Mensal de Afiliados da Shopee em
`.csv`, calcula as retenções por afiliado, mostra um consolidado para conferência
e, depois da aprovação, entrega um ZIP com um Recibo de Pagamento a Autônomo
(RPA) em PDF para cada CPF.

## Por que existe

Desde **01/07/2026** a Shopee mudou o repasse de comissões do Programa de
Afiliados do Vendedor para um **modelo de intermediação**
([artigo 27737](https://seller.shopee.com.br/edu/article/27737)). A Shopee virou
apenas o trilho do pagamento: repassa o valor **bruto**, **não retém tributo na
fonte**, e a responsabilidade fiscal pelo afiliado pessoa física passou a ser do
vendedor, que é o tomador do serviço.

Na prática apareceu uma rotina mensal nova: baixar o relatório em
`Afiliados do Vendedor > Relatórios > Relatório Mensal` (gerado todo dia 1º,
referente aos pedidos **concluídos** no mês anterior) e emitir um recibo por CPF.
O arquivo de Jul/2026 tem **772 afiliados** — inviável à mão.

Três consequências operacionais que a tela não resolve sozinha e valem registro:

- **Ausência de relatório é ambígua.** A Shopee não exibe arquivo quando não há
  registros elegíveis, então "não baixei nada" pode ser "não teve venda de
  afiliado" ou "algo quebrou". Sem um controle próprio de mês fechado, passa
  batido.
- **Competência de venda ≠ competência de comissão.** O relatório olha pedidos
  concluídos, não faturados: venda de fim de mês cai no relatório seguinte.
- **Afiliado PJ/MCN não passa por aqui.** A Shopee só dá o contato da empresa; a
  nota fiscal tem que ser cobrada direto dela. Esta aba cobre exclusivamente o
  afiliado pessoa física.

## Por que é upload, e não integração

`docs/shopee-affiliates-integration-map.md` (levantamento de 2026-07-27) mediu
que os **quatro partner apps recebem HTTP 403 `error_api_permission`** em
`get_conversion_report`, e que o banco não guarda identidade de afiliado —
`shopee_order_escrow` tem os campos financeiros de AMS, mas nada que identifique
quem divulgou. Enquanto a permissão AMS não existir, o CSV baixado à mão é a
única fonte.

## O arquivo, e as quatro armadilhas dele

Medido sobre o relatório real de Jul/2026 (772 linhas, R$ 26.045,08 de bruto):

1. **BOM UTF-8** na primeira coluna. Sem remover, `Mês de conclusão` nunca casa
   com o cabeçalho procurado e a competência some.
2. **`Comissão  bruta` tem dois espaços** no cabeçalho. Comparação literal perde
   a coluna de dinheiro — a de mais alto custo do arquivo.
3. **`Telefone` vem prefixado com U+200C** (zero-width non-joiner). Invisível na
   tela, viaja para dentro do PDF.
4. **Valor em pt-BR com prefixo** (`"R$4.087,10"`). `parseMoney` de
   `apps/web/lib/returns-import.ts` já resolve; não reimplementar.

Além disso, **o relatório não traz PIS/NIT**, que costuma ser exigido no RPA e no
eSocial — ele traz `Ocorrência SEFIP` e `Tipo de contribuinte individual`, o que
sugere que a Shopee pensou no tema e parou antes. Pendência para a contabilidade.

O **endereço vem como string única** e casou em 772/772 linhas com
`logradouro, número, complemento - bairro, cidade - UF, CEP`. É quebrado em
campos, mas `endereco_raw` guarda o original e o recibo cai nele quando o parse
falha: endereço errado no recibo é pior que endereço não estruturado.

## Decisões de desenho

**Um lote por arquivo, sem consolidar CPF entre lojas.** Se o mesmo afiliado
vendeu para duas lojas do grupo, são dois recibos — tomadores diferentes (CNPJs
diferentes) pagaram valores diferentes. Por isso `oraculo_rpa_issuers` é tabela,
não singleton.

**Tudo em centavos inteiros, arredondando por linha.** O consolidado da tela é a
soma dos valores já arredondados de cada recibo, nunca o arredondamento de uma
soma. No arquivo de julho a diferença entre as duas contas é de 3 centavos no
INSS — pouco, e exatamente o tipo de divergência que volta da contabilidade.

**As retenções são gravadas no item, não recalculadas na leitura.** O recibo é um
documento: reabrir um lote de julho em dezembro tem que mostrar o que foi emitido
em julho, mesmo que a tabela do IRRF tenha mudado. Mesma razão pela qual a
etiqueta de palete congela o texto impresso.

**Piso de emissão configurável por lote.** 57 afiliados de julho têm comissão
≤ R$ 1,00 (o menor é R$ 0,38) e 442 dos 772 têm ≤ R$ 5,00. Quem fica abaixo do
piso continua no consolidado, marcado como não emitido, e fica fora do ZIP. Com
piso zero, todo mundo recebe recibo.

**As três tabelas são `service_role`-only — sem `grant select` para
`authenticated`.** Isso contraria de propósito o item 8 do `AGENTS.md`: aqui
trafegam CPF, data de nascimento, endereço, e-mail e telefone de centenas de
pessoas físicas, que não devem sair pelo PostgREST com anon key. As páginas leem
via `createSupabaseAdminClient()` depois do `requireTabAccess("rpa")`, mesmo
tratamento de `shopee_order_escrow`. Quem "consertar" isso adicionando o grant
estará abrindo o cadastro de 772 afiliados para qualquer JWT válido.

Pelo mesmo motivo a aba é **opt-in por usuário**: como toda aba do Oráculo, ela
nasce invisível até ser liberada em `/usuarios`.

## O desvio da política de PDF

`docs/logistica-etiquetas.md` registra que a etiqueta de palete evitou biblioteca
de PDF de propósito, usando `@page` + `window.print()`. Aquela via **não atende
aqui**: `window.print()` produz um arquivo com N páginas, e a contabilidade
precisa de um recibo por pessoa, nomeado por CPF, dentro de um ZIP.

Entraram duas dependências, ambas JS puro, sem binário nativo e sem headless
browser (`puppeteer`, que o repo recusou, é outra ordem de grandeza):

- **`pdf-lib`** — um A4 por recibo, fontes padrão (não embutidas), ~3 KB por PDF.
- **`fflate`** — `zipSync` em nível 1; PDF de texto já é pequeno e comprimir
  centenas deles não paga o tempo de CPU numa requisição com relógio correndo.

As fontes padrão usam **WinAnsiEncoding**, que cobre o português inteiro mas
estoura com o que estiver fora dela — e o cadastro é texto livre digitado pelo
afiliado. `toWinAnsi()` deixa o acento passar, tenta remover o acento do que não
couber e, em último caso, escreve `?`. Um recibo com um caractere degradado é
recuperável; uma exceção derrubaria o lote inteiro.

## Fluxo

1. **`/rpa`** — cadastro do tomador (salvo por CNPJ), toggles de INSS/IRRF/ISS,
   alíquota do ISS, piso e upload do `.csv`. A competência sai do arquivo.
2. **`/rpa/[lote]`** — consolidado, tabela por afiliado, linhas com ressalva, e
   o botão **Aprovar e gerar**. O lote nasce `rascunho`.
3. Aprovar carimba `status = 'aprovado'` e redireciona com `?baixar=1`, que
   dispara o download sozinho (`download-trigger.tsx`, irmão do `print-trigger`
   da etiqueta). O botão manual continua na tela para reemitir depois.
4. **`/rpa/[lote]/zip`** — GET que monta os PDFs e devolve o ZIP. Só serve lote
   aprovado (409 em rascunho); lote inexistente dá 404.

Numeração `RPA-AAAA-MM-NNNN`, sequencial dentro do lote por ordem de nome e
gravada no upload, para ser estável entre reemissões.

## A tabela do IRRF é dado versionado, não constante solta

`IRRF_TABLE` em `packages/domain/rpa.js` carrega `vigenciaInicio`, e o lote grava
qual versão aplicou (`irrf_table_version`), exibida na tela do consolidado.

⚠️ **Os valores precisam ser confirmados com a contabilidade.** A reforma de 2025
manteve as faixas progressivas e acrescentou um redutor que zera o imposto até
R$ 5.000,00 mensais e o reintroduz até R$ 7.350,00; os coeficientes exatos do
faseamento divergem entre as fontes públicas e aqui ele está modelado como
interpolação linear entre os dois limites.

Na prática isso quase não é exercitado pelo relatório da Shopee: com qualquer
leitura da tabela de 2026, **o arquivo inteiro de julho dá IRRF zero** — a maior
comissão individual foi R$ 4.087,10, abaixo do piso do redutor. E ninguém chega
perto do teto do INSS (R$ 8.157,41).

Ressalva estrutural que nenhum código resolve: o redutor olha o rendimento mensal
**total** da pessoa, que o tomador não conhece. Cada fonte pagadora retém sobre o
que ela mesma paga; o acerto é no ajuste anual.

## Onde está o quê

| Arquivo | Papel |
|---|---|
| `packages/domain/rpa.js` + `rpa.test.js` | Retenções, parse de endereço, sanitização, valor por extenso. Funções puras, 21 testes. |
| `apps/web/lib/rpa-import.ts` | Parse do CSV (cabeçalho por nome, splitter que respeita aspas). |
| `apps/web/lib/rpa-upload.ts` | Lote + itens em chunks de 500; aprovação e exclusão. |
| `apps/web/lib/rpa-pdf.ts` | Um recibo em PDF. |
| `apps/web/lib/rpa-zip.ts` | Empacotamento + manifesto `_FALHAS.txt` quando algum recibo não sai. |
| `apps/web/app/rpa/` | Telas, loaders e o route handler do ZIP. |
| `supabase/migrations/20260812170000_rpa_afiliados.sql` | `oraculo_rpa_issuers`, `_batches`, `_items`. |

**O app agora consome `@oraculo/domain` de verdade.** Até aqui o pacote era só
especificação executável, testada em paralelo ao SQL. Para o RPA isso não servia:
duas implementações do mesmo cálculo de dinheiro dariam duas respostas. Daí
`allowJs: true` no `tsconfig` do web e `transpilePackages: ["@oraculo/domain"]`
no `next.config.mjs`.

## Verificação feita na entrega

Contra o arquivo real `MonthlyReport_RPA_202608121652.csv`, com INSS e IRRF
ligados e sem piso:

| Medida | Resultado |
|---|---|
| Linhas lidas / válidas / descartadas | 772 / 772 / 0 |
| Endereços quebrados em campos | 772 / 772 |
| Telefones ainda com U+200C | 0 |
| Bruto | R$ 26.045,08 |
| INSS | R$ 2.864,99 |
| IRRF | R$ 0,00 |
| Líquido | R$ 23.180,09 |
| ZIP | 772 PDFs, 2,31 MB, 4,9 s (6,4 ms por recibo) |

Também verificados: retenções todas desligadas (líquido = bruto), piso de R$ 5,00
(350 emitidos, 422 fora), teto do INSS numa comissão de R$ 9.000 (retém
R$ 897,32, não R$ 990,00), CPF com dígito verificador inválido sinalizado sem
bloquear a emissão, endereço fora do padrão caindo no texto cru, e nome com
caracteres não representáveis (`Ana 中文 Souza`) gerando PDF sem quebrar.
