# Estado do projeto — 2026-08-07

Supersede `docs/project-status-2026-08-04.md`. Todo o estado descrito naquele
documento continua válido; esta atualização acrescenta a automação de Shopee Ads
e a rodada de performance já registrada no changelog de 07/08.

## Shopee Ads — relatório IA a cada três dias

A camada foi implementada e validada em preview para as quatro lojas. A Edge
Function `shopee-ads-report-data` coleta configurações e desempenho diário sem
renovar tokens; o n8n classifica campanhas por regras fixas, pede somente a
redação ao Ollama interno e prepara a entrega pela Evolution API.

- dados: `shopee_ads_campaigns`, `shopee_ads_daily` e
  `shopee_ads_collection_runs`;
- controle: `shopee_ads_report_runs` e `shopee_ads_report_messages`;
- migrations: `20260807170000` e `20260807171000`;
- n8n: `Oráculo - Relatório IA Shopee Ads 3d` (`YpzBJxJkHeMLsunB`);
- prompt: `docs/prompts/shopee-ads-analysis-agent.md`;
- runbook/contrato: `docs/shopee-ads-ai-report.md`.

Preview de 07/08: 163 campanhas ativas no total, 4.890 linhas diárias, quatro
lojas processadas, nove mensagens, zero envios.

### Bloqueio de ativação

O workflow permanece inativo até um preview completo confirmar as quatro lojas
com `qwen2.5-coder:7b` via `Ollama Chat Model`. O JSON estruturado já passou em
smoke test mínimo e com payload real. Gemma4 e qwen3.5 não cabem com segurança
na VPS compartilhada sem swap e reiniciaram Ollama/workers durante os testes.

## Performance e demais áreas

A rodada de performance de 07/08 (região Vercel `gru1`, índice fiscal, sessão
deduplicada, paralelização e caches) está detalhada no primeiro item de
`CHANGELOG.md`. Devoluções, margem fiscal, canais, cron jobs e limitações de
dados permanecem conforme `docs/project-status-2026-08-04.md`.
