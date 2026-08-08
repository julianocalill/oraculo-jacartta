# Relatório periódico de Shopee Ads por IA

## Objetivo

A cada três dias, analisar as campanhas ativas das quatro lojas Shopee e preparar
um resumo executivo mais as campanhas acionáveis para envio no WhatsApp pela
Evolution API.

O fluxo é somente leitura. Ele não pausa, edita, cria ou muda orçamento/lance de
campanha.

## Componentes

- Edge Function `shopee-ads-report-data`: coleta uma loja por invocação e grava
  configurações e 30 dias de desempenho diário.
- Migrations `20260807170000` e `20260807171000`: tabelas, dataset agregado,
  idempotência e RPCs service-role-only usadas pelo n8n.
- Workflow n8n `Oráculo - Relatório IA Shopee Ads 3d`, ID
  `YpzBJxJkHeMLsunB`.
- Modelo configurado: `qwen2.5-coder:7b` via `Ollama Chat Model`, credencial n8n
  `Ollama Local - ia.oliverhome.com.br`.
- Entrega: Evolution API, instância `MKT Espaço`, destino operacional já usado
  pelo alerta antigo.

O alerta antigo `codex - Alerta WhatsApp Saldo Ads Shopee` permanece inativo e
não foi modificado.

## Cadência e janelas

O Schedule Trigger é diário às 08:00 em `America/Sao_Paulo`, mas a tabela
`shopee_ads_report_runs` aplica uma trava persistente por data: um novo envio só
é liberado quando o último período enviado está pelo menos três dias atrás. Isso
evita os intervalos irregulares de um cron `*/3` na virada do mês.

- atual: D-3 a D-1;
- comparação: D-6 a D-4;
- baseline: D-30 a D-1;
- somente dias concluídos.

## Segurança e ownership de token

`shopee-sync` continua sendo o único renovador de token Shopee. A função de Ads
só lê o token e adia a loja quando restam menos de dez minutos. Cada loja assina
com o próprio partner app.

O n8n usa a credencial criptografada `Oráculo Supabase Service Role` para chamar
RPCs do PostgREST. A service role, partner keys e tokens não ficam no JSON do
workflow nem saem da infraestrutura interna para um provedor comercial de IA.
As RPCs verificam `auth.role() = service_role`.

## Métricas

Por loja e campanha:

- gasto, impressões, cliques, CTR e CPC;
- pedidos, GMV, CVR, ROAS e CIR diretos;
- pedidos, GMV, CVR, ROAS e CIR amplos como leitura secundária de halo;
- meta de ROAS e orçamento configurados;
- variação contra os três dias anteriores;
- baseline ponderado de 30 dias.

ROAS direto é a métrica principal. Esta camada não cruza custo, comissão ou
margem; portanto o relatório nunca conclui lucro ou prejuízo.

## Regras acionáveis

Crítica:

- gasto >= R$ 100 sem pedido direto;
- ROAS direto abaixo de 70% da meta, com gasto >= R$ 100;
- gasto sobe >= 30% e ROAS direto cai >= 20%;
- campanha ativa sem impressões após >= 1.000 no período anterior.

Atenção:

- ROAS direto entre 70% e 90% da meta;
- CTR cai >= 25%, com >= 1.000 impressões;
- CPC sobe >= 25%, com >= 30 cliques;
- CVR direto cai >= 25%, com >= 50 cliques.

Oportunidade:

- ROAS direto >= 110% da meta, gasto >= R$ 100 e >= 5 pedidos; ou
- sem meta, ROAS direto >= 125% do ROAS ponderado da loja, com o mesmo volume;
- a oportunidade é descartada se o ROAS caiu mais de 20%.

Ordenação: crítica, atenção, oportunidade e gasto decrescente. Limite de 15 por
loja. Se houver menos, o fluxo não inventa preenchimento.

## Mensagem

O Ollama redige somente o resumo executivo da loja. Nível, diagnóstico e ação
de cada campanha vêm das regras determinísticas e das métricas calculadas. Um
resumo da IA é descartado se contiver números, termos sem evidência ou direção
incompatível com os deltas; nesse caso, o código gera o resumo factual.

1. resumo executivo das quatro lojas, com gasto, ROAS direto, variação e
   contagem por severidade;
2. uma ou mais partes por loja, com nome/ID, gasto, ROAS/meta, leitura e ação;
3. cada parte fica abaixo de 3.400 caracteres e uma campanha nunca é quebrada
   entre partes;
4. rodapé explícito: somente Ads, sem custo/margem, não mede lucro.

Mensagens são idempotentes por `message_key` e persistidas antes da entrega.
Evolution tenta três vezes; o run termina como `sent` ou `partial`.

## Validação de 2026-08-07

| loja | campanhas encontradas | ativas | linhas diárias (30d) |
|---|---:|---:|---:|
| Jacartta | 217 | 48 | 1.440 |
| Espaço De Bicho | 73 | 24 | 720 |
| Donacor | 126 | 58 | 1.740 |
| Oliverhome | 69 | 33 | 990 |

Preview completo: quatro lojas, nove mensagens, maior parte com 3.325
caracteres, zero envios pela Evolution. O fallback determinístico foi exercitado
com sucesso.

## Estado de ativação

O workflow está **inativo** até o preview final. Em 07/08, o nó legado
`lmOllama` devolveu texto vazio ao parser. A integração foi migrada para
`lmChatOllama`. `gemma4:latest` (9,6 GB) e `qwen3.5:latest` (6,6 GB) excederam a
capacidade segura da VPS compartilhada e reiniciaram Ollama/workers; o modelo
estável escolhido foi `qwen2.5-coder:7b` (4,7 GB).

O smoke test do modelo estável passou com JSON estruturado e também com um
payload real de loja. A montagem foi validada com a execução `16358`: nove
mensagens em preview, maior parte com 3.379 caracteres e ações determinísticas
sem recomendações de escala em campanhas críticas. O prompt proíbe causas
externas e a montagem descarta termos não sustentados. Para ativar:

1. executar `Preview manual` e confirmar que as quatro saídas de `Redigir
   análise por loja` contêm `output` em JSON;
2. revisar as partes em `shopee_ads_report_messages`;
3. ativar com:

```bash
cd /Users/julianocalil/espacodebicho-integracoes
npm run n8n:setup-shopee-ads-ai-report -- --activate
```

O script sempre faz backup do workflow antes de atualizar.
