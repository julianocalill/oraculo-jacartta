# Estado do projeto — 28/09/2026

## Giracasa/SP: navegação e Análise Comercial

A Giracasa foi ativada em 22/09/2026, depois do retrato de 05/09 que ainda a
descrevia como desativada. Em 28/09 havia 44.814 pedidos e 41.745 NFs no schema
`giracasa`. A URL `/o/giracasa/*` usa esse schema; Uberlândia usa `public`.

Foi corrigido um defeito de navegação cliente: `OperationProvider` recebia a
operação no layout raiz, que o Next.js preserva ao navegar. Ao entrar em SP a
partir de MG, o rótulo da página passava a ser SP, mas os links do menu podiam
continuar recebendo o prefixo `/o/uberlandia`. O provider agora acompanha o
`pathname` visível; a autorização e a escolha do schema continuam no servidor.

A Análise Comercial da Giracasa estava vazia porque suas três tabelas de cache
tinham zero linhas e nenhum job chamava `giracasa.oraculo_commercial_tick()`.
A migration `20260928131145_giracasa_commercial_hourly.sql` agenda o job
`giracasa-commercial-hourly` em `:11`, com limite de cinco minutos e o mesmo
motor já clonado para SP. Foi aplicada em produção e o histórico foi preenchido
em lotes desde 30/07 até 28/09: 61 dias processados, 5.525 linhas de
dia/canal/SKU, 39.518 NFs com canal e R$ 2.480.437,00 de receita no agregado.
Para 27/09, a cobertura tem 1.418 NFs e R$ 86.365,27, iguais à fonte fiscal
Giracasa; 65 linhas de dia/canal/SKU e 31 SKUs consolidados na RPC. O dia tinha
223 linhas em `public`, confirmando que as operações não foram misturadas.

## Outras telas sem fonte em SP

Uma tela vazia nem sempre é falha de cálculo. Nesta data, `giracasa` tinha
`mercadolivre_accounts=0`, `mercadolivre_items=0`, `shopee_sales_daily=0`,
`shopee_order_escrow=0` e `shopee_ads_daily=0`. Havia 87 pedidos Shopee, mas a
série analítica e o escrow ainda não estavam carregados. Devoluções canônicas
também estavam em zero. As telas dependentes dessas fontes não devem mostrar
números de Uberlândia nem ser preenchidas com valores fictícios: conectar e
validar cada fonte própria de SP pelo runbook `docs/giracasa-onboarding.md`.

## Validação

- `node --test packages/domain/*.test.js`: 85 testes aprovados.
- `apps/web/node_modules/.bin/tsc --noEmit`: aprovado.
- RPC Giracasa para 27/09: `processed_days=1`, 31 produtos consolidados.
- Job `giracasa-commercial-hourly`: ativo no `pg_cron`.

## Publicação

Commit `561ac0f` enviado a `origin/main` e `personal/main`. Deploy Vercel
`dpl_7Db5xgcCceVUJk5qWU6t3YuVFLTc` confirmado como `Ready` e associado ao
alias `https://oraculo.oliverhome.com.br`. O build Next.js de produção concluiu
sem erro. O job e o backfill foram verificados no banco de produção; a execução
manual de `giracasa.oraculo_commercial_tick()` terminou em 6,5 s.
