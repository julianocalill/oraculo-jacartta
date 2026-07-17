# Glossário de Cards e Métricas do Oráculo

> Documento de referência para explicar, número por número, o que cada card e
> cada coluna do dashboard significam. Escrito para ser usado numa reunião —
> cada item tem: **o que é**, **a fórmula exata**, **de onde vem o dado** e
> **os limiares que mudam a cor/status**.
>
> Reflete o código em produção em 2026-07-17. Se uma regra mudar, este
> documento precisa ser atualizado junto (ver seção final "Como manter isto
> atualizado").

---

## Como usar este documento

Cobre **todas as páginas do sistema**, em três partes:

1. **Conceitos-base** — as ideias que se repetem em várias páginas (velocidade
   de venda, curva ABC, tendência, custo). Leia esta parte primeiro; ela evita
   repetir a mesma explicação em cada página.
2. **Páginas de análise** — Mercado Livre, Shopee, Curva de Venda/Estoque
   (Olist), dashboard home e `/skus`: cada card e coluna, com fórmula e
   origem dos dados.
3. **Páginas operacionais e de configuração** — Alertas, Calculadora,
   Importações, Parâmetros, Status do Sync, exportação fiscal e Usuários.

Se alguém perguntar "por que esse número está assim?", a resposta está aqui.

---

# PARTE 1 — Conceitos-base

## 1.1. Velocidade de venda (média/dia)

É a métrica mais usada no sistema — aparece em quase todo card de ruptura,
cobertura e sugestão. A ideia central: **não usar a média simples do
período**, porque ela mente quando o produto passou parte do tempo sem
estoque.

**Exemplo do problema que ela resolve:** um produto vendeu 60 unidades nos
últimos 30 dias, mas ficou 20 desses dias sem estoque (zerado). A conta
ingênua diria "vende 2/dia" (60÷30). A conta correta é "vende 6/dia
**quando tem estoque**" (60÷10 dias com estoque) — e é esse 6/dia que importa
para saber quanto comprar.

### No Mercado Livre

```
SE o item tem 15 dias ou mais de histórico de snapshot de estoque:
    proporção_com_estoque = dias_com_estoque ÷ dias_observados  (mínimo 10%)
    velocidade = vendas_30_dias ÷ (30 × proporção_com_estoque)

SENÃO (histórico curto, ainda sem snapshots suficientes):
    dias_sem_venda = dias desde a última venda (no máx. 60)
    velocidade = vendas_60_dias ÷ máximo(60 − dias_sem_venda, 3)
```

O sistema tira uma "foto" do estoque de cada anúncio todo dia
(`mercadolivre_inventory_snapshots`). Com 15+ fotos acumuladas, ele sabe
exatamente quantos dias o item teve estoque de verdade — essa é a conta
"real". Enquanto o histórico é curto, ele aproxima pelos dias desde a última
venda.

**Nas variações** (cor/tamanho dentro de um anúncio) não existe essa "foto"
própria — sempre usa a aproximação por dias-desde-a-última-venda.

### Na Shopee

Não existe (ainda) a coleta de "fotos" diárias de estoque por produto local —
por isso a Shopee **sempre** usa a aproximação:

```
dias_sem_venda = dias desde a última venda (no máx. 60)
velocidade = vendas_60_dias ÷ máximo(60 − dias_sem_venda, 3)
```

**Exceção — armazéns FBS:** para os produtos que ficam nos centros de
distribuição da Shopee (FBS), a velocidade **não é calculada pelo Oráculo** —
vem pronta da própria Shopee (`selling_speed`, entregue pela API). É o dado
mais confiável do sistema porque a Shopee vê o histórico completo, não uma
aproximação.

---

## 1.2. Curva ABC (classificação de importância)

Classifica os produtos por quanto cada um contribui na receita — o clássico
princípio de Pareto (80/20), adaptado.

**A regra (idêntica nos dois canais):**

```
1. Pega todos os itens que faturaram algo nos últimos 30 dias.
2. Ordena do que mais vendeu para o que menos vendeu (por R$).
3. Soma a receita acumulada, item por item, do topo para baixo.
4. Curva A = os itens que, somados, formam os primeiros 80% da receita.
   Curva B = os próximos 15% (de 80% a 95% acumulado).
   Curva C = os últimos 5% (de 95% a 100%).
5. Item sem venda nos últimos 30 dias fica "sem curva" — não entra no ranking.
```

**Diferença entre os canais — importante:**

| Canal | Escopo da curva |
|---|---|
| **Mercado Livre** | Calculada sobre **a conta inteira** (todos os anúncios juntos) |
| **Shopee** | Calculada **por loja, separadamente** (Jacartta tem seu próprio ranking A/B/C, Donacor o dele, etc.) |

Isso significa: um produto pode ser Curva A na loja Jacartta e Curva C na
loja Oliverhome — cada loja é tratada como um negócio próprio.

**Por que isso importa na prática:** a Curva A é o filtro de prioridade em
quase tudo — ela decide a ordem da fila de reposição, o que entra no card
"Saúde da Curva A", e a diferença entre "ativar promoção" e "investigar antes
de dar desconto" no estoque parado.

---

## 1.3. Tendência 120→0 (a sequência de 4 números)

Mostra a evolução do produto nos últimos 4 meses, em blocos de 30 dias, do
mais antigo para o mais recente:

```
[ 120-90 dias atrás  |  90-60 dias atrás  |  60-30 dias atrás  |  30-0 dias atrás ]
```

Exemplo: `9 · 426 · 753 · 602` significa: há 4 meses vendeu 9 unidades, há 3
meses 426, há 2 meses 753, no último mês 602. Está em queda desde o pico do
mês retrasado.

**Rótulo automático** (usado no "porquê" de cada sugestão):
```
Compara o último bloco (30-0) com o penúltimo (60-30):
  ambos zero            → "sem venda recente"
  penúltimo era zero     → "novidade em alta"
  variação > +15%        → "crescendo X%"
  variação < -15%        → "caindo X%"
  entre -15% e +15%       → "estável"
```

A ordenação por "Tendência" nas tabelas usa a diferença entre o último e o
penúltimo bloco (não a sequência inteira) — por isso um produto pode aparecer
no topo mesmo com números pequenos, se a alta recente for grande.

---

## 1.4. Custo e Margem (o "livro de custos por SKU")

**Decisão de produto (2026-07-16):** o custo do ERP (Olist) está zerado para
a maioria dos SKUs — ninguém cadastrou lá. Em vez de esperar isso ser
corrigido, o Oráculo criou um "livro de custos" próprio, ancorado no SKU do
marketplace, alimentado manualmente pela equipe.

**A ordem de prioridade para achar o custo de um SKU:**

```
1º) Cadastro manual feito na tela (aba Sugestão de Reposição → Shopee,
    formulário "Cadastrar custos por SKU")
2º) Custo médio do produto no Olist — MAS só se for maior que R$ 0
    (custos zerados são ignorados, não contam como "tem custo")
3º) Custo efetivo de kits (soma dos componentes, só quando todos
    os componentes têm custo cadastrado)
```

Esse mesmo "livro" (`oraculo_sku_unit_cost`) é usado **tanto pelo Mercado
Livre quanto pela Shopee** — cadastrar o custo de um SKU na tela da Shopee já
atualiza a margem desse mesmo SKU nas telas do Mercado Livre, se o SKU for
igual nos dois marketplaces.

**Margem unitária** = Preço do anúncio − Custo unitário.

> ⚠️ **É margem bruta.** Não desconta comissão do marketplace, frete nem
> impostos. Serve para comparar produtos entre si, não como o lucro real da
> venda.

---

## 1.5. Ruptura, Cobertura e Estoque Parado — os três estados do estoque

Todo produto com giro está em um destes três estados (ou em nenhum, se está
saudável):

| Estado | Definição | O que significa |
|---|---|---|
| **Ruptura** | Estoque ≤ 0 **e** vendeu nos últimos 60 dias | Está zerado, mas o mercado ainda quer comprar — dinheiro sendo perdido agora |
| **Cobertura crítica** | Estoque > 0, mas dura menos de 7 dias no ritmo atual | Vai romper em breve se não for reposto |
| **Estoque parado** | Tem estoque, mas não vende (ou está pausado) | Capital imobilizado, sem giro |

O critério de "ainda vende" para ruptura é **60 dias**, não 30 — um produto
pode passar um mês inteiro sem venda e ainda estar "vivo" no mercado.

**Limiares de cobertura (idênticos nos dois canais):**
- **Crítico** (vermelho): cobertura < 7 dias
- **Atenção** (amarelo): cobertura entre 7 e 15 dias
- **OK** (verde): cobertura ≥ 15 dias

---

# PARTE 2 — Páginas de análise

## 2.1. Mercado Livre → Visão Geral (`/mercado-livre`)

### Cards do topo

**Perda estimada / dia**
```
= Σ (perda/dia de todos os itens em ruptura, anúncios)
+ Σ (perda/dia de todas as variações em ruptura)
```
onde perda/dia de um item = velocidade de venda × preço do anúncio.
*Subtítulo: quantos itens (anúncios + variações) estão contribuindo.*

**Saúde da Curva A**
```
= 1 − (itens Curva A em risco ÷ total de itens Curva A)
```
"Em risco" = está em ruptura OU tem cobertura crítica (<7 dias).
Fica **vermelho se abaixo de 80%**, verde acima disso.
*Este é o card mais importante para leitura executiva: ele resume, num
único número, se os produtos que mais faturam estão protegidos.*

**Cobertura crítica**
```
= quantidade de itens Full com cobertura < 7 dias
```
(subconjunto da tabela "Cobertura de estoque Full", ver abaixo).

**Capital parado**
```
= Σ (estoque × preço) de todos os itens parados
```

### Tabela 1 — Ruptura de estoque (anúncios)

**Quem entra:** estoque ≤ 0 (Full ou local, conforme onde o anúncio vende) **e**
vendeu algo nos últimos 60 dias.
**Ordenação:** maior perda/dia primeiro.

| Coluna | Significado |
|---|---|
| Origem | "Full" (estoque no centro de distribuição do ML) ou "Local" (estoque próprio) |
| Vendas 30/60d | Unidades vendidas em cada janela |
| Tendência 120→0 | Ver seção 1.3 |
| Média/dia | Ver seção 1.1 |
| Trânsito | Unidades já despachadas, ainda a caminho (informadas manualmente na página) |
| Perda/dia | Velocidade × preço |
| Margem unit. | Preço − custo (ver seção 1.4); "—" se não há custo cadastrado |

### Tabela 2 — Ruptura de estoque (variações)

**Quem entra:** o anúncio-pai está ativo **e** tem estoque no geral, mas
**uma variação específica** (cor/tamanho) está zerada e vendeu nos últimos 60
dias. Ou seja: pega o caso em que a página do anúncio parece saudável, mas
"Azul, Tamanho M" sumiu.

### Tabela 3 — Cobertura de estoque Full

**Quem entra:** anúncio ativo, no Full, com estoque > 0 e vendeu nos últimos
30 dias.
```
Cobertura (dias) = (estoque Full + trânsito) ÷ velocidade de venda
```
**Ordenação:** menor cobertura primeiro (os mais urgentes no topo).
Status: Crítico (<7d) / Atenção (<15d) / OK (≥15d).

### Tabela 4 — Estoque parado

**Quem entra:**
```
SE o anúncio está PAUSADO → entra sempre (independente de venda)
SENÃO:
  se é Full: sem venda nos últimos 30 dias
  se é Local: sem venda nos últimos 60 dias
```
**Ordenação:** maior capital parado primeiro. Mostra até 150 linhas.

**Ação sugerida** (a heurística automática):
```
SE mais de 120 dias sem nenhuma venda → "Avaliar retirada"
SENÃO SE é Curva A → "Investigar (Curva A)"  (um item importante não deveria estar parado)
SENÃO → "Ativar promoção"
```

### Painel "Estoque em trânsito"

Formulário de texto livre onde a equipe informa manualmente o que já foi
despachado (uma linha por anúncio: `MLB1234567890 12`). Esse número entra na
conta de cobertura e da sugestão de envio, para não sugerir repor algo que
já está a caminho.

### Painel "Cobertura de custo"

Mostra quantos SKUs (de anúncios + variações) têm custo cadastrado no livro
de custos, de um total de SKUs distintos na conta.

---

## 2.2. Mercado Livre → Sugestão de Envio Full (`/mercado-livre/envio`)

### A regra de negócio (a fórmula central da página)

```
enviar = arredondar_para_cima(velocidade × (dias_alvo + dias_até_coleta))
         − estoque_Full − trânsito
```

- **Dias de estoque alvo**: quantos dias de cobertura você quer ter (padrão
  30, ajustável de 7 a 90).
- **Dias até coleta**: quanto tempo leva para o envio chegar e ficar
  disponível no Full (padrão 5, ajustável de 0 a 30).
- Se `enviar` ≤ 0, o item não aparece na lista (não precisa repor).

**Quem é elegível:**
```
Vendeu nos últimos 60 dias
E (está ativo OU está pausado por ter zerado o estoque)
```
*Nota: anúncio pausado com estoque (decisão manual do seller de pausar) NÃO
entra — só entra o que o próprio Mercado Livre pausou automaticamente por
falta de estoque.*

**Fora do Full:** para anúncios que vendem pelo estoque local (não têm Full),
a sugestão fica limitada ao que existe fisicamente no estoque local — o
sistema não sugere "criar" estoque, só sugere mandar o que já existe para o
Full.

### As 4 situações (na ordem de prioridade da lista)

| Situação | Quando acontece |
|---|---|
| 🔴 **Em ruptura** | Já está zerado agora |
| 🔴 **Crítico (<7d)** | Tem estoque, mas cobertura menor que 7 dias |
| 🟡 **Abaixo do alvo** | Cobertura entre 7 dias e o alvo definido |
| ⚪ **Fora do Full** | Vende bem no estoque local — candidato a entrar no Full |

A lista é ordenada por: situação (na ordem acima) → depois Curva (A antes de
B antes de C) → depois maior perda/dia → depois maior venda protegida.

### A regra dos 15 itens por loja

**Decisão de produto:** a lista mostra no máximo **15 itens por conta** (não
por curva, não no total — por conta ML). É ajustável no campo "Itens por
loja" da própria tela (de 1 a 100). O objetivo é focar em execução: uma lista
de 800 itens não vira ação; 15 prioritários viram.

### Cards do topo

- **Itens sugeridos** = quantos aparecem na lista (já cortada nos 15/conta)
- **Unidades a enviar** = soma da coluna "Enviar"
- **Venda protegida** = soma de (unidades a enviar × preço) — o faturamento
  que aquele envio sustenta pelo período do alvo
- **Perda estancada / dia** = soma da perda/dia só dos itens "Em ruptura" —
  quanto você deixa de perder por dia assim que repuser

### A justificativa (texto sob cada título)

Cada linha da tabela tem, sob o nome do anúncio, uma explicação em
linguagem natural montada automaticamente: curva, velocidade com tendência,
o motivo da situação, e a conta completa (`alvo Xd ⇒ Y un · Full tem Z ·
enviar W`). É o "mostre seu trabalho" da sugestão.

---

## 2.3. Shopee → Estoque & FBS (`/shopee/estoque`)

Estrutura simétrica ao Mercado Livre, mas dividida em **FBS** (produtos nos
armazéns da Shopee) e **Local** (estoque próprio, fora dos armazéns), porque
são fontes de dado diferentes.

### Cards do topo

- **Perda/dia — FBS** = soma da perda/dia dos SKUs zerados nos armazéns
- **Perda/dia — local** = soma da perda/dia dos anúncios zerados no estoque local
- **FBS crítico** = quantos SKUs no FBS têm cobertura menor que 7 dias
  (cobertura calculada **pela própria Shopee**, não pelo Oráculo)
- **Capital parado local** = soma de (estoque × preço) dos produtos locais
  sem venda em 60 dias. *(O card mostra também, no subtítulo, quantos itens
  estão parados no FBS — mas esse valor não entra na soma do card.)*

### Tabela 1 — Ruptura no FBS

**Quem entra:** SKU com estoque vendável ≤ 0 num armazém, e (velocidade > 0
OU vendeu algo nos últimos 30 dias).

**Diferença importante em relação ao Mercado Livre:** aqui, "Vendas 30/60d",
"Média/dia" e "Trânsito" **não são calculados pelo Oráculo** — vêm prontos da
própria API da Shopee (`last_30_sold`, `last_60_sold`, `selling_speed`,
`in_transit_qty`). É o dado mais confiável do sistema, porque a Shopee tem
visibilidade completa do armazém.

### Tabela 2 — Cobertura no FBS

**Quem entra:** SKU com estoque vendável > 0 e velocidade > 0.
**Cobertura em dias** também vem pronta da Shopee (`coverage_days`) — não é
recalculada. Mesmos limiares de status (Crítico <7d / Atenção <15d / OK).

### Tabela 3 — Ruptura de estoque local

Mesma lógica da Tabela 1 do Mercado Livre (anúncio zerado, vendeu em 60
dias), mas aplicada ao estoque próprio da Shopee — aqui sim a velocidade é
calculada pelo Oráculo (aproximação por dias-desde-a-última-venda).

### Tabela 4 — Estoque parado local

Produtos com estoque > 0 e sem venda nos últimos 60 dias. Não filtra por
curva nem por status do anúncio — mostra tudo que está parado.

### Filtro por loja (pills)

No lugar de um menu suspenso, o filtro de loja é uma fileira de "abas"
(pills) clicáveis: "Todas as lojas" + uma por loja. A Curva ABC é sempre
calculada sobre todos os produtos da loja, mesmo com um filtro aplicado —
para o ranking A/B/C não mudar dependendo do que está sendo visualizado.

---

## 2.4. Shopee → Sugestão de Reposição (`/shopee/reposicao`)

### A regra de negócio

```
repor = arredondar_para_cima(velocidade × (dias_alvo + dias_prazo))
        − estoque − trânsito
```

Nomenclatura equivalente à do Mercado Livre: "dias até coleta" vira "dias de
prazo" (o tempo para a reposição chegar).

### Dois ramos de cálculo — FBS e Local

**Ramo FBS** (produto nos armazéns Shopee): soma o estoque e o trânsito **de
todos os armazéns** daquele SKU (um produto pode estar em vários CDs) para
sugerir um único envio consolidado. A quantidade sugerida é limitada ao que
existe no estoque local — o sistema não inventa estoque, só realoca o que já
existe.

**Ramo Local** (produto sem FBS ativo): sugere repor comprando/produzindo. Um
produto que já foi tratado no ramo FBS nunca aparece de novo no ramo Local
(evita sugerir a mesma coisa duas vezes).

### As 4 situações

| Situação | Ramo | Quando |
|---|---|---|
| 🔴 Ruptura FBS | FBS | Estoque + trânsito no armazém ≤ 0 |
| 🔴 Crítico FBS (<7d) | FBS | Cobertura no armazém < 7 dias |
| 🔴 Ruptura local | Local | Estoque local ≤ 0 |
| 🟡 Abaixo do alvo | Ambos | Cobertura entre o crítico e o alvo definido |

### Kits ficam de fora — regra explícita

**Decisão de produto (2026-07-16):** *"kit é composto de produtos simples —
repõe-se o componente, não o bundle."* Qualquer anúncio ou variação cujo
nome contenha a palavra "Kit" é excluído da sugestão (em ambos os ramos). A
página mostra uma nota informando quantos kits foram excluídos.

> ⚠️ **Limitação conhecida:** a detecção é pelo **nome do produto**, não por
> um campo de cadastro. Um kit sem a palavra "kit" no título escaparia do
> filtro. Quando os SKUs da Shopee forem padronizados com os códigos do ERP,
> a detecção pode trocar para o campo `tipo = K` do Olist, que é infalível.

### Regra dos 15 por loja

Idêntica à do Mercado Livre (seção 2.2) — máximo 15 sugestões por loja,
ajustável na tela, e as demais lojas somam suas próprias 15 quando o filtro
está em "Todas as lojas".

### Painel "Cadastrar custos por SKU"

Formulário de texto (uma linha por SKU: `0770 12,50`) que alimenta o livro
de custos (seção 1.4) — aceita vírgula ou ponto decimal. O cadastro feito
aqui vale para Mercado Livre e Shopee ao mesmo tempo (SKUs iguais nos dois
canais compartilham o custo).

---

## 2.5. Shopee → Take Rate (`/shopee`)

Diferente das outras abas: não é sobre estoque, é sobre **quanto a Shopee
cobra** e **quanto sobra líquido** por pedido. A fonte é o extrato de escrow
(pagamento) da própria Shopee — cobre só pedidos com status `success` no
extrato, desde 01/07/2026.

### Cards do topo

- **Pedidos com extrato**: quantidade de pedidos no período com dado de
  pagamento já processado pela Shopee
- **Bruto (comprador)**: soma do que o comprador pagou
- **Taxas da Shopee**: soma de comissão + taxa de serviço + taxa de transação
  = `total de taxas ÷ bruto × 100` no subtítulo (o "take rate" propriamente dito)
- **Líquido a receber**: valor que efetivamente cai na conta (`escrow_amount`)
- **ROI líquido (com custo)**: `lucro líquido ÷ custo total × 100`, calculado
  **somente** sobre os SKUs que têm custo cadastrado (SKUs sem custo ficam de
  fora dessa conta, para não distorcer o número)

### Tabela "Por SKU"

O rateio de taxas por SKU dentro de um pedido com vários itens é
**proporcional ao valor de cada linha** — se um item representa 30% do valor
do pedido, ele absorve 30% das taxas daquele pedido. ROI por SKU só aparece
quando há custo cadastrado; senão mostra "-".

---

## 2.6. Curva de Venda e Curva de Estoque (Olist — regras mais antigas)

Estas duas páginas usam uma lógica **diferente** da do Mercado Livre/Shopee —
foram construídas antes e não seguem a mesma fórmula de velocidade/ruptura.
Importante não confundir as duas famílias de "curva":

### Curva de Venda (`/curva-de-venda`)

Classifica pela **recência da última venda** (não pela receita):
```
Curva A = vendeu nos últimos 90 dias
Curva B = vendeu entre 90 e 180 dias atrás
Curva C = mais de 180 dias sem vender (ou nunca vendeu)
```
Kits são excluídos desta análise.

### Curva de Estoque (`/curva-de-estoque`)

Classifica pela **cobertura projetada** (estoque atual ÷ ritmo médio
histórico de venda — não é uma janela móvel de 30/60 dias como no ML/Shopee,
é a média desde a primeira venda registrada do produto):
```
Curva A = estoque cobre até 3 meses
Curva B = estoque cobre de 3 a 6 meses
Curva C = estoque cobre mais de 6 meses
"Sem venda" = nunca vendeu (cobertura indefinida)
```
Aqui os kits **não** são excluídos.

---

## 2.7. Dashboard principal (`/`) — visão executiva

O dashboard home mistura duas fontes que é importante não confundir:

### "Venda por NF faturada" — a receita oficial

Vem das **notas fiscais emitidas** (não da criação do pedido). É o número
que a diretoria/contabilidade usa como verdade. Cards: Receita faturada, NFs
emitidas, Ticket médio faturado — cada um comparado com o **mesmo trecho do
mês anterior** (ex.: 12 dias de julho vs. 12 dias de junho, para a
comparação ser justa).

### "Margem e ROI fiscais" — regras Financeiro/Jacarta

Aplica as regras fiscais reais da empresa (Lucro Real com RET) sobre as NFs
válidas vinculadas a pedidos:
```
Lucro = Receita − Custo do produto − ICMS − PIS/COFINS − DIFAL
Margem fiscal = Lucro ÷ Receita (com custo)
ROI fiscal = Lucro ÷ Custo
```
**Não inclui** comissão de marketplace, frete ou investimento em anúncios —
é puramente a conta fiscal/tributária. O card mostra também "% da receita
coberta" — nem toda nota fiscal tem o item ligado a um custo conhecido ainda.

### "Operacional auxiliar" — pedidos, não notas fiscais

Métricas como "Pedidos confirmados" e "Receita de pedidos" são **auxiliares**
— baseadas na data do pedido, não na emissão da nota fiscal. Útil para
acompanhar o ritmo do dia a dia, mas **não é a receita oficial** (essa é a
seção "Venda por NF faturada" acima).

### Watchlist de ruptura (usada no badge de alertas da sidebar)

Um produto entra na lista de observação se: estoque ≤ 5 unidades, OU vai
durar menos de 14 dias no ritmo atual, OU nunca vendeu, OU não vende há mais
de 30 dias. Dentro dessa lista, o que já está zerado (ou vai zerar em até 7
dias) conta para o número vermelho no menu lateral ("Alertas").

---

## 2.8. Painel de SKUs (`/skus`) — margem operacional

Fórmula diferente da margem fiscal (seção 2.7) — é uma visão mais simples,
"o que sobra depois de custo, taxas de canal e frete":

```
Custo do produto = custo unitário × unidades vendidas (30d)
Custo de taxas = receita × (imposto + taxa marketplace + taxa pagamento)
Custo operacional = unidades × (subsídio de frete + embalagem por unidade)
Margem (R$) = Receita − Custo do produto − Custo de taxas − Custo operacional
Margem (%) = Margem (R$) ÷ Receita
ROI = Margem (R$) ÷ Custo do produto
```

**Sinalização do SKU:**
```
Sem venda em 30d               → "sem_venda"
Parâmetros do canal não configurados → "configurar_parametros"
Sem custo cadastrado            → "sem_custo"
Margem abaixo do mínimo (padrão 12%)  → "crítico"
Margem abaixo da meta (padrão 25%)    → "atenção"
Senão                           → "saudável"
```

> A margem **fiscal** detalhada (ICMS/PIS-COFINS/DIFAL) só existe para
> produtos vendidos pelo Olist — a Shopee compartilha o catálogo de SKUs, mas
> não passa pela cadeia de nota fiscal do Olist, então não tem esse
> detalhamento.

---

# PARTE 3 — Páginas operacionais e de configuração

Estas páginas não são "análise de estoque" — são alertas, configuração,
ferramentas auxiliares e administração. Documentadas com o mesmo rigor.

## 3.1. Alertas (`/alertas`)

É a lista priorizada de "o que precisa de atenção agora", construída sobre a
mesma base usada no badge vermelho da sidebar.

**Os 5 estados possíveis de um produto (`stock_signal`):**
```
Não sabemos o estoque dele                    → "sem_estoque_mapeado"
Estoque ≤ 0                                    → "ruptura"
Estoque > 0 mas cobertura ≤ 7 dias              → "ruptura_iminente"
Nunca vendeu                                    → "sem_venda"
Não vende há mais de 30 dias                    → "parado"
Nenhum dos anteriores                           → "ok" (não aparece na lista)
```

**Quem entra na lista de observação** (antes mesmo de olhar o estado acima):
estoque ≤ 5 unidades, OU cobertura ≤ 14 dias, OU nunca vendeu, OU mais de 30
dias sem vender. Ou seja, a lista é propositalmente ampla — pega tanto quem
já está em problema quanto quem está "no radar".

### Cards do topo

- **Ruptura**: contagem exata de produtos com estoque zerado (conta o total
  real, não só os que aparecem na tabela abaixo).
- **Ruptura iminente**: contagem de produtos com cobertura ≤ 7 dias.
- **Parados / sem venda**: soma de "parado" + "sem venda".

> ⚠️ **Importante:** os cards contam o **total real** no banco. A tabela
> abaixo mostra só os **120 mais urgentes** (menor cobertura primeiro). Se o
> card disser "45 em ruptura" mas a tabela mostrar só 30 linhas com esse
> rótulo, é porque os outros 15 estão fora da amostra dos 120 — não é erro.

### Tabela "Prioridade de ação"

Ordenada por cobertura (menor primeiro, os sem-estoque-mapeado ficam por
último). Colunas: Alerta, Fonte (Shopee/Olist/Outros), SKU, Produto (link
direto para o SKU em `/skus`), Disponível, Cobertura, Vendas 30d, Receita 30d.

**Atualização:** esta lista **não é calculada na hora** — vem de uma tabela
pré-calculada que é atualizada pelo mesmo processo horário que atualiza as
vendas da Olist (`olist-derived-refresh`). Pode haver um atraso de até 1 hora
entre uma venda acontecer e ela refletir aqui.

---

## 3.2. Calculadora de Precificação (`/calculadora`)

Ferramenta de simulação — **não lê nem grava nada no banco de dados**. É só
para testar "se eu vender por X, quanto sobra?" antes de publicar um anúncio.
Por isso ela é **independente** da margem fiscal/operacional do resto do
sistema — usa taxas fixas digitadas na hora, não o livro de custos real.

### Como calcular o preço de venda

Você escolhe um de dois modos:
- **Por markup**: informa quantas vezes quer multiplicar o custo (ex.: 2,5×)
  → o preço de venda sai sozinho.
- **Por preço de venda**: informa o preço direto e a calculadora acha o
  markup implícito.

### A fórmula completa

```
Custo total = custo unitário × quantidade de unidades no anúncio
Valor agregado = Preço de venda − Custo total

Comissão do marketplace = Preço × taxa da faixa de preço (+ valor fixo da faixa)
ICMS (MG) = Preço × 1,3%              (editável)
DIFAL = Preço × 6%                    (editável)
PIS/COFINS = Valor agregado × 9,25%   (editável — atenção: incide sobre o
                                        valor agregado, não sobre o preço cheio)
Ads = Preço × 3%                      (editável)
Custo operacional fixo = Preço × 3%   (editável)
Devolução média = R$ 1,00 fixo        (não é percentual)

Custo total real = Custo do produto + Comissão + ICMS + DIFAL + PIS/COFINS
                  + Ads + Operacional + Devolução média

Lucro líquido = Preço de venda − Custo total real
Margem líquida = Lucro líquido ÷ Preço de venda
```

**Selo de resultado:**
```
Lucro líquido negativo         → "Prejuízo" (vermelho)
Margem líquida menor que 10%   → "Margem baixa" (amarelo)
Caso contrário                 → "Rentável" (verde)
```

### Tabelas de comissão por marketplace (valores hardcoded na calculadora)

| Marketplace | Faixa de preço | Comissão | + Fixo |
|---|---|---|---|
| **Shopee** | até R$79,99 | 20% | R$4,00 |
| | até R$99,99 | 14% | R$16,00 |
| | até R$199,99 | 14% | R$20,00 |
| | até R$499,99 | 14% | R$26,00 |
| | acima | 14% | R$28,00 |
| **ML Clássico** | até R$28,99 | 13% | R$6,25 |
| | até R$49,99 | 13% | R$6,50 |
| | até R$78,99 | 13% | R$6,75 |
| | acima | 13% | R$0,00 |
| **ML Premium** | mesmas faixas do Clássico | 18% | (mesmos valores fixos) |
| **TikTok Shop** | até R$78,99 | 6% | R$4,00 |
| | acima | 6% | R$0,00 |

> Notas do próprio sistema: itens abaixo de R$12,50 no Mercado Livre pagam
> uma tarifa especial (50% do valor do item) que **não está modelada** aqui;
> o programa de frete grátis da TikTok Shop (SFP, ~6% adicional, teto R$50)
> também não está incluído. Trate os resultados da calculadora como
> estimativa, não como o valor final exato.

Todas as taxas e faixas são editáveis na tela; o botão "Restaurar padrão"
volta aos valores acima.

---

## 3.3. Importações (`/importacoes` e `/importacoes/cadastro`)

Rastreamento de containers marítimos vindos da China, com mapa ao vivo das
posições dos navios (AIS).

### Cards do topo

- **Navios em rota** = quantidade de navios únicos identificados (depois do
  agrupamento por nome/apelido, ver abaixo); subtítulo mostra quantos têm
  posição de GPS conhecida.
- **Faturas ativas** = total de faturas cadastradas (da planilha + manuais).
- **Itens embarcados** = total de linhas de item em todas as faturas.
- **Próxima chegada** = a data de chegada mais próxima, entre todos os
  navios, que ainda não passou.

### Como o sistema identifica "qual navio é qual"

Este é o ponto mais delicado da funcionalidade: a planilha de origem escreve
o nome do navio de formas diferentes em faturas diferentes (abreviações,
erros de digitação). O sistema tenta casar pelo **nome oficial ou por um dos
apelidos cadastrados** em `/importacoes/cadastro` → aba Navio. Faturas cujo
nome não bate com nenhum navio cadastrado (nem como oficial, nem como
apelido) viram um "navio" separado — mesmo que seja fisicamente o mesmo
navio de outra fatura.

> **Na prática:** se um navio aparece duplicado no mapa, o problema quase
> sempre é um apelido faltando no cadastro daquele navio — não um bug.

A posição no mapa (GPS) só aparece se o navio tiver um **MMSI** cadastrado —
é esse número que liga o registro à posição de satélite (AIS). Sem MMSI, o
navio aparece nas listas mas não no mapa.

### O mapa

Mostra só navios com posição conhecida. Passar o mouse (ou clicar) abre um
balão com: destino(s), próxima chegada, número de faturas e a lista de itens
a bordo daquele navio.

### Cadastro (`/importacoes/cadastro`)

Três formulários:
- **Fatura**: número (obrigatório), datas de produção, BL, container, navio,
  destino, data de chegada, valores (aceita `1.234,56` no formato brasileiro).
- **Item**: descrição (obrigatória), fatura vinculada, quantidade, custo
  unitário, quantidade de caixas, CBM (metragem cúbica) — **CBM total não é
  calculado automaticamente**, precisa ser digitado.
- **Navio**: nome oficial, apelidos (separados por vírgula), IMO, MMSI. É
  aqui que se resolve o problema de "navio duplicado" citado acima.

---

## 3.4. Parâmetros (`/parametros`)

A tela onde a equipe cadastra os dados que **não vêm automaticamente** de
nenhuma integração — e que alimentam o cálculo de margem visto em `/skus`.

### Parâmetros por canal (Olist / Shopee)

| Campo | O que controla |
|---|---|
| Imposto (%) | Alíquota de imposto sobre a venda |
| Comissão do marketplace (%) | Taxa cobrada pelo canal de venda |
| Taxa de pagamento (%) | Taxa do meio de pagamento |
| Frete subsidiado por unidade (R$) | Quanto a empresa paga de frete por unidade vendida |
| Custo de embalagem por unidade (R$) | Custo de embalagem por unidade |
| **Margem meta (%)** | Acima disso, o SKU é "saudável". Padrão: **25%** |
| **Margem mínima (%)** | Abaixo disso, o SKU é "crítico". Padrão: **12%** |
| Parâmetros configurados? | Enquanto não marcado, a margem daquele canal fica com status "configuração pendente" em vez de calcular |

Estes valores são a fonte de verdade usada na fórmula de margem do `/skus`
(ver seção 2.8).

### Overrides por SKU

Permite corrigir, produto a produto, o custo unitário ou as metas de margem
— sobrepõe o valor do canal só para aquele SKU específico. Precisa estar
marcado como "ativo" para valer.

### Regras por UF (Estado)

Cadastro de alíquota de ICMS (interna e interestadual), FCP e DIFAL por
estado — as 27 UFs já vêm pré-cadastradas, com todas as alíquotas zeradas e
marcadas como "pendente de validação fiscal" até o contador revisar.

O DIFAL e a "alíquota efetiva" **são recalculados automaticamente** pelo
banco de dados sempre que a linha é salva:
```
DIFAL = máximo(ICMS interno do estado − ICMS interestadual, 0)
Alíquota efetiva = ICMS interestadual + DIFAL + FCP
```

> ⚠️ **Lacuna conhecida:** hoje esta tabela de UF **é só cadastro** — ela
> ainda **não está conectada** ao cálculo de margem do `/skus` nem à margem
> fiscal da home. A margem fiscal (home e `/skus`) usa uma tabela por UF
> separada, definida direto no código SQL, não esta tela. Preencher os
> valores aqui, hoje, não muda nenhum número do sistema — é uma frente
> preparada para uma integração futura.

### Cards do topo

SKUs analisados (amostra de até 5.000 linhas), Com custo, Sem custo, e
quantas fontes distintas (Olist/Shopee/outros) têm parâmetro cadastrado.

---

## 3.5. Status do Sync (`/status`)

Painel técnico de saúde das integrações — "está tudo se atualizando
sozinho?". Pensado para diagnóstico rápido, não para análise de negócio.

### O que cada selo de status significa

| Selo | Significado |
|---|---|
| 🟢 **OK** | Última execução terminou com sucesso |
| 🟡 **Parcial** | Terminou, mas só processou parte dos dados |
| 🟡 **Rodando** | Está em execução agora |
| 🔴 **Falhou** | Terminou com erro (ou qualquer status não reconhecido) |
| ⚪ **Sem execução** | Nunca rodou (ou não há registro) |

### As integrações monitoradas aqui

Pedidos (Olist), Estoque/produtos (Olist), Notas fiscais (Olist), Backfill de
itens (Olist), Mercado Livre, Importações (AIS).

> ⚠️ **Lacuna conhecida:** a sincronização da **Shopee** (pedidos, escrow,
> FBS, produtos) **não aparece nesta página** — apesar de estar rodando
> normalmente em segundo plano (ver `docs/deployment-map.md` para a cadência
> real). Se algo parar de atualizar na Shopee, hoje **não há alerta visual**
> aqui; é preciso checar direto no banco (`shopee_sync_runs`).

### Quando um alerta vermelho aparece no topo

O sistema soma vários motivos possíveis num único aviso — qualquer um destes
liga o alerta:
- Token de acesso à Olist vencido ou ausente
- A Olist ou o Mercado Livre recusaram a renovação automática do acesso
  (precisa reconectar manualmente)
- Algum sync terminou com erro
- O sync de **pedidos**, **estoque** ou **Mercado Livre** especificamente
  ainda não rodou hoje (comparando pela data de São Paulo)

*Nota técnica: notas fiscais, backfill e importações não têm o alerta de
"ainda não rodou hoje" — só o alerta de erro explícito.*

---

## 3.6. Exportar receita fiscal (botão "Exportar" na home)

Não é uma página — é um botão na tela principal que baixa um arquivo `.csv`
com a receita faturada por dia, no mesmo período selecionado no dashboard
(data de emissão da nota, quantidade de notas válidas, receita e ticket
médio por dia). Usa a mesma definição de "nota fiscal válida" da seção 2.7
(exclui canceladas e devoluções).

---

## 3.7. Usuários (`/usuarios`)

Tela de administração de acesso — só visível para quem tem perfil
"administrador". Permite criar contas (com senha já confirmada, sem
necessidade de e-mail de verificação), editar e-mail/nome/perfil/senha, e
bloquear/desbloquear o acesso de alguém. Bloquear não apaga a conta — apenas
impede o login (por ~100 anos, na prática permanente até ser desbloqueada
manualmente).

---

## Tabela-resumo dos limiares hardcoded (para consulta rápida)

| Limiar | Valor | Onde se aplica |
|---|---|---|
| Cobertura crítica | < 7 dias | ML Full, Shopee FBS |
| Cobertura em atenção | < 15 dias | ML Full, Shopee FBS |
| Critério de "ainda vende" (ruptura) | venda nos últimos 60 dias | ML e Shopee |
| Tendência "crescendo"/"caindo" | variação > ±15% | ML e Shopee |
| Parado → "avaliar retirada" | > 120 dias sem venda | ML |
| Ruptura iminente (watchlist home) | cobertura ≤ 7 dias | Dashboard |
| Entrada na watchlist (home) | estoque ≤5 OU cobertura ≤14d OU nunca vendeu OU +30d sem venda | Dashboard |
| Itens por loja na sugestão | máx. 15 (ajustável 1–100) | ML e Shopee |
| Linhas máximas nas tabelas de estoque | 150 | ML e Shopee |
| Janela de histórico para tendência | 120 dias (4 blocos de 30) | ML e Shopee |
| Curva ABC — corte A/B/C | 80% / 95% acumulado | ML e Shopee |
| Margem mínima/meta padrão (SKUs) | 12% / 25% | `/skus`, `/parametros` |
| Snapshots mínimos p/ velocidade "real" | 15 dias | Mercado Livre |
| Entrada na lista de Alertas | estoque ≤5 OU cobertura ≤14d OU nunca vendeu OU +30d sem venda | `/alertas` |
| Margem líquida baixa (calculadora) | < 10% | `/calculadora` |
| Bloqueio de usuário | ~100 anos (permanente na prática) | `/usuarios` |
| Limite de linhas em Alertas | 120 (mais urgentes; cards contam o total real) | `/alertas` |

## Lacunas conhecidas (registradas para não gerar confusão)

- **Regras de UF em `/parametros` não estão conectadas ao cálculo de
  margem** — hoje é só cadastro, aguardando integração. A margem fiscal
  real (home e `/skus`) usa uma tabela de UF definida direto no código, não
  esta tela.
- **A sincronização da Shopee não aparece em `/status`** — roda normalmente
  em segundo plano, mas não há alerta visual ali se parar. Conferir direto
  em `shopee_sync_runs` se houver suspeita de atraso.
- **A lista de Alertas atualiza a cada hora**, não em tempo real — pode haver
  até 1h de atraso entre uma venda e o reflexo na lista.
- **A calculadora de precificação não modela** a tarifa especial de itens
  baratos no Mercado Livre nem o programa de frete grátis da TikTok Shop —
  trate o resultado como estimativa.

---

## Como manter isto atualizado

Este documento foi gerado lendo o código-fonte diretamente — Parte 1/2
(`apps/web/app/mercado-livre/`, `apps/web/app/shopee/`, `apps/web/app/page.tsx`,
`apps/web/app/skus/`, `apps/web/app/pedidos/`, `apps/web/lib/column-hints.ts`)
e Parte 3 (`apps/web/app/alertas/`, `apps/web/app/calculadora/`,
`apps/web/app/importacoes/`, `apps/web/app/parametros/`,
`apps/web/app/status/`, `apps/web/app/export-fiscal/`,
`apps/web/app/usuarios/`), além das migrations SQL das views/RPCs — em
2026-07-17. Se uma fórmula, limiar ou regra mudar no código, este documento
**fica desatualizado** até alguém revisá-lo — ele não se atualiza sozinho.

Sinal de que precisa revisão: qualquer PR que mexa em
`build-suggestions.ts`, `build-estoque.ts`, `data.ts` (ML ou Shopee),
`column-hints.ts`, `calculator.tsx`, nas migrations de
`oraculo_margin_*`/`oraculo_state_tax_params`/`oraculo_stock_watchlist_*`,
ou na lista de sync exibida em `/status`.
