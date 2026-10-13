# Ativação da Giracasa no Oráculo

Giracasa/SP existe como operação isolada e começa com `enabled=false`. A tela informa “em preparação” enquanto faltarem credenciais ou validação. Nunca ative para substituir ausência de fonte por zeros.

## Credenciais

Configure secrets próprios com prefixo `GIRACASA_`. São obrigatórios ao menos os equivalentes atuais de Olist/Tiny, Shopee, Mercado Livre e demais fontes usadas. Mesmo que endpoint ou segredo tenham o mesmo valor, cadastre-o com o prefixo; o builder não possui fallback para o nome de Uberlândia.

Gere as funções em diretório temporário:

```bash
node scripts/build-operation-functions.mjs --operation=giracasa --out=/tmp/giracasa-functions
```

Revise `MANIFEST.json`, faça o deploy de cada pasta com seu nome `giracasa-*` e cadastre os callbacks OAuth com esses nomes. Cada cliente escreve no schema `giracasa`. Tokens, lojas, cursores e runs começam vazios.

## Carga de 90 dias

Primeiro conecte Olist/Tiny e faça um teste de uma janela fechada de um dia. Depois execute:

```bash
SUPABASE_URL=... GIRACASA_OLIST_SYNC_JOB_SECRET=... node scripts/giracasa-backfill-90d.mjs
```

O script trabalha em blocos de 14 dias, sequencialmente, e para no primeiro erro. Retome o bloco informado depois de corrigir a causa. Importe outras fontes também em janelas limitadas pelos respectivos contratos; Shopee continua sendo executada por loja.

## Validação e ativação

1. Execute `supabase/tests/operation-isolation.sql` num banco descartável.
2. Compare uma janela fechada com Olist/Tiny: NFs válidas, receita, pedidos, itens e estoque.
3. Compare exemplos do Financeiro: nacional/importado, SP interno, venda interestadual, crédito explícito e transferência importada. Lucro deve ficar pendente sem custo, tarifa, UF ou regra necessária.
4. Valide Agenda, RPA, etiquetas, importações, devoluções, reconciliação, exports, status e usuários autorizados.
5. Cadastre crons com nomes `giracasa-*`, mesmos limites da fonte e horários defasados dos jobs de Uberlândia. Não programe um cache sem expor seu `refreshed_at` no status.
6. Somente então marque `public.oraculo_operations.enabled=true` e registre `activated_at=now()` em nova migration. A migration de ativação também deve criar os jobs.

Para rollback operacional, desative a linha e remova/pausa os jobs `giracasa-*`. Preserve o schema para diagnóstico; não apague nem copie dados para `public`.

## Motor financeiro

Versão inicial `gira-casa-v1`: origem SP; ICMS nacional de 18% para SP, 12% para MG/PR/RJ/RS/SC e 7% para as demais UFs; importado de 18% para SP e 4% fora; PIS/COFINS de 9,25% com crédito quando aplicável; DIFAL somente interestadual; receita pela NF válida.

Custos seguem o Financeiro: líquido explícito, créditos recuperáveis explícitos, transferência comprovada de importado (4% + 11,75%) e custo bruto. Sem comprovação, Giracasa conserva o custo bruto. Exceções ficam em `giracasa.oraculo_financial_product_rules` por SKU e vigência.

## Estado em 13/10/2026

Correção após a auditoria, autorizada pelo usuário: as migrations e os
produtores SP foram aplicados, com recuperação automática de itens Olist e
histórico Shopee; Ads ganhou RPC isolada. As telas informam cobertura e não
confirmam indicadores sem fonte. Histórico ainda em processamento; ML/SP
continua dependendo de conta. Estado final e validação:
[status de 13/10](project-status-2026-10-13.md). O retrato da auditoria abaixo
explica as falhas corrigidas.

A operação está ativa, mas a ativação não concluiu todos os produtores.
A [auditoria de 13/10](project-status-2026-10-13.md) confirmou que os pedidos
Olist seguem chegando, enquanto os itens comerciais pararam em 07/09.
O cron de pedidos omite `hydrateDetails=true`; o backfill manda `maxOrders`
e usa os defaults de junho por não receber `startDate`/`endDate`. Preparar
primeiro a fila da janela própria, depois consumi-la com datas iguais e
`limit`; corrigir a coleta corrente e recalcular caches só após hidratar.

Shopee tem uma conta cadastrada e token atualizado, mas só 87 pedidos do
teste de 11/09. Falta agendar e validar importação de pedidos, produtos/FBS,
escrow, reconciliação, devoluções e Ads. A RPC `giracasa.oraculo_ads_dashboard`
também falta e a página bloqueia SP no código. Confirmar a identidade do
canal Olist “Shopee Vari Útil” em relação à conta cadastrada antes de ampliar
o escopo. ML/SP segue sem conta; Full/SP não tem suas tabelas de workflow.

Cobertura de itens fiscais não comprova cobertura de itens comerciais.
Ausência de fonte não pode virar previsão zero, taxa zero ou afirmação de
repasse conferido. Critérios de aceite e SQL de leitura estão na auditoria.
A auditoria não aplicou correções nem alterou agendamentos.

## Estado em 28/09/2026

A operação foi ativada em 22/09/2026. A carga Olist/Tiny já tem pedidos,
notas, itens e produtos; a Análise Comercial foi recuperada em 28/09, com
histórico desde 30/07 e cron horário `giracasa-commercial-hourly`. Mercado
Livre/SP ainda não tem conta cadastrada. Shopee/SP tem pedidos parciais, mas
não tem séries analíticas, escrow nem Ads. Validar cada integração própria
antes de considerar suas telas completas. Ver `docs/project-status-2026-09-28.md`.

## Registro inicial da implantação

Em 05/09/2026 as migrations de cadastro, isolamento, motor financeiro e exposição controlada do schema foram executadas em produção. Naquele dia o pós-check apontou 101 tabelas, 94 funções e 34 views no schema Giracasa; zero pedidos, zero notas, zero concessões e `enabled=false`. As 26 Edge Functions `giracasa-*` foram publicadas. Naquele momento ainda não existiam secrets `GIRACASA_*`, carga ou crons.
