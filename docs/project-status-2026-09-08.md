# Status do projeto — 08/09/2026

## Fluxo operacional de Full/FBS/Onsite implementado

O Oráculo ganhou o módulo `/full`, separado do funil de expedição, para
acompanhar reposições reais do rascunho ao recebimento. A entrega inclui criação
guiada, vínculo explícito entre anúncio e produto Olist, confirmação e expansão
de kits, revisões imutáveis, produção por SKU físico, negociação da coleta,
registro da remessa externa, anexos privados e timeline completa.

Cada troca de responsabilidade gera um marco idempotente na Agenda com prazo de
um dia útil. A ação é concluída no módulo Full; a Agenda não pode simular a
decisão. O planejador semanal legado foi retirado da interface e seu cron é
desativado pela migration. Sugestões ainda pendentes são encerradas como legado,
preservando conteúdo e tabelas de auditoria.
Uma migration complementar mantém a configuração antiga desligada e neutraliza
a fila manual, portanto a versão anterior da Agenda não consegue reativar o
planejador durante a transição de frontend.

A leitura usa RLS por participante ou `full_manager` de Uberlândia. Escritas
continuam no servidor. `oraculo_write_full_revision` grava revisão, itens,
componentes e necessidade consolidada na mesma transação. Documentos usam o
bucket privado `full-documents` e URL assinada de 60 segundos após autorização.

O contrato `full-inbound-sync` foi criado sem adapter ativo nem cron. Mercado
Livre, Shopee e Amazon aceitam consulta de catálogo e criação de rascunho, mas o
envio à logística fica bloqueado até coleta e recebimento serem comprovados em
uma remessa real, na ordem ML → Shopee → Amazon. A saúde e a fila aparecem em
`/status`.

Arquitetura e operação: [full-workflow.md](full-workflow.md) e
[ADR-007](adr/ADR-007-full-inbound-workflow.md).

### Validação local desta entrega

- 70 testes do domínio aprovados;
- TypeScript aprovado;
- build de produção do Next.js aprovado;
- teste SQL descartável de RLS, revisão congelada, expansão e escrita bloqueada
  adicionado em `supabase/tests/full-workflow.sql`;
- migration aplicada no projeto vinculado; teste SQL transacional aprovado;
- interface ainda precisa do push/deploy Vercel; a Edge Function permanece
  propositalmente não publicada e sem cron até a remessa piloto do primeiro canal.

## Posição vendável da Shopee ficou completa e sem ambiguidade

A aba `/shopee/estoque` agora abre a posição completa de todos os SKUs ×
armazém recebidos pelo SBS, com vendável FBS, reservado, não vendável,
trânsito e vendável total do anúncio. A exportação ganhou a mesma posição em
uma aba própria, e a tabela de ruptura passou a mostrar explicitamente o saldo
vendável mesmo quando ele é zero.

A conferência do payload de produção corrigiu uma nomenclatura importante:
`shopee_products.model_stock` vem de
`stock_info_v2.summary_info.total_available_stock`. Esse número já reúne todas
as localizações do anúncio e desconta as reservas; não é exclusivamente
"estoque local". O saldo FBS confiável continua sendo `sellable_qty`, separado
por armazém na API SBS.

## Status das integrações agora representa execução real

A tela `/status` deixou de interpretar como atividade saudável linhas antigas
que permaneceram com `status = running`. A coluna final passou de **Erro** para
**Detalhe**, porque também comunica progresso, fila restante e pausas retomáveis.
Falhas de consulta ao próprio monitoramento agora aparecem como falha, em vez de
degradarem silenciosamente para “Sem execução”.

### Pedidos Olist

O cron operacional relê, a cada 15 minutos, os 500 pedidos mais recentes da
janela móvel de três dias (`resume=false`, `orderBy=desc`). Esse lote é o objetivo
inteiro da chamada; não é uma varredura que deva permanecer aberta até alcançar
todos os pedidos da janela. A Edge Function agora encerra cada lote como
`success`, registra `cycle_completed=true` e usa
`stop_reason=bounded_top_scan`.

O histórico incorreto foi saneado pela migration
`20260908120216_fix_sync_run_statuses.sql`. Após a publicação, o ciclo das 09:20
BRT concluiu 500/500 pedidos em cerca de 20 segundos e ficou corretamente como
`success`.

### Backfill de itens

O backfill de 20/07–02/08 estava parado no primeiro pedido e criava uma nova
linha `running` a cada dois minutos. A causa exata era o uso de `.catch()` num
builder do Supabase, que não é uma Promise: ao receber um 404 da Olist, o próprio
tratador de erro lançava outra exceção e a execução morria sem fechamento.

A rotina agora:

- impede duas execuções frescas da mesma janela;
- fecha automaticamente runs interrompidos;
- grava heartbeat e fase (`run_created`, `candidates_loaded`, `token_ready`,
  `finished`);
- reaproveita o access token ainda válido e limita refresh HTTP a 15 segundos;
- aplica timeout garantido às consultas de detalhe da Olist;
- registra o pedido com erro e continua o restante do lote.

Validação em produção: primeiro lote corrigido processou 100 pedidos em 61 s,
com 99 concluídos, 106 itens gravados e 1 pedido corretamente isolado como erro
404 (“Pedido não encontrado”). A fila da janela caiu de 41.724 para 41.624.

## Estado anterior preservado

O Oráculo restaurado e a Giracasa preservada, mas pausada na interface,
continuam descritos em
[project-status-2026-09-07.md](project-status-2026-09-07.md). Esta correção não
altera regras fiscais, dados de negócio nem permissões.

## Validação executada

- 64 testes do domínio: todos aprovados;
- TypeScript da aplicação web: aprovado;
- duas Edge Functions publicadas e compiladas pelo bundler do Supabase;
- migration aplicada diretamente ao projeto vinculado;
- ciclo real de pedidos confirmado como `success`;
- ciclo real de backfill confirmado com avanço de fila e erro isolado.
