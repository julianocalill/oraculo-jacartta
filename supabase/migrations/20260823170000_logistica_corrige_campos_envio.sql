-- Logística — remove olist_orders.transportador_nome e documenta a cobertura
-- real dos demais campos de envio.
--
-- MEDIÇÃO (2026-08-23, últimos 30 dias, 138.873 pedidos):
--
--   transportador_nome    0 preenchidos  (0,0%)   ← nasceu morta
--   forma_envio           138.851        (99,9%)
--   frete_por_conta       138.851        (99,9%)
--   codigo_rastreamento   1.436          (1,0%)   ← só Mercado Envios
--   valor_frete           ~2%                     ← só pedidos hidratados
--
-- `transportador.nome` vem SEMPRE vazio da Olist: quem despacha é o
-- marketplace, não uma transportadora contratada por nós, então o ERP não tem
-- o que gravar ali. A informação útil está em `transportador.formaEnvio.nome`
-- ("Shopee Envios", "TikTok Shipping", "Mercado Envios", "Kwai Envios",
-- "Amazon DBA", "Shein Envios") — que na prática identifica o MODAL do canal,
-- não a transportadora.
--
-- A coluna foi criada na migration 20260821190000 a partir do shape do jsonb,
-- sem medir taxa de preenchimento. A lição vale para a próxima: um campo que
-- existe no payload não é um campo que vem preenchido — meça antes de
-- materializar.
--
-- Consequência de projeto: o Olist NÃO serve como fonte de expedição
-- multicanal (sem transportadora e praticamente sem rastreio). Os dados de
-- envio precisam vir das APIs de cada canal, como já acontece com a Shopee em
-- shopee_fulfillment_packages. Ver docs/plano-logistica-deposito.md, Fase 4.

alter table public.olist_orders drop column if exists transportador_nome;

-- Mesma função da 20260821190000 sem a linha do transportador_nome.
create or replace function public.oraculo_olist_order_logistics_fields()
returns trigger
language plpgsql
as $$
begin
  new.forma_envio := nullif(btrim(coalesce(new.transportador->'formaEnvio'->>'nome', '')), '');
  new.frete_por_conta := nullif(btrim(coalesce(new.transportador->>'fretePorConta', '')), '');
  new.codigo_rastreamento := nullif(btrim(coalesce(new.transportador->>'codigoRastreamento', '')), '');
  -- valorFrete só existe no payload de detalhe (pedidos hidratados). Quando o
  -- payload volta ao shape de listagem num upsert, preserva o último valor
  -- conhecido. Guarda de regex porque um cast inválido derrubaria o sync.
  if new.payload ? 'valorFrete'
     and new.payload->>'valorFrete' ~ '^-?[0-9]+([.,][0-9]+)?$' then
    new.valor_frete := replace(new.payload->>'valorFrete', ',', '.')::numeric;
  end if;
  return new;
end;
$$;

comment on function public.oraculo_olist_order_logistics_fields() is
  'Trigger de olist_orders: materializa forma_envio, frete_por_conta e codigo_rastreamento a partir do jsonb transportador, e valor_frete de payload.valorFrete. NÃO materializa transportador.nome — o campo vem sempre vazio da Olist (removido em 20260823170000). Existe porque generated column em olist_orders exigiria rewrite de ~1 GB sob ACCESS EXCLUSIVE.';

comment on column public.olist_orders.forma_envio is
  'Modal de envio do canal (transportador.formaEnvio.nome): "Shopee Envios", "TikTok Shipping", "Mercado Envios", "Kwai Envios", "Amazon DBA", "Shein Envios". Preenchido em 99,9% dos pedidos — é o campo confiável para separar expedição por canal. NÃO é o nome da transportadora física: essa informação não existe no ERP.';

comment on column public.olist_orders.codigo_rastreamento is
  'Código de rastreio informado no ERP. ARMADILHA: preenchido em ~1% dos pedidos — só o Mercado Envios devolve o código ao ERP (e em ~40% dos casos dele). Shopee, TikTok, Kwai e Amazon gerenciam o envio por fora e nunca preenchem. Para rastreio de Shopee use shopee_fulfillment_packages.tracking_number.';

comment on column public.olist_orders.valor_frete is
  'Valor do frete do pedido (payload.valorFrete). ARMADILHA: preenchido em ~2% dos pedidos — o campo só existe no payload de detalhe, e a maioria dos pedidos é gravada com o shape de listagem. Não serve para custo de frete por canal sem hidratar a base antes.';

comment on column public.olist_orders.frete_por_conta is
  'Responsável pelo frete no ERP: R = remetente (CIF), D = destinatário (FOB). Preenchido em 99,9% dos pedidos.';
