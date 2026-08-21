# Busca em linguagem natural na Documentação (`/documentacao/perguntar`)

## O que é

Uma caixa onde a pessoa descreve em português o que quer saber ("quanto eu
faturei por canal em julho") e recebe **o caminho**: qual view usar, qual
receita de SQL já resolve o caso e quais armadilhas se aplicam.

**Ela não devolve números e não escreve SQL.** O número sai do Metabase ou do
PowerBI depois, com a certeza de estar olhando o lugar certo.

## Por que não gera SQL

Este é o banco onde somar duas fontes dobra o faturamento (R$ 12,7 mi contra
R$ 8,27 mi reais) e contar pedidos na tabela errada erra por 3x. As dez
armadilhas existem justamente porque são os casos em que **o SQL parece
certo**. Um modelo com o schema na mão cai em todas elas, e SQL que roda e
devolve número errado é o pior resultado possível aqui — pior que nenhuma
resposta, porque ninguém desconfia.

## Arquitetura: dois estágios

### 1. Recuperação determinística (`app/documentacao/ask.ts`)

Roda sempre, sem IA, em milissegundos. Pontua objetos, receitas e armadilhas
contra a pergunta usando um **vocabulário de negócio** (`SYNONYMS`): ninguém
digita `billed_revenue`, digita "quanto eu faturei".

Duas lições que só apareceram testando:

- **Alvo curto casa como substring em quase todo nome.** `sku` casa em
  `oraculo_fiscal_sku_margin`, `oraculo_sku_unit_cost` e mais uma dúzia. Com
  peso igual, "quais produtos vão acabar no estoque" trazia *Margem e ROI por
  SKU* em primeiro e a receita de ruptura em quarto. Hoje nome completo de
  objeto vale 6, termo longo vale 3, e termo curto vale 1 exigindo palavra
  inteira.
- **As armadilhas vêm da curadoria, não do score.** Cada receita já declara em
  `recipes.ts` quais armadilhas ela evita; essa ligação foi feita à mão e é
  mais confiável que qualquer pontuação por texto. A armadilha declarada pela
  receita mais bem colocada entra com peso 10.

O limiar de exibição é alto de propósito: **três armadilhas irrelevantes
ensinam a ignorar o bloco inteiro**, e aí a que importa passa batida também.
"Quais produtos vão acabar no estoque" mostra uma armadilha, não três.

### 2. Redação pela IA (`app/documentacao/ollama.ts`)

O modelo recebe **apenas os candidatos do estágio 1** — nunca o schema inteiro
— e escolhe entre eles. É o mesmo princípio já usado no relatório de Shopee
Ads: a IA redige, o código decide o que é verdade.

**Toda tabela citada é validada contra o catálogo antes de aparecer na tela.**
Se o modelo inventar `vendas_totais`, o nome é descartado e a tela diz que foi
descartado. O leitor vê o aviso, não a invenção.

A seção da IA é renderizada dentro de um `<Suspense>`: a página aparece na
hora com o resultado determinístico completo, e a leitura por IA chega quando
chegar. Zero client JS.

## Configuração

`OLLAMA_URL`, `OLLAMA_MODEL` (padrão `qwen2.5-coder:7b`) e `OLLAMA_TOKEN` no
`.env` / variáveis da Vercel. **Sem `OLLAMA_URL` a busca funciona normalmente**,
só sem o parágrafo da IA.

## Riscos da chamada direta Vercel → VPS

A decisão foi chamar a VPS direto, sem o n8n no meio. O código protege o lado
dele — timeout de 25s, `num_predict` de 320, degradação silenciosa em qualquer
falha — mas **dois riscos são de infra e não dá para resolver aqui**:

1. **Autenticação.** Hoje o acesso ao Ollama é por credencial n8n. Chamando
   direto, o endpoint precisa exigir token (`OLLAMA_TOKEN`), senão fica um
   Ollama aberto na internet aceitando qualquer prompt.
2. **Carga.** A VPS é compartilhada — a calculadora está no mesmo IP. O doc do
   relatório de Ads registra `gemma4` (9,6 GB) e `qwen3.5` (6,6 GB)
   "excedendo a capacidade segura e reiniciando Ollama/workers". Um relatório
   roda 1x a cada 3 dias; uma busca na tela roda quando qualquer pessoa quiser.
   Vale limitar taxa no Cloudflare antes de liberar para todo mundo.

Latência esperada: as functions rodam em `iad1` (EUA) e a VPS está no Brasil.
Um 7B leva dezenas de segundos. Por isso o resultado determinístico aparece
primeiro e a IA chega depois — a tela nunca fica esperando.

## O que mudou junto

A aba **Conectar BI** foi removida (rota `/documentacao/conectar` e
`connection.ts`). O passo a passo de Metabase/PowerBI e os avisos sobre a porta
6543, DirectQuery e "a conexão consegue escrever" saíram do app.
