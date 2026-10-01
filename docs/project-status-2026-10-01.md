# Estado do projeto — 01/10/2026

## Upload de devoluções TikTok: correção validada localmente

A interface de produção permanece no último deploy verificado em
`docs/project-status-2026-09-30.md`. A correção de upload ainda não foi publicada.
Não houve gravação de devoluções no banco durante o diagnóstico.

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

### Recuperação na versão atualmente publicada

Abrir a exportação no Excel, renomear a aba `0` para `Donacor` e salvar como
um novo `.xlsx` faz o editor reescrever a estrutura de linhas. Reenviar pela
aba Devoluções. Depois da publicação da correção, o arquivo original poderá
ser enviado diretamente, escolhendo Donacor no formulário.

Antes de publicar, ajustar `publishedAt` da novidade correspondente ao horário
real de publicação e seguir os dois remotes documentados no deployment map.

## Filtro de SKUs pelo motivo da devolução

Solicitação: clicar em “Avaria no transporte” na seção Motivos deve filtrar
“Onde a devolução se concentra”; sem motivo escolhido, a lista continua geral.

Implementado localmente em `/devolucoes`:

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

O frontend continua sem deploy. Publicar após aplicar a migration já presente
e ajustar o horário previsto do manifesto de novidades.
