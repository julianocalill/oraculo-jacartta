# Shopee Ads — dashboard Comercial

Implementado em 11/09/2026 em `/ads` (URL com operação: `/o/uberlandia/ads`).
Permissão própria `ads`, liberada por administrador em Usuários. O acesso de
Giracasa exibe integração ainda não configurada e nunca consulta dados MG.

## Leitura

- Padrão: últimos 30 dias encerrados em America/Sao_Paulo; presets ontem, 7 e
  30 dias, intervalo personalizado até 90 dias e filtro por loja.
- Gasto, GMV direto, pedidos e ROAS direto. ROAS = soma GMV direto / soma gasto;
  nunca média dos ROAS individuais. Gasto zero deixa ROAS indefinido.
- Gráfico SVG: barras em R$ no eixo esquerdo, ROAS em vezes no direito. Lacunas
  sem coleta não são zeros. Histórico parcial é pontilhado e sinalizado.
- Análise diária do último dia selecionado, comparado com o anterior. Critérios
  em `packages/domain/ads-analysis.js`, com testes de limites e cobertura.
  Classificação determinística independente do Ollama; não modifica campanhas.
- Os limiares de gasto, ROAS, CTR, CPC e CVR seguem o contrato do n8n, agora
  aplicados a um dia. Oportunidade exige meta atual, dia anterior completo e
  ROAS anterior calculável. Sem meta não sugere escala. Campanhas pausadas
  entram em gasto e diagnóstico, mas não recebem sugestão de escala.
- Ranking completo de campanhas com movimento no período, ordenável, com
  busca por nome/ID que não muda os totais dos cards. Tabela por loja e tabela
  diária complementam o gráfico. Metas e status são atuais, não históricos.
- Não mede lucro/margem: não cruza custos ou impostos, nem soma GMV amplo.
  Atribuições da Shopee podem revisar dias anteriores.

## Coleta e cobertura

`shopee-ads-report-data` aceita `scope=all`. O comportamento padrão usado pelo
n8n continua sendo campanhas ativas, com relatório WhatsApp a cada três dias.
A aba não depende da redação ou entrega do relatório e não envia mensagens.

Os quatro crons `oraculo-ads-daily-<shop_id>` rodam em 07:15, 07:20, 07:25 e
07:30 BRT e repetem em 10:15–10:30. Cada job chama uma loja separadamente e
revisa os últimos 30 dias, incluindo campanhas pausadas/encerradas. Tokens
continuam sendo renovados exclusivamente pelo n8n.

Uma coleta `scope=all` só termina em sucesso após conferir a presença de cada
campanha e cada dia na resposta. Métricas zero são explícitas. Datas/campanhas
omitidas pela API falham a coleta, sem fabricar cobertura. A tabela
`shopee_ads_collection_runs.meta.scope` diferencia os dois fluxos.

O histórico antes da primeira janela completa permanece parcial: o coletor
antigo só revisava campanhas ativas no momento da execução. A interface não
mostra deltas nem análises diárias para bases incompletas; comparações do
período exigem ambas as janelas completas. A comparação diária exige somente
os dois dias envolvidos.

## Banco e acesso

Migration `20260911194344_shopee_ads_dashboard.sql`, aplicada via `db query
--linked --file`, cria RPC agregada `oraculo_ads_dashboard(date,date,bigint)`
SECURITY INVOKER, com timeout de 8 s. Retorno JSON único evita o limite de
1.000 linhas do PostgREST; não traz payload bruto. Consulta as séries indexadas
já persistidas, sem nova tabela de cache.

Métricas têm SELECT para authenticated com RLS de operação. Para campanhas e
runs, o grant é por coluna: `raw_settings`, erros internos, tokens e mensagens
não são expostos. Policies restritivas de operação existentes são preservadas.
`/status` acompanha o último run completo de **cada loja**; falhas e atraso de
mais de 30 h são detectados sem confundir com as execuções do n8n.

## Recuperação

1. Conferir `/status` e `shopee_ads_collection_runs` com `meta->>'scope'='all'`.
2. Se token perto de expirar, verificar o renovador primário no n8n. Não
   renovar manualmente por outro caminho.
3. Reenfileirar a loja via SQL administrativo:
   `select private.invoke_shopee_ads_dashboard(<shop_id>);`.
4. Conferir sucesso, 30 datas por campanha e cobertura da RPC antes de afirmar
   que os dados estão completos. Runs interrompidos ficam visíveis como falha
   ou pendência; não são interpretados como sucesso.

## Validação inicial

- 509 campanhas em quatro lojas; 15.270 linhas de campanha/dia em 30 dias.
- Janela 12/08–10/09: gasto R$ 376.249,71; GMV direto R$ 4.078.297,80.
- Soma do dashboard exatamente igual à série de origem; 120 combinações de
  loja/dia com cobertura completa. Período anterior permanece parcial.
- Consulta sob authenticated autorizada; identidade sem acesso retorna zero
  campanhas. Anon sem leitura, authenticated sem escrita e sem raw_settings.
- Testes do domínio: 82 aprovados incluindo seis testes específicos de Ads.
