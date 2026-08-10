# Importações — rastreamento de embarques (aba `/importacoes`)

Porta do MVP local `~/rastreamento-importacoes` para dentro do Oráculo
(2026-07-16). Acompanha os embarques do follow-up de importações (faturas,
itens, BL/contêiner) e mostra a posição AIS dos navios num mapa, sem depender
de nenhuma máquina local.

## O que o usuário vê

- **`/importacoes` (Mapa e embarques)**: cards (navios em rota, faturas,
  itens, próxima chegada), mapa Leaflet dark com um marcador nomeado por
  navio — o hover abre um popup com destino, chegada prevista, faturas e os
  **itens a bordo** (quantidade × descrição) — e tabela ordenável de embarques
  com a linha de origem da planilha.
  - É **popup, não tooltip**, de propósito: tooltip vive dentro do container
    do mapa (`overflow: hidden`) e era cortado em navio com muitos itens. O
    popup tem `autoPan` (o mapa se desloca para o balão caber inteiro) e
    `maxHeight` com rolagem interna. Ele fica aberto enquanto o mouse estiver
    no marcador ou dentro do balão, para dar conta de rolar a lista.
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

## Entrega do contêiner (migration `20260810140000`)

`port_arrival` é **previsão** digitada no follow-up, não fato — por isso o
status tem três estados em `importacao_faturas.delivery_status`:

| Estado | Significado |
|---|---|
| `auto` (padrão) | Entregue quando a chegada prevista passa |
| `entregue` | Confirmado manualmente, independente da data |
| `em_transito` | Forçado em trânsito (navio atrasou e a data já passou) |

A regra vive na função `importacao_fatura_entregue(status, port_arrival)` e é
exposta pela view `importacao_faturas_status` (coluna `entregue`), consumida
pelo app **e** pela Edge Function — uma regra só, sem cópias divergindo.
Ajuste manual pelo painel "Entrega dos contêineres" em `/importacoes`.

**Por que isso existe**: antes o mapa plotava todo navio com fatura, para
sempre. Um contêiner entregue em 23/07 continuava seguindo o navio, que já
estava em outra viagem do outro lado do mundo — "localização errada" mesmo com
o AIS perfeito. Contêiner entregue sai do mapa e o navio deixa de ser
rastreado.

## Sync AIS na nuvem (Edge Function `importacoes-ais-sync`)

**Provedor: aisstream.io (WebSocket), desde 2026-08-10.** Antes era VesselAPI
por REST; o plano gratuito dela dá 150 chamadas/mês e o sync consumia ~360
(3 navios × 4x/dia), então a cota estourou em 19/07 e as posições ficaram
**congeladas por 22 dias** — o mapa mostrava navio na China com contêiner já
entregue no Brasil. A aisstream é gratuita e sem cota, com a **mesma cobertura
terrestre** da VesselAPI paga (nenhuma das duas cobre alto-mar sem satélite,
que é caro).

- Rastreia só navios com **carga a bordo**: MMSIs vêm das faturas não
  entregues (view `importacao_faturas_status`).
- Modelo de stream, não request/response: a função abre o socket, assina os
  MMSIs (`FiltersShipMMSI`, máx. 50) e **espera o navio transmitir** por uma
  janela (`listenSeconds`, padrão 75s). Encerra assim que todos reportam.
- **Navio sem sinal na janela é normal, não é falha**: AIS terrestre alcança
  ~200 km da costa, então em alto-mar o navio simplesmente não transmite. Esse
  caso vira `positions_skipped` + nota no run, nunca `status = error` — senão
  o `/status` gritaria falso positivo toda vez que a frota cruzasse o oceano.
- **Chave inválida é diagnosticada**: a aisstream não manda mensagem de erro,
  só derruba o socket ~1s depois da subscription. A função mede esse tempo e
  registra "AISSTREAM_API_KEY inválida ou não ativada" em vez de um genérico
  "falha na conexão".
- Body `{"all": true}` amplia para todos os navios do registro;
  `{"listenSeconds": N}` ajusta a janela (15–120s).
- Agendada por pg_cron: job `oraculo-importacoes-ais-sync`,
  `29 0,6,12,18 * * *` UTC, via `private.invoke_oraculo_importacoes_ais_sync`
  com secrets do Vault (`oraculo_project_url`,
  `oraculo_importacoes_ais_job_secret`).
- Secrets de function: `AISSTREAM_API_KEY` e `IMPORTACOES_AIS_JOB_SECRET`.
- Deploy (sem CLI/Docker): `node scripts/deploy-edge-function.js
  importacoes-ais-sync [--secret NOME=valor]` — Management API multipart com
  `User-Agent: curl/8.4.0`, `verify_jwt=false` (auth pelo `x-sync-secret`).
- Saúde: linha "Importações (AIS)" em `/status` **e** aviso na própria
  `/importacoes`, junto da idade de cada posição.

## Idade da posição (o dado velho não se disfarça de novo)

O mapa e a lista mostram há quanto tempo cada posição foi observada. Acima de
`STALE_POSITION_HOURS` (48h) o marcador fica em rose tracejado com a idade no
rótulo, e o popup diz explicitamente que o navio já se moveu. Foi a ausência
disso que deixou uma posição de 29 dias passar por localização atual.

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
