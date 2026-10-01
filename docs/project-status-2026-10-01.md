# Estado do projeto — 01/10/2026

## Separação local: Full excluído e Grupo congelado

Migration `20261001170138_logistica_separacao_excluir_full.sql` aplicada via
CLI `db query --linked --file` em 01/10, após regressão em transação com
rollback. A seleção pública de Uberlândia exclui pedidos Full antes de
contar pedidos, consolidar SKUs e expandir kits. O mesmo classificador filtra
`logistica_picking_missing_order_ids`, impedindo hidratação/bloqueio por um
pedido Full sem itens. A identificação usa depósito/canal do pedido Olist ou
ID/tipo/nome do depósito cadastrado na mesma operação. Não exclui a loja
Shopee inteira nem SKUs compartilhados com vendas locais; Amazon Onsite
continua separado de Full Amazon. APIs/fiscal/Giracasa não foram alterados.

Validação na janela original das 07h, com fonte atual consultada às 14:31:53
BRT: **1.147 → 937 pedidos; 3.381 → 2.577 unidades físicas; 80 → 75 SKUs**.
Foram retirados **210 pedidos / 804 unidades Full** (724 Shopee + 80 ML),
sem Full escapando quando comparado à logística Shopee/canal ML de forma
independente. Pistola 110V: 13 → 1; panela 220V: 4 → 0; tapete 50×60/50un:
72 → 29 pacotes. Chaleiras branca 110V/220V seguem 103/55; Full não explica
as divergências relatadas nessas chaleiras.

A lista pronta `bc487592-ad7f-44e1-b629-43b5543c45b9` continua com seus
1.141 pedidos / 3.372 unidades. Nenhum documento, cursor ou WhatsApp foi
reescrito/reprocessado. Novas gerações usam a regra corrigida. O recálculo
não representa exatamente o estado da fonte às 07h e ainda não está
conciliado com o lote de etiquetas entregue. O erro do enum de cancelamento
Olist e a definição do lote impresso continuam pendentes de correção separada.

A coluna **Grupo** agora é persistida em `logistica_picking_itens.product_group`
na finalização: categoria Olist por SKU físico + operação, agregada sem
multiplicar linhas. Migration `20261001175828` aplicada em 01/10. Documentos
anteriores ficam com NULL ("Grupo não registrado"); novas linhas sem categoria
ficam "Sem grupo no cadastro". Finalizar um documento `ready` retorna a mesma
fotografia, preservando também Grupo. Impressão/CSV leem o mesmo campo, e a
tela mostra o card "Unidades a separar". O workflow n8n ativo foi atualizado
com backup e conferência dos três nós (consolidado, consulta do documento e
formatadores de CSV/WhatsApp); nenhum envio foi disparado na implantação.

A lista personalizada desta tarde `46ddb552-791a-4b50-a7e3-a6c11784f115` mantém
537 pedidos / 1.518 unidades / 57 linhas / 29 caixas / 960 avulsas. Suas 57
linhas receberam exatamente os grupos do PDF já entregue, sem recalcular
quantidades. [Registro da tarde](analyses/separacao-2026-10-01-1330/README.md).

Testes: duas regressões SQL em transação revertida (exclusão Full e grupos,
duplicados, ausência, imutabilidade e permissões); oito testes de
consolidação/CSV/WhatsApp, 93 de domínio, TypeScript e build Next.js passaram.
RPC executada pelo service_role em ~140 ms na janela da manhã. Advisors
consultados sem alteração das políticas/grants existentes. Frontend validado
localmente, publicação em andamento para os dois remotes e Vercel.

## Shopee Ads: cenários para orçamento ilimitado

O usuário confirmou que todas as campanhas usam orçamento ilimitado. A aba
`/ads/analisar-print` passa a cruzar ROAS realizado versus meta com crescimento
de impressões do mesmo anúncio em períodos equivalentes. São quatro cenários:
meta atingida/abaixo × entrega crescendo/sem crescimento. Crescimento significa
ao menos +10% de impressões; é um critério operacional do Oráculo, não da
Shopee. Cliques e CTR diagnosticam se a exposição trouxe tráfego.

A classificação pede meta, impressões anteriores, dois períodos iguais de ao
menos sete dias completos, e janela atual após a última mudança de meta ou
oferta. Cliques anteriores completam a leitura, mas não bloqueiam cenário.
Redução de meta de 10% só é sugerida com margem informada e tanto ROAS
realizado quanto nova meta acima do equilíbrio (`100 / margem %`). Sem esses
dados, a ação é revisar a economia e o anúncio; não se inventa gasto máximo.
O protótipo macOS chama `packages/domain/ads-print.js` pelo Node.js, evitando
duas regras distintas. Contrato: `docs/shopee-ads-dashboard.md`.

Validação: oito testes de domínio para os quatro quadrantes, janelas inválidas
e trava de margem; seis testes do protótipo macOS, TypeScript e build Next.js
passaram. Interface conferida visualmente. Commit `2d10dd9` enviado a `origin`
e `personal`; deploy Vercel `dpl_4HJ3aX2spfodNYmjgX4eRAqN9C5d` ficou
`Ready` com alias `oraculo.oliverhome.com.br` em 01/10.

## Upload de devoluções TikTok: correção em produção

Upload TikTok corrigido e filtro de SKUs por motivo publicados em 01/10.
Commit `dc6d7fda3b636102ea48a4131eb92584ea65e861` enviado ao `main` dos
remotes `origin` e `personal`. Deploy Vercel `dpl_4wTnX7DZz9YzgiLyNbnDHn118DtA`
confirmado `Ready`, com o alias `oraculo.oliverhome.com.br` e a rota
`devolucoes` no build. Não houve gravação de devoluções no banco durante
o diagnóstico; a migration do filtro foi aplicada nas duas operações.

### Causa medida no arquivo real

A exportação `Pedidos de devolução_reembolso-2026-10-01-08_55.xlsx`
tem 120.176 bytes e uma aba chamada `0`, identificada pelo usuário como
**Donacor**. São 25 colunas × 500 linhas lógicas (cabeçalho + 499 registros),
mas o XML em `xl/worksheets/sheet2.xml` contém **12.500 elementos `<row>`**:
cada célula foi escrita em um novo elemento com o mesmo atributo `r` da linha.
O ExcelJS sobrescreve os fragmentos anteriores e deixa apenas a última coluna
(`Buyer Note`). O parser anterior ignora a aba por ausência dos cabeçalhos
obrigatórios. O Server Action descartava o relatório retornado, por isso
o erro não aparecia na tela nem havia um novo lote válido.

### Correção

- `returns-import.ts` reúne os fragmentos XML pelo número de linha antes de
  carregar no ExcelJS. Strings e referências das células são preservadas;
  arquivos com linhas normais não são recompactados.
- Abas genéricas (`0`, `Sheet1`, `Planilha1`) precisam da loja escolhida no
  formulário; sem escolha, o parser devolve um aviso e não grava conta `0`.
  Abas identificadas continuam determinando a loja pelo nome.
- `devolucoes/actions.ts` mantém autorização por aba e gravação pelo importador
  existente. `upload-form.tsx` exibe progresso, resultado, falha e até 30 avisos.
- Reimportação mantém a chave existente `(channel, return_id)`; não há migration.

### Validação

O parser corrigido leu o arquivo original sem salvar uma versão alterada:

| Controle | Resultado |
| --- | ---: |
| Linhas válidas | 499 |
| Erros / duplicatas | 0 / 0 |
| Loja | Donacor em todas as linhas |
| Aceitas / abertas / recusadas | 229 / 138 / 132 |
| Devolução e reembolso / só reembolso | 315 / 184 |
| Quantidades assumidas | 0 |

IDs longos continuam como texto. As datas correspondem a setembro/2026 no
fuso de São Paulo. Valores de `Return unit price` continuam representando o
total do estorno; não são multiplicados pela quantidade. Recusadas permanecem
fora das perdas pela regra canônica existente.

Testes de regressão: `node --test scripts/returns-import.test.cjs` cobre
fragmentação, preservação de IDs/datas/valores, loja obrigatória em aba genérica
e compatibilidade com arquivo normal e loja nomeada. TypeScript, os 91 testes
de domínio e o build de produção passaram. A validação não exerceu gravação
no Supabase nem o formulário em uma sessão de navegador autenticada.

### Uso da versão publicada

Enviar o arquivo original pela aba Devoluções, escolhendo **Donacor** no
formulário. Não é necessário renomear a aba nem salvar uma cópia no Excel.
O manifesto de novidades foi atualizado para a publicação de 01/10 às 09h50
(São Paulo).

## Filtro de SKUs pelo motivo da devolução

Solicitação: clicar em “Avaria no transporte” na seção Motivos deve filtrar
“Onde a devolução se concentra”; sem motivo escolhido, a lista continua geral.

Publicado em `/devolucoes`:

- Motivo na tabela, legenda e fatia da rosca são links. `?motivo=` guarda a
  seleção, junto das datas e canal; troca de datas/canal mantém o motivo.
- A seleção aparece junto ao ranking com “Limpar motivo”. Clicar novamente
  no motivo ativo também limpa. A navegação leva à tabela de SKUs.
- O motivo afeta apenas a tabela de concentração. Os cards e demais gráficos
  continuam representando o período/canal, inclusive o custo dos top 25 gerais.
- Erro da consulta exibe mensagem; não é apresentado como “sem dados”.

Migration `20261001123201_returns_sku_reason_filter.sql` **aplicada ao banco**
em 01/10. Acrescenta sobrecarga de cinco parâmetros obrigatórios de
`oraculo_returns_by_sku` em `public` e `giracasa`; a assinatura legada de quatro
parâmetros permanece, inclusive seus comentários. Filtro por `reason_group`
vem antes de agrupar e limitar: filtrar somente os top 25 antigos esconderia
produtos relevantes para um motivo. Mantém `counts_as_loss`, valor efetivo e
o livro canônico de custos. Não modifica dados comerciais.

Permissões seguem os wrappers do ADR-006: autenticação, gate explícito
`can_access_operation`, `search_path=''`, nomes qualificados e execução anônima
revogada. O advisor avisa sobre RPC `SECURITY DEFINER` executável por
authenticated, como no wrapper legado: é intencional e protegido pelo gate
de operação. Referência do aviso:
https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

Validação: TypeScript/build passaram; consulta sem motivo coincide integralmente
com a legada. Shopee/setembro, motivo avaria: top 25 com 910 ocorrências.
Teste no navegador local: SKU `213988` passa de 394 casos gerais para 201 de
avaria; “Limpar motivo” restaura 394. “Outros” exibe três SKUs. A consulta foi
testada primeiro numa transação revertida, depois aplicada e lida novamente.
Regressão reproduzível: `scripts/returns-reason-filter-validation.sql`.
Essa regressão passou: compatibilidade integral, contagem contra a fonte,
inclusão de SKU fora do top 25 geral e bloqueio de usuário sem operação nos
dois schemas. Os 94 testes de domínio/importação também passaram.

Durante o teste local, o console registrou uma recuperação de hidratação nos
cabeçalhos de tabela enriquecidos pelo `TableColumnHints` global. A navegação
e os filtros foram verificados após a recuperação; o enriquecimento global
não foi alterado nesta entrega.

O frontend foi publicado pela integração GitHub/Vercel a partir do `personal`.
Build de produção concluído e domínio confirmado no deploy acima. A validação
funcional do filtro foi feita localmente com dados reais; o upload foi validado
no parser, sem inserir o lote Donacor em produção.
