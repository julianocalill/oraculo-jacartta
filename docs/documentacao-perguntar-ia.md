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

**A URL tem path.** O Traefik roteia o Ollama em
`https://ia.oliverhome.com.br/ollama` (`PathPrefix` + `stripprefix`); a raiz do
domínio é o Open WebUI, não a API. Apontar para a raiz devolve HTML.

## Medições no servidor real (2026-08-21)

VPS `129.121.53.71`: 6 vCPUs, 15 GB de RAM, **46 containers**, **sem GPU** —
inferência 100% em CPU. Modelos instalados: `qwen2.5-coder:7b` (4,7 GB),
`qwen3.5` (6,6 GB), `gemma4` (9,6 GB), `nomic-embed-text`.

| Cenário | Tempo |
|---|---|
| Cold start (modelo fora da memória) | 10,7 s |
| Com o modelo carregado | 6,3 – 7,6 s |
| Prompt real da aplicação | 10,5 – 14,7 s |

O modelo fica residente por 5 minutos após a última chamada. Durante a
inferência a RAM disponível cai de **6,5 GB para 1,8 GB** — funciona, mas é a
folga inteira da máquina, que roda Metabase, n8n, Chatwoot, Evolution API e
mais 40 containers.

Três casos testados contra o servidor real, com o prompt exato da aplicação:

1. "quanto eu faturei por canal em julho" → `oraculo_fiscal_invoices_valid`, e
   citou `channel_label`. Correto.
2. "quais produtos vão acabar no estoque" → `oraculo_stock_watchlist_unified`.
   Correto.
3. "qual a cor favorita do meu cachorro" → *"Não há informações disponíveis no
   catálogo"*, com `objetos: []`. **Não alucinou** — que é o caso que mais
   importa.

### Por que o prompt não lista as receitas

A primeira versão pedia ao modelo que escolhesse também a receita de SQL. Ele
devolveu `receita: null` em todas as tentativas, inclusive com instrução
explícita. Como o estágio determinístico já acerta a receita (7 de 7 nas
perguntas testadas) e a tela a mostra em destaque, o campo saiu do contrato:
prompt menor, e na CPU cada linha a menos são segundos.

## Riscos da chamada direta Vercel → VPS

A decisão foi chamar a VPS direto, sem o n8n no meio. O código protege o lado
dele — timeout de 25s, `num_predict` de 320, degradação silenciosa em qualquer
falha — mas **dois riscos são de infra e não dá para resolver aqui**:

### 1. O Ollama está aberto na internet (verificado em 21/08)

`https://ia.oliverhome.com.br/ollama/api/tags` responde **200 sem nenhuma
autenticação**. As labels do Traefik em `ollama_ollama` têm apenas
`stripprefix` — não há middleware de auth:

```
traefik.http.routers.ollama.rule: Host(`ia.oliverhome.com.br`) && PathPrefix(`/ollama`)
traefik.http.routers.ollama.middlewares: ollama-strip
```

Como o proxy repassa a API inteira, isso expõe também as rotas de escrita do
Ollama (`/api/pull`, `/api/delete`, `/api/create`): qualquer pessoa na internet
pode consumir a CPU da VPS, baixar modelos até encher o disco ou apagar os que
existem.

**O n8n NÃO usa a rota pública — verificado em 21/08.** A credencial
(`Ollama Local - ia.oliverhome.com.br`, tipo `ollamaApi`) está criptografada,
mas a dedução é conclusiva:

- O workflow de Ads rodou **com sucesso todos os dias às 08:00** entre 11/08 e
  21/08 (execuções `16388` a `23471`).
- O access log do Traefik cobre 13/08–21/08 com **419.334 requisições**, e nesse
  período houve **12 chamadas ao `/ollama` — todas de testes manuais em 21/08**.

Se a credencial usasse a URL pública, cada execução diária teria deixado rastro
no access log. Não deixou: o n8n fala com o Ollama pelo host interno
(`http://ollama:11434`, confirmado respondendo de dentro do worker), pela rede
`JacarttaNet` que os dois compartilham.

**Conclusão: adicionar basic auth na rota pública não quebra o relatório de
Ads.**

Correção sugerida (basic auth só na rota pública, n8n seguindo pelo interno):

```
traefik.http.middlewares.ollama-auth.basicauth.users: <usuario>:<hash-htpasswd>
traefik.http.routers.ollama.middlewares: ollama-strip,ollama-auth
```

e então preencher `OLLAMA_TOKEN` — hoje vazio, porque não há o que autenticar.

### 2. Carga sobre uma VPS compartilhada

46 containers de produção dividem 6 vCPUs sem GPU, e a inferência consome a
folga inteira de RAM (6,5 GB → 1,8 GB). O doc do relatório de Ads já registra
`gemma4` e `qwen3.5` "excedendo a capacidade segura e reiniciando
Ollama/workers". Um relatório roda 1x a cada 3 dias; uma busca na tela roda
quando qualquer pessoa quiser. Vale limitar taxa no Cloudflare antes de liberar
a aba para todo mundo.

Latência esperada: as functions rodam em `iad1` (EUA) e a VPS está no Brasil.
Um 7B leva dezenas de segundos. Por isso o resultado determinístico aparece
primeiro e a IA chega depois — a tela nunca fica esperando.

## O que mudou junto

A aba **Conectar BI** foi removida (rota `/documentacao/conectar` e
`connection.ts`). O passo a passo de Metabase/PowerBI e os avisos sobre a porta
6543, DirectQuery e "a conexão consegue escrever" saíram do app.
