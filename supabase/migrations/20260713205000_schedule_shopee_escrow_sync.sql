-- Agenda o escrow sync (edge function shopee-escrow-sync) por loja, a cada
-- 30 min, em minutos que não colidem com o shopee-sync de pedidos
-- (0/3/6/9 + múltiplos de 15). Teto 80 pedidos/run → capacidade ~3.8k/dia/loja,
-- muito acima do volume; o backlog de julho (~3.1k) drena em algumas horas.

do $$
declare
  j record;
begin
  for j in
    select unnest(array[
      'shopee-escrow-donacor', 'shopee-escrow-espaco-de-bicho',
      'shopee-escrow-oliverhome', 'shopee-escrow-jacartta'
    ]) as name
  loop
    begin
      perform cron.unschedule(j.name);
    exception when others then null;
    end;
  end loop;
end $$;

select cron.schedule('shopee-escrow-donacor',         '11-59/30 * * * *', $$ select private.invoke_shopee_escrow_sync(1227023039, 80); $$);
select cron.schedule('shopee-escrow-espaco-de-bicho', '13-59/30 * * * *', $$ select private.invoke_shopee_escrow_sync(823664460, 80); $$);
select cron.schedule('shopee-escrow-oliverhome',      '17-59/30 * * * *', $$ select private.invoke_shopee_escrow_sync(1540426526, 80); $$);
select cron.schedule('shopee-escrow-jacartta',        '19-59/30 * * * *', $$ select private.invoke_shopee_escrow_sync(279375549, 80); $$);
