# Status da Giracasa — 10/09/2026

## Carga Olist Giracasa acelerada no Supabase

A carga inicial fechada de 40 dias continua integralmente no Supabase, sem
processo residente na máquina do operador. O período é 30/07/2026–07/09/2026,
dividido em três blocos de até 14 dias e retomado pelos cursores das próprias
Edge Functions.

O primeiro bloco terminou com 9.022 pedidos e 8.224 notas. No segundo bloco,
os 8.295 pedidos também terminaram. Em 10/09, a etapa corrente era a importação
das 7.424 notas desse bloco, sem falhas consecutivas.

A medição em produção mostrou cerca de 38 segundos para buscar e hidratar uma
página de 50 notas. A migration
`20260910120640_accelerate_giracasa_olist_40d_worker.sql` adicionou um job
temporário intercalado com o coordenador original. Cada chamada de notas agora
processa até duas páginas, enquanto pedidos continuam limitados a uma página,
pois uma página hidratada chegou a aproximadamente 125 segundos.

O acelerador usa a mesma trava de linha do coordenador, observa o intervalo
mínimo entre disparos e deixa as mudanças de fase e a contagem de falhas sob
responsabilidade do job principal. Ele também se remove quando o controle sai
de `running`. A primeira chamada reforçada respondeu HTTP 200 e avançou o
cursor de notas de 800 para 1.000, com 1.000 registros gravados e nenhum erro.

## Estado operacional

- `giracasa-olist-initial-backfill-40d` continua como coordenador e máquina de
  estados.
- `giracasa-olist-initial-backfill-accelerator` intercala chamadas temporárias:
  aproximadamente uma página de pedidos a cada quatro minutos ou duas páginas
  de notas a cada dois minutos.
- Os dois jobs e seus cursores vivem no Supabase; fechar o computador não
  interrompe a carga.
- Giracasa permanece `enabled=false` e sem usuários. A aceleração altera apenas
  o backend isolado da carga inicial.
- Uberlândia permanece ativa e não compartilha dados, credenciais ou jobs com
  a Giracasa.

## Próximos gates

1. Acompanhar a conclusão das três faixas de pedidos e notas e da fila final de
   itens comerciais.
2. Conferir totais, cobertura de vínculos NF→pedido e pendências de custo.
3. Cadastrar tarifas próprias de TikTok e Mercado Livre e conectar as contas
   de marketplace.
4. Validar o motor SP contra os casos do Financeiro.
5. Liberar as rotas e um usuário piloto somente depois dessas conferências.

Runbook: `docs/giracasa-onboarding.md`.
Decisão de implantação: `docs/adr/ADR-007-giracasa-progressive-rollout.md`.
