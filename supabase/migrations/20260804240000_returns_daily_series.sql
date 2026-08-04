-- Série diária de devoluções — alimenta sparklines dos cards e o gráfico de área
-- da aba, no mesmo padrão do dashboard principal.
--
-- Agrega pela DATA DE ABERTURA em America/Sao_Paulo. Usar UTC jogaria toda
-- devolução aberta depois das 21h para o dia seguinte — na planilha do TikTok
-- isso desloca sozinho ~12% das linhas.
--
-- Dias sem devolução aparecem com zero (generate_series), senão a sparkline
-- desenha uma reta entre pontos distantes e some com o buraco.

create or replace function public.oraculo_returns_daily(
  p_from timestamptz,
  p_to timestamptz,
  p_channel text default null
)
returns table (
  day date,
  returns_count bigint,
  loss_count bigint,
  amount numeric
)
language sql
stable
as $$
  with days as (
    select generate_series(
             (p_from at time zone 'America/Sao_Paulo')::date,
             ((p_to at time zone 'America/Sao_Paulo')::date - 1),
             interval '1 day'
           )::date as day
  ), agg as (
    select (r.opened_at at time zone 'America/Sao_Paulo')::date as day,
           count(*)                                             as returns_count,
           count(*) filter (where r.counts_as_loss)             as loss_count,
           sum(r.refund_amount_effective)                       as amount
      from public.oraculo_returns_reconciled r
     where r.opened_at >= p_from
       and r.opened_at < p_to
       and (p_channel is null or r.channel = p_channel)
     group by 1
  )
  select d.day,
         coalesce(a.returns_count, 0),
         coalesce(a.loss_count, 0),
         coalesce(a.amount, 0)
    from days d
    left join agg a on a.day = d.day
   order by d.day;
$$;

grant execute on function public.oraculo_returns_daily(timestamptz, timestamptz, text) to authenticated, service_role;

-- Quais canais têm dado no período — a aba só mostra o que existe, em vez de
-- oferecer uma aba vazia de um canal que ainda não foi integrado.
create or replace function public.oraculo_returns_channels(
  p_from timestamptz,
  p_to timestamptz
)
returns table (channel text, returns_count bigint)
language sql
stable
as $$
  select r.channel, count(*)
    from public.oraculo_returns r
   where r.opened_at >= p_from and r.opened_at < p_to
   group by 1
   order by 2 desc;
$$;

grant execute on function public.oraculo_returns_channels(timestamptz, timestamptz) to authenticated, service_role;
