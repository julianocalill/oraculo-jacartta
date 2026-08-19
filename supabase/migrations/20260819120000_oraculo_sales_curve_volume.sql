-- Curva de Venda por volume vendido num período (ABC clássica), com filtro de
-- canal.
--
-- A aba já tinha a curva por recência (oraculo_sales_curve, materialized view
-- com cortes de 90/180 dias sobre a última venda). Este RPC responde outra
-- pergunta: dentro de um período escolhido, quais SKUs concentram o volume.
--
-- Cortes: A = itens até 80% acumulado das unidades, B = até 95%, C = o resto
-- (inclusive os produtos em estoque que não venderam nada no período).
-- O item que cruza a fronteira fica na curva de baixo (compara o acumulado
-- *antes* da própria linha), padrão da ABC.
--
-- Sem cache: a janela é livre e a base só tem pedidos desde 01/05/2026, então a
-- agregação vai direto em olist_order_items pelo índice de order_data_criacao
-- (~3s para um mês).
--
-- Canal: o nome só existe dentro de olist_orders.payload (jsonb de 957 MB, ver
-- 20260727120000_oraculo_top_sellers.sql). Destoastar isso custa ~3x o tempo da
-- mesma agregação sem tocar no payload, então o predicado é montado por
-- EXECUTE e só entra na query quando o filtro está ativo — "todos os canais"
-- continua barato. O valor vai por quote_literal (filtro simples, sem risco de
-- injeção).
--
-- Por que o filtro importa: 2 pedidos de atacado B2B em 08/2026 somaram 63.557
-- unidades, mais que qualquer marketplace inteiro no mesmo período, e sozinhos
-- reduziam a curva A a um punhado de SKUs. São vendas reais, então nada é
-- excluído por padrão — quem decide é a tela.
drop function if exists public.oraculo_sales_curve_volume(date, date);

create or replace function public.oraculo_sales_curve_volume(
  p_start date,
  p_end date,
  p_channel text default null,
  p_exclude_no_channel boolean default false
)
returns table (
  product_id text,
  source text,
  sku text,
  product_name text,
  available_stock numeric,
  units_sold numeric,
  revenue numeric,
  orders_count bigint,
  share_pct numeric,
  cum_share_pct numeric,
  last_sale_at timestamptz,
  days_without_sale integer,
  curve text
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '45s'
as $fn$
declare
  channel_filter text := '';
begin
  if p_channel is not null then
    channel_filter := format(
      $f$ and coalesce(nullif(o.payload #>> '{ecommerce,nome}', ''), 'Sem canal') = %s $f$,
      quote_literal(p_channel)
    );
  elsif p_exclude_no_channel then
    channel_filter := $f$ and coalesce(nullif(o.payload #>> '{ecommerce,nome}', ''), '') <> '' $f$;
  end if;

  return query execute format($q$
    with period_items as (
      select
        oi.produto_id,
        oi.order_id,
        oi.quantidade,
        coalesce(oi.valor_total, oi.quantidade * coalesce(oi.valor_unitario, 0)) as valor,
        oi.order_data_criacao
      from public.olist_order_items oi
      join public.olist_orders o
        on o.id = oi.order_id
      left join public.dim_order_status s
        on s.source = 'olist' and s.code = o.situacao
      where oi.order_data_criacao >= $1::timestamptz
        and oi.order_data_criacao < ($2 + 1)::timestamptz
        and not coalesce(s.is_canceled, o.situacao = '8', false)
        %s
    ),
    by_product as (
      select
        produto_id,
        sum(quantidade) as units_sold,
        sum(valor) as revenue,
        count(distinct order_id) as orders_count,
        max(order_data_criacao) as last_sale_at
      from period_items
      where produto_id is not null
      group by produto_id
    ),
    base as (
      select
        p.id as product_id,
        p.sku,
        p.nome as product_name,
        p.disponivel::numeric as available_stock,
        coalesce(b.units_sold, 0) as units_sold,
        coalesce(b.revenue, 0) as revenue,
        coalesce(b.orders_count, 0) as orders_count,
        b.last_sale_at
      from public.olist_products p
      left join by_product b on b.produto_id = p.id
      where p.tipo is distinct from 'K'
        and (p.disponivel > 0 or b.produto_id is not null)
    ),
    ranked as (
      select
        base.*,
        sum(units_sold) over () as total_units,
        sum(units_sold) over (
          order by units_sold desc, product_name asc, product_id asc
          rows between unbounded preceding and 1 preceding
        ) as units_before
      from base
    )
    select
      product_id,
      'olist'::text as source,
      sku,
      product_name,
      available_stock,
      units_sold,
      revenue,
      orders_count,
      case when total_units > 0 then round(units_sold * 100 / total_units, 4) else 0 end as share_pct,
      case
        when total_units > 0
          then round((coalesce(units_before, 0) + units_sold) * 100 / total_units, 4)
        else 0
      end as cum_share_pct,
      last_sale_at,
      case
        when last_sale_at is null then null::integer
        else greatest(floor(extract(epoch from (($2 + 1)::timestamptz - last_sale_at)) / 86400), 0)::integer
      end as days_without_sale,
      case
        when units_sold <= 0 or total_units is null or total_units <= 0 then 'C'
        when coalesce(units_before, 0) * 100 / total_units < 80 then 'A'
        when coalesce(units_before, 0) * 100 / total_units < 95 then 'B'
        else 'C'
      end as curve
    from ranked
    order by units_sold desc, product_name asc
  $q$, channel_filter)
  using p_start, p_end;
end;
$fn$;

-- Mesmo padrão dos demais RPCs de leitura (20260710092000): security definer +
-- search_path fixo + grant para authenticated, para a página e o export lerem
-- pelo client do usuário sem expor as tabelas base.
revoke all on function public.oraculo_sales_curve_volume(date, date, text, boolean) from public, anon;
grant execute on function public.oraculo_sales_curve_volume(date, date, text, boolean) to authenticated, service_role;

-- Lista de canais para o select da tela. Lê o cache diário de quantidade por
-- canal (20260727120000) em vez do payload — é a fonte barata para nomes.
create or replace function public.oraculo_sales_curve_channels()
returns table (channel_name text, units numeric)
language sql
stable
security definer
set search_path = public
set statement_timeout = '10s'
as $$
  select channel_name, sum(units) as units
  from public.oraculo_olist_qty_channel_daily_cache
  group by channel_name
  order by sum(units) desc;
$$;

revoke all on function public.oraculo_sales_curve_channels() from public, anon;
grant execute on function public.oraculo_sales_curve_channels() to authenticated, service_role;
