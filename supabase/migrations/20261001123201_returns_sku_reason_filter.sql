-- Filtro de motivo aplicado ANTES da agregação e do top N de SKUs.
-- Sobrecarga de 5 argumentos obrigatórios: chamadas legadas de 4 argumentos
-- continuam idênticas, sem ambiguidade de parâmetros opcionais no PostgREST.
-- Mantém o gate por operação dos wrappers existentes e o livro canônico de
-- custos. Não altera tabelas, views, dados nem a função legada/comentários.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $migration$
declare
  target_schema text;
  operation_key text;
begin
  foreach target_schema in array array['public', 'giracasa'] loop
    operation_key := case when target_schema = 'public' then 'uberlandia' else 'giracasa' end;
    execute format($definition$
      create or replace function %1$I.oraculo_returns_by_sku(
        p_from timestamptz, p_to timestamptz, p_channel text,
        p_limit integer, p_reason_group text
      )
      returns table (
        sku text, sku_channel text, product_name text,
        returns_count bigint, units numeric, refund_amount numeric,
        unit_cost numeric, cost_lost numeric, sem_nf_count bigint
      )
      language plpgsql stable security definer set search_path = ''
      as $function$
      begin
        if not oraculo_private.can_access_operation(%2$L) then
          raise exception 'Sem acesso à operação' using errcode = '42501';
        end if;
        return query
          select coalesce(r.sku_olist_final, r.sku_channel),
                 min(r.sku_channel), min(r.product_name), count(*),
                 sum(r.qty), sum(r.refund_amount_effective),
                 max(uc.unit_cost), sum(r.qty) * max(uc.unit_cost),
                 count(*) filter (where r.flag = 'sem_nf_devolucao')
            from %1$I.oraculo_returns_reconciled r
            left join %1$I.oraculo_sku_unit_cost uc on uc.sku = r.sku_olist_final
           where r.opened_at >= p_from and r.opened_at < p_to
             and r.counts_as_loss
             and (p_channel is null or r.channel = p_channel)
             and (p_reason_group is null or coalesce(r.reason_group, 'outros') = p_reason_group)
           group by 1
           order by 6 desc nulls last
           limit p_limit;
      end;
      $function$;
    $definition$, target_schema, operation_key);
    execute format('revoke all on function %I.oraculo_returns_by_sku(timestamptz,timestamptz,text,integer,text) from public, anon', target_schema);
    execute format('grant execute on function %I.oraculo_returns_by_sku(timestamptz,timestamptz,text,integer,text) to authenticated, service_role', target_schema);
    execute format('comment on function %I.oraculo_returns_by_sku(timestamptz,timestamptz,text,integer,text) is %L',
      target_schema,
      'Ranking de devoluções por SKU, filtrado por motivo padronizado antes da agregação e do limite. Parâmetros: início inclusivo, fim exclusivo, canal (null=todos), limite, motivo (null=todos). Apenas perdas; valor efetivo e custo canônico. Acesso validado por operação: ' || operation_key || '.');
  end loop;
end $migration$;

notify pgrst, 'reload schema';
commit;
