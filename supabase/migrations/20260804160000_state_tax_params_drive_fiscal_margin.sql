-- Liga a tela /parametros ("Imposto por UF") ao motor fiscal.
--
-- Até aqui `oraculo_state_tax_params` era escrita pela tela e **lida por
-- ninguém**: as alíquotas que valiam estavam fixas dentro de
-- `oraculo_fiscal_margin_lines` (tabela das 27 UFs + regra 4/12/7 + matriz
-- Jacartta de ICMS de saída). Trocar uma alíquota exigia migration e deploy.
--
-- Agora o motor consulta a tabela linha a linha, pela UF + origem da mercadoria
-- + data de emissão da NF, e só usa a linha quando ela está `params_configured`
-- (marcada como "Validado" na tela). Sem linha validada, cai no comportamento
-- atual — então esta migration, sozinha, **não muda nenhum número**.
--
-- Duas colunas novas, porque a tabela antiga não conseguia expressar as regras:
--   * `merchandise_origin` — a alíquota interestadual depende da origem
--     (importado 4% vs nacional 7/12%). Sem essa dimensão, uma linha por UF
--     aplicaria a alíquota do nacional no importado. Entra na PK.
--   * `outbound_icms_rate` — o ICMS de SAÍDA (matriz Jacartta: MG 6/14%, demais
--     1,3%) não tinha campo na tabela; `icms_rate` é a alíquota INTERNA DO
--     DESTINO, usada só no DIFAL. São coisas diferentes. Nulo = usa a matriz.
--
-- O FCP também passa a existir no cálculo: quando configurado, soma ao DIFAL
-- (é como é recolhido — DIFAL + FCP na mesma guia). Hoje é 0 em todas as UFs.

alter table public.oraculo_state_tax_params
  add column if not exists merchandise_origin text not null default '*',
  add column if not exists outbound_icms_rate numeric;

do $$
begin
  alter table public.oraculo_state_tax_params
    add constraint oraculo_state_tax_params_origin_check
    check (merchandise_origin in ('*', 'nacional', 'importado'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.oraculo_state_tax_params
    add constraint oraculo_state_tax_params_outbound_check
    check (outbound_icms_rate is null or outbound_icms_rate >= 0);
exception when duplicate_object then null;
end $$;

-- PK passa a incluir a origem (antes: uf, operation_type, applies_to_source, valid_from).
alter table public.oraculo_state_tax_params
  drop constraint if exists oraculo_state_tax_params_pkey;

alter table public.oraculo_state_tax_params
  add constraint oraculo_state_tax_params_pkey
  primary key (uf, operation_type, applies_to_source, merchandise_origin, valid_from);

-- As 27 linhas originais eram um placeholder zerado ("pendente de validação
-- fiscal"), nunca editado. Some com elas apenas se continuarem exatamente
-- assim — qualquer linha que alguém tenha preenchido fica onde está.
delete from public.oraculo_state_tax_params
where params_configured = false
  and coalesce(icms_rate, 0) = 0
  and coalesce(interstate_icms_rate, 0) = 0
  and coalesce(fcp_rate, 0) = 0
  and outbound_icms_rate is null;

-- Semeia as 27 UFs × 2 origens com EXATAMENTE o que o motor calcula hoje, como
-- "Pendente". A tela deixa de mostrar 27 linhas zeradas (que não diziam nada) e
-- passa a mostrar a regra vigente de verdade; validar é revisar e marcar
-- "Validado", em vez de digitar tudo do zero.
insert into public.oraculo_state_tax_params (
  uf, operation_type, applies_to_source, merchandise_origin, valid_from,
  icms_rate, interstate_icms_rate, fcp_rate, outbound_icms_rate,
  params_configured, notes
)
select
  r.uf,
  'venda_consumidor',
  '*',
  o.origin,
  date '2026-01-01',
  r.internal_rate,
  case when o.origin = 'importado' then 4
       when r.uf in ('MG','PR','RJ','RS','SC','SP') then 12
       else 7 end,
  0,
  case when r.uf = 'MG' then (case when o.origin = 'importado' then 14 else 6 end)
       else 1.3 end,
  false,
  'Semeado em 04/08/2026 com a regra que o motor fiscal já aplicava (matriz Jacartta + tabela interna das 27 UFs). Revisar com o contador e marcar como Validado para passar a valer.'
from (values
  ('AC',19),('AL',20),('AP',18),('AM',20),('BA',20.5),('CE',20),('DF',20),
  ('ES',17),('GO',19),('MA',22),('MT',17),('MS',17),('MG',18),('PA',19),
  ('PB',20),('PR',19.5),('PE',20.5),('PI',21),('RJ',22),('RN',20),('RS',17),
  ('RO',19.5),('RR',20),('SC',17),('SP',18),('SE',19),('TO',20)
) as r(uf, internal_rate)
cross join (values ('nacional'), ('importado')) as o(origin)
on conflict (uf, operation_type, applies_to_source, merchandise_origin, valid_from) do nothing;

-- ---------------------------------------------------------------------------

create or replace function public.oraculo_fiscal_margin_lines(p_start date, p_end date)
returns table (
  invoice_id text,
  uf text,
  channel_label text,
  marketplace_key text,
  sku text,
  produto_id text,
  origin text,
  quantity numeric,
  revenue numeric,
  cost numeric,
  cost_missing boolean,
  icms numeric,
  pis_cofins numeric,
  difal numeric,
  taxes_total numeric,
  marketplace_fee numeric,
  fee_missing boolean,
  profit numeric
)
language sql
stable
security definer
set search_path = public
as $$
  -- Fallback: alíquota interna do destino quando não há parâmetro validado.
  with internal_icms(uf, rate) as (
    values ('AC',19),('AL',20),('AP',18),('AM',20),('BA',20.5),('CE',20),('DF',20),
           ('ES',17),('GO',19),('MA',22),('MT',17),('MS',17),('MG',18),('PA',19),
           ('PB',20),('PR',19.5),('PE',20.5),('PI',21),('RJ',22),('RN',20),('RS',17),
           ('RO',19.5),('RR',20),('SC',17),('SP',18),('SE',19),('TO',20)
  ),
  -- Faixas de comissão achatadas: uma linha por degrau.
  fee_tiers as (
    select
      p.marketplace_key,
      p.match_pattern,
      p.match_priority,
      p.fee_configured,
      x.ord,
      case when x.tier->>'max' is null then null else (x.tier->>'max')::numeric end as max_price,
      coalesce((x.tier->>'rate')::numeric, 0) as rate,
      coalesce((x.tier->>'fixed')::numeric, 0) as fixed
    from oraculo_marketplace_fee_params p
    cross join lateral jsonb_array_elements(p.tiers) with ordinality as x(tier, ord)
  ),
  raw as (
    select
      l.invoice_id,
      l.issued_date,
      upper(coalesce(inv.uf, '')) as uf,
      coalesce(inv.fiscal_channel_label, 'Sem canal') as channel_label,
      oi.sku,
      oi.produto_id,
      case when (p.payload->>'origem') = '1' then 'importado' else 'nacional' end as origin,
      coalesce(oi.quantidade, 0)::numeric as quantity,
      coalesce(oi.valor_total, 0)::numeric as revenue,
      coalesce(ec.unit_cost, 0)::numeric as raw_unit_cost,
      coalesce(ec.cost_complete, false) as cost_complete,
      case when coalesce(oi.quantidade,0) > 0 then coalesce(oi.valor_total,0) / oi.quantidade else null end as unit_price
    from oraculo_fiscal_invoice_order_links l
    join olist_invoices inv on inv.id = l.invoice_id
    join olist_order_items oi on oi.order_id = l.order_id
    left join olist_products p on p.id = oi.produto_id
    left join oraculo_product_effective_cost ec on ec.product_id = oi.produto_id
    where l.issued_date between p_start and p_end
      and l.order_id is not null
  ),
  base as (
    select
      invoice_id, issued_date, uf, channel_label, sku, produto_id, origin,
      quantity, revenue, unit_price,
      case
        when raw_unit_cost <= 0 then null
        when not cost_complete then null
        when unit_price is not null and raw_unit_cost > unit_price * 3 then null
        else quantity * raw_unit_cost
      end as cost,
      (
        raw_unit_cost <= 0
        or not cost_complete
        or (unit_price is not null and raw_unit_cost > unit_price * 3)
      ) as cost_missing
    from raw
  ),
  calc as (
    select
      b.*,
      -- ICMS de saída: parâmetro validado da UF/origem, senão matriz Jacarta.
      b.revenue * coalesce(
        tp.outbound_icms_rate,
        case when b.uf = 'MG' then (case when b.origin = 'importado' then 14 else 6 end)
             else 1.3 end
      ) / 100.0 as icms,
      -- PIS/COFINS 9,25% líquido de crédito sobre o custo (null se custo indisponível)
      case when b.cost is null then null
           else greatest(0, b.revenue * 0.0925 - b.cost * 0.0925) end as pis_cofins,
      -- DIFAL = base × [max(0, interna_destino − interestadual) + FCP].
      -- Alíquotas do parâmetro validado quando existir; senão, regra fixa.
      b.revenue * (
        greatest(0,
          coalesce(tp.icms_rate, ii.rate, 0)
          - coalesce(tp.interstate_icms_rate,
              case when b.origin = 'importado' then 4
                   when b.uf in ('MG','PR','RJ','RS','SC','SP') then 12
                   else 7 end)
        )
        + coalesce(tp.fcp_rate, 0)
      ) / 100.0 as difal,
      -- Comissão do marketplace: faixa pelo preço unitário, fixo por unidade.
      fee.marketplace_key,
      not coalesce(fee.fee_configured, false) as fee_missing,
      case when fee.fee_configured then
        b.revenue * coalesce(fee.rate, 0) / 100.0 + coalesce(fee.fixed, 0) * b.quantity
      else 0 end as marketplace_fee
    from base b
    left join internal_icms ii on ii.uf = b.uf
    -- Parâmetro da tela /parametros: só conta se validado e vigente na data da
    -- NF. Preferência: origem exata > '*'; fonte 'olist' > '*'; vigência mais recente.
    left join lateral (
      select p.icms_rate, p.interstate_icms_rate, p.fcp_rate, p.outbound_icms_rate
      from oraculo_state_tax_params p
      where p.params_configured
        and p.uf = b.uf
        and p.operation_type = 'venda_consumidor'
        and p.applies_to_source in ('*', 'olist')
        and p.merchandise_origin in ('*', b.origin)
        and p.valid_from <= b.issued_date
        and (p.valid_to is null or p.valid_to >= b.issued_date)
      order by
        case when p.merchandise_origin = b.origin then 0 else 1 end,
        case when p.applies_to_source = 'olist' then 0 else 1 end,
        p.valid_from desc
      limit 1
    ) tp on true
    left join lateral (
      select ft.marketplace_key, ft.rate, ft.fixed, ft.fee_configured
      from fee_tiers ft
      where b.channel_label ilike ft.match_pattern
        and (ft.max_price is null or coalesce(b.unit_price, b.revenue) <= ft.max_price)
      order by ft.match_priority, ft.ord
      limit 1
    ) fee on true
  )
  select
    invoice_id, uf, channel_label, marketplace_key, sku, produto_id, origin,
    quantity, revenue, cost, cost_missing,
    icms, pis_cofins, difal,
    case when cost is null then null else icms + pis_cofins + difal end as taxes_total,
    marketplace_fee, fee_missing,
    case when cost is null then null
         else revenue - cost - icms - pis_cofins - difal - marketplace_fee end as profit
  from calc;
$$;

grant execute on function public.oraculo_fiscal_margin_lines(date, date) to authenticated;

create index if not exists oraculo_state_tax_params_lookup_idx
  on public.oraculo_state_tax_params (uf, merchandise_origin, params_configured, valid_from desc);
