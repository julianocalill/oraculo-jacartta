# Análise Comercial

A aba `/analise-comercial`, no setor **Comercial**, mostra produtos mais vendidos
por quantidade e a margem das mesmas vendas em um dia ou intervalo inclusivo.
Padrão: hoje em `America/Sao_Paulo`. Atalhos: Hoje, Ontem, Últimos 7 dias e Este
mês. Datas inválidas, invertidas, futuras ou intervalos acima de 366 dias geram
mensagem explícita; nunca há substituição silenciosa pelo mês atual.

## Contrato dos números

- A data é **emissão da NF válida**, conforme o contrato fiscal do Oráculo.
  Não é data de pedido nem de pagamento. Pedidos ainda não faturados ficam fora.
- A fonte única é o Olist, que fatura os marketplaces; não somar a API Shopee.
  Notas canceladas, entradas, devoluções e vendas sem canal ficam fora.
- `oraculo_fiscal_margin_lines` é o único motor de quantidade, receita rateada,
  custo líquido, impostos, comissão e resultado. Nenhuma regra fiscal foi copiada.
  Preserva os overrides e a expansão de custo de kits do motor canônico.
- O fallback de itens fiscais permanece: unidades podem ser peças de uma NF ou
  kits comerciais de um pedido. Não traduzir SKUs ou tratar todas as unidades
  como peças físicas equivalentes. A tela e os hints explicam a limitação.
- A receita total vem das NFs válidas, inclusive quando não há itens. A diferença
  para a receita no ranking é apresentada como receita sem itens.
- Resultado = receita − custo líquido − ICMS/PIS-COFINS/DIFAL − comissão estimada.
  Não é lucro líquido contábil: não desconta Ads, despesas fixas, frete externo
  ou devoluções posteriores.
- SKU com qualquer linha sem custo ou comissão fica com resultado/margem
  pendentes, mas suas vendas permanecem no ranking.
- Os cards somam resultado somente das linhas completas e dividem pela receita
  dessas mesmas linhas. Nunca dividir lucro parcial por receita total ou tirar
  média simples das margens. Cobertura = receita completa / receita das NFs.
- O filtro de loja afeta todos os números. A busca por nome/SKU afeta apenas o
  ranking, explicitamente indicado na tela. Todos os SKUs retornam, sem top-N
  que pudesse alterar o universo dos cards.

## Dados e atualização

Migration: `20260904143926_commercial_daily_analysis.sql`.

- `oraculo_commercial_daily`: agregado por dia, canal, SKU.
- `oraculo_commercial_coverage`: receita e quantidade de NFs por dia/canal,
  incluindo notas ainda sem itens.
- `oraculo_commercial_days`: controle de processamento, inclusive dias vazios.
- `oraculo_commercial_analysis(start, end, channel)`: RPC `security invoker`,
  retorna JSON agregado para evitar truncamento de 1.000 linhas do PostgREST.
- `oraculo_refresh_commercial(start, end)`: escrita interna, até 31 dias por
  chamada; transação e advisory lock protegem troca do cache. Não roda no render.
- `oraculo_commercial_tick()`: recalcula os últimos 10 dias e até 7 dias de
  histórico, priorizando dias não calculados e depois os mais desatualizados.
- Cron `oraculo-commercial-hourly`, `42 * * * *`, timeout de 5 minutos.
  `/status` acompanha o `refreshed_at` do dia mais recente, alertando quando falta
  o dia corrente ou passou de 2 horas sem atualização.
- A tela mostra dias não calculados, defasagem recente e horário da revisão
  histórica mais antiga. Mudanças de custo são refletidas no próximo lote do
  período; valores históricos não são snapshots contábeis imutáveis.

As três tabelas são de agregados de negócio, sem dados pessoais: RLS ativada,
SELECT para `authenticated`, nenhuma escrita ou refresh concedido a usuários
comuns/anon. A página autoriza `analise-comercial` **antes** de consultar dados.
Administradores já acessam; demais usuários recebem a aba por `/usuarios`.

## Operação e recuperação

Aplicar pelo comando do repositório (não usar `db push`):

```sh
npx supabase db query --linked --file supabase/migrations/20260904143926_commercial_daily_analysis.sql
```

Recalcular um intervalo em lotes de até 31 dias, após verificar que o motor
fiscal e seus vínculos estão atualizados:

```sql
set statement_timeout = '110s';
select public.oraculo_refresh_commercial('2026-09-01', '2026-09-04');
```

A consulta da tela não depende da captura de snapshots mensais. O motor fiscal
continua a depender de `oraculo_fiscal_invoice_order_links`, cuja rotina já é
mantida pelo cron fiscal existente. A fonte fiscal pode receber novos detalhes
entre revisões; a UI declara a hora do cálculo.

Para suspender somente esta rotina: `select cron.unschedule('oraculo-commercial-hourly');`.
A reversão do frontend pode ser feita sem remover tabelas; nenhuma tabela
anterior nem fórmula fiscal foi alterada.
