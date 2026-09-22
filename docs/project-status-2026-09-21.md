# Estado do projeto — 21/09/2026

## Separação operacional recuperada

O agendamento de 07:00 criou a lista oficial, mas a publicação bloqueou por 14
pedidos candidatos com `payload.itens = []`. Eram pedidos criados no Olist entre
07 e 13/09, descobertos pelo banco somente em 17–18/09; a sincronização recente
por data de criação não os alcançava. O bloqueio evitou enviar uma lista
incompleta, mas também impediu o avanço do cursor desde 17/09.

Os 14 detalhes foram buscados por ID na Olist e gravados sem alterar
`first_seen_at`. A lista oficial `2026-09-21-0700`
(`8a10833c-8977-4404-af66-487f11c79248`) foi reprocessada: 6.168 pedidos
candidatos, zero sem itens, 42 linhas e 500 caixas. O WhatsApp e o CSV foram
enviados às 08:34 BRT, com `whatsapp_status = sent` confirmado no banco.

## Prevenção de recorrência

- A migration `20260921113500_logistica_picking_missing_order_ids.sql` expõe,
  somente ao `service_role`, os IDs candidatos sem itens na janela exata do
  fechamento.
- `olist-sync-orders` ganhou o modo `hydrate_missing_picking`: consulta esses
  IDs, busca os detalhes por pedido, valida que os itens vieram e reconsulta a
  lacuna. Acima de 100 pedidos, falha de forma explícita em vez de publicar
  dados parciais. A função foi publicada em produção e o teste de janela sem
  lacunas retornou `hydrated = 0, remaining = 0`.
- O workflow n8n `UGLCLNS6oVCK87o3` chama esse modo antes de consolidar listas
  agendadas ou solicitadas no Oráculo. O reenvio explícito de uma lista já
  `ready` agora usa diretamente o documento persistido, sem tentar reservar a
  lista novamente; a condição `whatsapp_status = sent` impede duplicação.
- O script `hydrate-olist-order-details.js` aceita `DETAIL_ORDER_IDS` para
  recuperação pontual, mantendo a data de primeira observação.

O próximo agendamento das 13:30 ainda não havia ocorrido no momento desta
verificação; a cadeia nova foi validada pelo deploy, pelo teste direto da Edge
Function e pelo envio real da lista pronta, mas não por um fechamento futuro
com lacuna nova.

Nenhum commit ou push foi feito nesta sessão.
