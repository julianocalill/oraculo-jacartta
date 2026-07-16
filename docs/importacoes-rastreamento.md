# Importações — rastreamento de embarques (aba `/importacoes`)

Porta do MVP local `~/rastreamento-importacoes` para dentro do Oráculo
(2026-07-16). Acompanha os embarques do follow-up de importações (faturas,
itens, BL/contêiner) e mostra a posição AIS dos navios num mapa, sem depender
de nenhuma máquina local.

## O que o usuário vê

- **`/importacoes` (Mapa e embarques)**: cards (navios em rota, faturas,
  itens, próxima chegada), mapa Leaflet dark com um marcador nomeado por
  navio — o hover mostra destino, chegada prevista, faturas e os **itens a
  bordo** (quantidade × descrição) — e tabela ordenável de embarques com a
  linha de origem da planilha.
- **`/importacoes/cadastro`**: server actions para registrar fatura/embarque
  (todos os campos do follow-up Excel), adicionar/remover itens de uma fatura
  e registrar navio (nome oficial + aliases + IMO/MMSI). O MMSI é o que liga
  o navio à posição no mapa; os aliases casam o nome escrito no follow-up
  (ex.: "EVERGREEN - EVER LEADING") com o nome oficial ("EVER LEADING").

## Dados (migrations `20260716180000` e `20260716200000`)

| Tabela | Conteúdo | Escrita |
|---|---|---|
| `importacao_faturas` | fatura/embarque (16 campos do Excel + origem planilha/manual + linhas de origem) | seed + server actions |
| `importacao_itens` | itens por fatura (`source_row` preserva a linha da planilha) | seed + server actions |
| `importacao_navios` | registro nome oficial/aliases/IMO/MMSI | seed + server action |
| `importacao_posicoes` | última posição AIS por MMSI | Edge Function |
| `importacao_ais_sync_runs` | log das execuções do sync AIS (lido pelo `/status`) | Edge Function |

RLS no padrão do projeto: leitura `authenticated`, escrita `service_role`.

## Regras de negócio

- **Linha 419**: da planilha `FOLLOW UP - COMPLETO.xlsx`, só as linhas ≥ 419
  interessam — as anteriores são embarques antigos e não sobem (decisão de
  2026-07-16). O corte é aplicado no seed (`MIN_SHEET_ROW`).
- Depois do seed, **novos dados entram pelo formulário**, não pela planilha.
- Agrupamento por navio: nome manual da fatura → registro (nome ou alias,
  normalizado em uppercase) → MMSI → posição. Navio sem MMSI aparece nas
  faturas mas não no mapa.

## Sync AIS na nuvem (Edge Function `importacoes-ais-sync`)

- Busca `LastKnownPosition` na **VesselAPI** (REST) para cada navio com MMSI
  **citado em alguma fatura** e faz upsert em `importacao_posicoes` somente
  quando a posição recebida é mais recente que a armazenada (idempotente).
- Body `{"all": true}` amplia para todos os navios do registro.
- Agendada por pg_cron: job `oraculo-importacoes-ais-sync`,
  `0 0,6,12,18 * * *` UTC (03/09/15/21h em São Paulo), via
  `private.invoke_oraculo_importacoes_ais_sync` com secrets do Vault
  (`oraculo_project_url`, `oraculo_importacoes_ais_job_secret`).
- Secrets de function: `VESSELAPI_API_KEY` e `IMPORTACOES_AIS_JOB_SECRET`
  (`npx supabase secrets set --project-ref bbtiipnmdxfxnxbemgjr ...`).
- Deploy: `npx supabase functions deploy importacoes-ais-sync
  --project-ref bbtiipnmdxfxnxbemgjr --no-verify-jwt` (auth pelo
  `x-sync-secret`, como as demais functions internas).
- Saúde: linha "Importações (AIS)" em `/status`.

## Seed / re-seed a partir da planilha

Só é necessário se a planilha ganhar linhas novas que precisem entrar em
lote (o caminho normal é o formulário):

```bash
cd ~/rastreamento-importacoes && npm run import:followup -- \
  "/Users/julianocalil/Downloads/FOLLOW UP - COMPLETO.xlsx"
cd ~/oraculo && node scripts/import-rastreamento-followup.js
```

O seed é idempotente (upsert por fatura; itens da planilha são recriados) e
também atualiza registro de navios e posições a partir dos JSONs do MVP.

## Relação com o MVP local

O projeto `~/rastreamento-importacoes` continua existindo como ferramenta de
importação da planilha (parser ExcelJS com células mescladas) e para testes
AISStream/Datalastic, mas **nada em produção depende dele**: posições vêm da
Edge Function, dados novos vêm do formulário.
