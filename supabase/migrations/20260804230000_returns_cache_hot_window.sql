-- Janela quente do cache de NF de venda: 20h era frio demais para o dia corrente.
--
-- A regra anterior só reprocessava um dia se ele tivesse sido atualizado há mais
-- de 20 horas. Para dias fechados está certo — eles não mudam. Mas o dia CORRENTE
-- recebe NF o tempo todo: processado às 13h38, ele só voltaria a ser lido no dia
-- seguinte, e toda venda emitida depois disso ficava fora do cache até lá.
--
-- Consequência prática: uma devolução aberta hoje sobre uma venda de hoje cairia
-- em 'sem_nf_venda' — um falso positivo que manda o time procurar nota que existe.
--
-- Agora: dias dentro da janela quente (hoje e os 2 anteriores, onde a Olist ainda
-- emite e corrige NF) reprocessam a cada 1h; o resto permanece imutável depois de
-- processado uma vez. Custo por dia é de poucos segundos, e o cron roda 2x/hora.

create or replace function public.refresh_oraculo_olist_order_ref_cache(p_days integer default 1)
returns table (processed_day date, rows_upserted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date;
  v_count integer;
begin
  for i in 1..greatest(p_days, 1) loop
    select d::date into v_day
      from generate_series(date '2026-05-01', (now() at time zone 'UTC')::date, interval '1 day') d
      left join public.oraculo_olist_order_ref_cache_days c on c.day = d::date
     where c.day is null
        or (d::date >= (now() at time zone 'UTC')::date - 2
            and c.refreshed_at < now() - interval '1 hour')
     order by d
     limit 1;

    if v_day is null then
      return;
    end if;

    insert into public.oraculo_olist_order_ref_cache
      (invoice_id, order_ref, channel_label, emission_date, client_document, total_amount, refreshed_at)
    select i.id,
           nullif(i.raw_json->'ecommerce'->>'numeroPedidoEcommerce', ''),
           nullif(i.raw_json->'ecommerce'->>'nome', ''),
           i.emission_date,
           i.client_document,
           i.total_amount,
           now()
      from public.olist_invoices i
     where i.fiscal_invoice_type = 'S'
       and i.emission_date >= v_day
       and i.emission_date < v_day + interval '1 day'
    on conflict (invoice_id) do update
      set order_ref      = excluded.order_ref,
          channel_label  = excluded.channel_label,
          emission_date  = excluded.emission_date,
          client_document= excluded.client_document,
          total_amount   = excluded.total_amount,
          refreshed_at   = excluded.refreshed_at;

    get diagnostics v_count = row_count;

    -- Marcar SEMPRE, inclusive com 0 linhas: é isso que faz o laço avançar.
    insert into public.oraculo_olist_order_ref_cache_days (day, rows_upserted, refreshed_at)
    values (v_day, v_count, now())
    on conflict (day) do update
      set rows_upserted = excluded.rows_upserted,
          refreshed_at  = excluded.refreshed_at;

    processed_day := v_day;
    rows_upserted := v_count;
    return next;
  end loop;
end;
$$;

grant execute on function public.refresh_oraculo_olist_order_ref_cache(integer) to service_role;
