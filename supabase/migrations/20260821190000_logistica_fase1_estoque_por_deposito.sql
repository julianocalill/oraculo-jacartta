-- Logística Fase 1 — estoque por depósito, dimensões físicas e dados de envio.
--
-- CONTEXTO (2026-08-21): o Oráculo nasceu comercial/fiscal e está ganhando uma
-- visão logística/depósito. Esta migration cria a fundação de dados:
--
-- 1. `olist_stock_deposits` — saldo por depósito do Olist/Tiny. A coluna
--    `olist_stock_items.depositos` (jsonb) SEMPRE esteve vazia: o payload de
--    `GET produtos/{id}` não traz depósitos; eles vêm de `GET /estoque/{id}`
--    (confirmado em produção em 21/08 — a conta tem 8 depósitos: Geral,
--    FULL ML, Full Shopee Oliver, Amazon Onsite, Avarias, Devolução,
--    Importação e Transferência). A tabela é alimentada pela edge function
--    `olist-sync-stock` (chamada extra por produto com movimento) e semeada
--    por `scripts/backfill-olist-stock-deposits.js`. Staleness acompanha o
--    sync de estoque (visível em /status via olist_stock_sync_runs).
--
-- 2. `logistica_depositos` — dimensão curada dos depósitos (tipo, apelido,
--    se é endereço físico). Une a taxonomia própria com FBS/Full no futuro.
--
-- 3. Dimensões físicas em `olist_products` — generated columns a partir de
--    `payload->'dimensoes'` (a tabela tem ~3k linhas; o rewrite é barato).
--    Em `olist_orders` generated column é PROIBIDO (AGENTS.md: rewrite de
--    ~1 GB sob ACCESS EXCLUSIVE) — lá o caminho é trigger.
--
-- 4. Colunas de envio em `olist_orders` materializadas por TRIGGER a partir
--    de `transportador` (preenchido desde sempre e nunca lido) e de
--    `payload->>'valorFrete'` (só existe em pedidos hidratados). Backfill em
--    lotes via `scripts/backfill-olist-orders-transportador.js`.
--
-- 5. View `oraculo_estoque_por_deposito` — leitura da tela /logistica/estoque.

-- ---------------------------------------------------------------------------
-- 1. Saldo por depósito
-- ---------------------------------------------------------------------------

create table if not exists public.olist_stock_deposits (
  produto_id text not null,
  deposito_id text not null,
  sku text,
  deposito_nome text,
  desconsiderar boolean not null default false,
  saldo numeric,
  reservado numeric,
  disponivel numeric,
  empresa_cnpj text,
  synced_at timestamptz not null default now(),
  primary key (produto_id, deposito_id)
);

create index if not exists olist_stock_deposits_deposito_idx
  on public.olist_stock_deposits (deposito_id);
create index if not exists olist_stock_deposits_sku_idx
  on public.olist_stock_deposits (sku);

alter table public.olist_stock_deposits enable row level security;

revoke all on public.olist_stock_deposits from public, anon, authenticated;
grant all on public.olist_stock_deposits to service_role;
grant select on public.olist_stock_deposits to authenticated;

drop policy if exists olist_stock_deposits_select on public.olist_stock_deposits;
create policy olist_stock_deposits_select
  on public.olist_stock_deposits for select to authenticated using (true);

comment on table public.olist_stock_deposits is
  'Saldo de estoque por depósito do Olist/Tiny (GET /estoque/{idProduto}), uma linha por produto × depósito, incluindo zeros para os produtos já varridos. Alimentada pela edge function olist-sync-stock (produtos com saldo/reserva ou que já tinham linha com movimento) e semeada por scripts/backfill-olist-stock-deposits.js. O saldo oficial continua sendo o consolidado em olist_stock_items; esta tabela responde ONDE o estoque está.';
comment on column public.olist_stock_deposits.produto_id is 'ID do produto no Olist (mesma chave de olist_stock_items.produto_id).';
comment on column public.olist_stock_deposits.deposito_id is 'ID do depósito no Olist (chave de logistica_depositos).';
comment on column public.olist_stock_deposits.deposito_nome is 'Nome do depósito como veio da API (ex.: "Geral", "FULL ML "). Para exibição prefira o apelido em logistica_depositos.';
comment on column public.olist_stock_deposits.desconsiderar is 'Flag do ERP: depósitos com true (Avarias, Devolução, Full Shopee...) ficam FORA do saldo consolidado de olist_stock_items.';
comment on column public.olist_stock_deposits.empresa_cnpj is 'CNPJ da empresa dona do depósito no ERP (campo "empresa" da API).';

-- ---------------------------------------------------------------------------
-- 2. Dimensão curada de depósitos
-- ---------------------------------------------------------------------------

create table if not exists public.logistica_depositos (
  deposito_id text primary key,
  nome text not null,
  apelido text,
  tipo text check (tipo in ('proprio', 'full_ml', 'full_shopee', 'terceiro')),
  endereco_fisico boolean not null default false,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.logistica_depositos enable row level security;

revoke all on public.logistica_depositos from public, anon, authenticated;
grant all on public.logistica_depositos to service_role;
grant select on public.logistica_depositos to authenticated;

drop policy if exists logistica_depositos_select on public.logistica_depositos;
create policy logistica_depositos_select
  on public.logistica_depositos for select to authenticated using (true);

comment on table public.logistica_depositos is
  'Dimensão curada dos depósitos de estoque (ids do Olist/Tiny; aceita linhas sintéticas para locais fora do ERP). Classifica cada depósito (próprio, Full ML, Full Shopee, terceiro) e marca qual participa de endereçamento físico. Depósitos novos descobertos pelo sync entram com tipo nulo para curadoria manual.';
comment on column public.logistica_depositos.apelido is 'Nome de exibição nas telas (o nome do ERP pode vir com espaços/grafia crua).';
comment on column public.logistica_depositos.tipo is 'proprio | full_ml | full_shopee | terceiro. Nulo = ainda não classificado.';
comment on column public.logistica_depositos.endereco_fisico is 'true quando o depósito é o galpão próprio e participa de endereçamento por posição (Fase 3 da visão logística).';

insert into public.logistica_depositos (deposito_id, nome, apelido, tipo, endereco_fisico) values
  ('350766848', 'Geral', 'Geral', 'proprio', true),
  ('339906257', 'FULL ML ', 'Full ML', 'full_ml', false),
  ('365912180', 'Full Shopee Oliver', 'Full Shopee', 'full_shopee', false),
  ('341912289', 'Amazon Onsite', 'Amazon Onsite', 'terceiro', false),
  ('345933009', 'Avarias', 'Avarias', 'proprio', false),
  ('345932947', 'Devolução', 'Devolução', 'proprio', false),
  ('352415228', 'Importação', 'Importação', 'proprio', false),
  ('371221054', 'Transferência', 'Transferência', 'proprio', false)
on conflict (deposito_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Dimensões físicas do produto (generated columns; tabela pequena)
-- ---------------------------------------------------------------------------

alter table public.olist_products
  add column if not exists peso_liquido_kg numeric generated always as
    (nullif((payload->'dimensoes'->>'pesoLiquido')::numeric, 0)) stored,
  add column if not exists peso_bruto_kg numeric generated always as
    (nullif((payload->'dimensoes'->>'pesoBruto')::numeric, 0)) stored,
  add column if not exists altura_cm numeric generated always as
    (nullif((payload->'dimensoes'->>'altura')::numeric, 0)) stored,
  add column if not exists largura_cm numeric generated always as
    (nullif((payload->'dimensoes'->>'largura')::numeric, 0)) stored,
  add column if not exists comprimento_cm numeric generated always as
    (nullif((payload->'dimensoes'->>'comprimento')::numeric, 0)) stored,
  add column if not exists volume_m3 numeric generated always as
    (nullif(
      (payload->'dimensoes'->>'altura')::numeric
      * (payload->'dimensoes'->>'largura')::numeric
      * (payload->'dimensoes'->>'comprimento')::numeric,
      0) / 1000000.0) stored;

comment on column public.olist_products.peso_liquido_kg is 'Peso líquido em kg, extraído de payload.dimensoes.pesoLiquido (0 do ERP vira NULL — mesmo trap do preco_custo).';
comment on column public.olist_products.peso_bruto_kg is 'Peso bruto em kg, extraído de payload.dimensoes.pesoBruto (0 vira NULL).';
comment on column public.olist_products.altura_cm is 'Altura em cm, de payload.dimensoes.altura (0 vira NULL).';
comment on column public.olist_products.largura_cm is 'Largura em cm, de payload.dimensoes.largura (0 vira NULL).';
comment on column public.olist_products.comprimento_cm is 'Comprimento em cm, de payload.dimensoes.comprimento (0 vira NULL).';
comment on column public.olist_products.volume_m3 is 'Cubagem unitária em m³ (altura × largura × comprimento / 1e6). NULL quando alguma dimensão está zerada no ERP.';

-- ---------------------------------------------------------------------------
-- 4. Dados de envio em olist_orders (trigger, nunca generated column aqui)
-- ---------------------------------------------------------------------------

alter table public.olist_orders
  add column if not exists transportador_nome text,
  add column if not exists forma_envio text,
  add column if not exists frete_por_conta text,
  add column if not exists codigo_rastreamento text,
  add column if not exists valor_frete numeric;

create or replace function public.oraculo_olist_order_logistics_fields()
returns trigger
language plpgsql
as $$
begin
  new.transportador_nome := nullif(btrim(coalesce(new.transportador->>'nome', '')), '');
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
  'Trigger de olist_orders: materializa transportador_nome, forma_envio, frete_por_conta e codigo_rastreamento a partir do jsonb transportador, e valor_frete de payload.valorFrete (só presente em pedidos hidratados; preserva o último valor quando o payload regride ao shape de listagem). Existe porque generated column em olist_orders exigiria rewrite de ~1 GB sob ACCESS EXCLUSIVE.';

drop trigger if exists oraculo_olist_order_logistics_fields_trg on public.olist_orders;
create trigger oraculo_olist_order_logistics_fields_trg
  before insert or update of transportador, payload
  on public.olist_orders
  for each row
  execute function public.oraculo_olist_order_logistics_fields();

create index if not exists olist_orders_codigo_rastreamento_idx
  on public.olist_orders (codigo_rastreamento)
  where codigo_rastreamento is not null;

comment on column public.olist_orders.transportador_nome is 'Nome da transportadora (de transportador.nome; vazio vira NULL). Materializado por trigger — ver oraculo_olist_order_logistics_fields().';
comment on column public.olist_orders.forma_envio is 'Forma de envio (de transportador.formaEnvio.nome, ex.: "Shopee Envios", "Mercado Envios Coletas").';
comment on column public.olist_orders.frete_por_conta is 'Responsável pelo frete no ERP: R = remetente (CIF), D = destinatário (FOB).';
comment on column public.olist_orders.codigo_rastreamento is 'Código de rastreio informado no ERP. Índice parcial para conciliação com expedição.';
comment on column public.olist_orders.valor_frete is 'Valor do frete do pedido (payload.valorFrete). Só existe em pedidos hidratados com detalhe — a maioria dos payloads (shape de listagem) não traz o campo.';

-- ---------------------------------------------------------------------------
-- 5. View de leitura da tela /logistica/estoque
-- ---------------------------------------------------------------------------

create or replace view public.oraculo_estoque_por_deposito as
select
  i.produto_id,
  i.sku,
  i.nome,
  p.tipo,
  p.categoria_nome,
  p.peso_bruto_kg,
  p.volume_m3,
  i.saldo,
  i.reservado,
  i.disponivel,
  c.unit_cost,
  c.cost_source,
  case
    when c.unit_cost is not null and i.disponivel is not null and i.disponivel > 0
      then round(i.disponivel * c.unit_cost, 2)
  end as capital_custo,
  d.depositos
from public.olist_stock_items i
left join public.olist_products p on p.id = i.produto_id
left join public.oraculo_sku_unit_cost c on c.sku = i.sku
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'id', sd.deposito_id,
      'nome', coalesce(ld.apelido, ld.nome, sd.deposito_nome),
      'tipo', ld.tipo,
      'desconsiderar', sd.desconsiderar,
      'saldo', sd.saldo,
      'reservado', sd.reservado,
      'disponivel', sd.disponivel
    )
    order by coalesce(ld.apelido, ld.nome, sd.deposito_nome)
  ) as depositos
  from public.olist_stock_deposits sd
  left join public.logistica_depositos ld on ld.deposito_id = sd.deposito_id
  where sd.produto_id = i.produto_id
    and (coalesce(sd.saldo, 0) <> 0 or coalesce(sd.reservado, 0) <> 0 or coalesce(sd.disponivel, 0) <> 0)
) d on true
where i.active;

grant select on public.oraculo_estoque_por_deposito to authenticated;

comment on view public.oraculo_estoque_por_deposito is
  'Estoque Olist por produto com a quebra por depósito em jsonb (só depósitos com movimento), custo unitário canônico (oraculo_sku_unit_cost — nunca re-resolver custo) e capital parado a custo (disponivel × unit_cost). Uma linha por produto ativo de olist_stock_items. Fonte da tela /logistica/estoque.';
comment on column public.oraculo_estoque_por_deposito.capital_custo is 'Capital parado a custo líquido: disponivel × unit_cost, apenas quando há custo resolvido e disponível positivo.';
comment on column public.oraculo_estoque_por_deposito.depositos is 'Array jsonb [{id, nome, tipo, desconsiderar, saldo, reservado, disponivel}] com os depósitos com movimento do produto. Nulo enquanto o produto não foi varrido pelo sync de depósitos.';
