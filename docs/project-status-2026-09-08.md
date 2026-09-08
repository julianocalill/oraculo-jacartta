# Status do projeto — 08/09/2026

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
