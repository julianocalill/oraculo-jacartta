-- Run against a disposable database after 20260908204720_full_workflow.sql.
-- All fixtures roll back.
begin;

create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %', message; end if; end $$;

insert into auth.users(id,email,raw_app_meta_data) values
 ('20000000-0000-0000-0000-000000000001','creator-full@test.invalid','{"operations":{"uberlandia":{"enabled":true,"tabs":["full"]}}}'),
 ('20000000-0000-0000-0000-000000000002','logistics-full@test.invalid','{"operations":{"uberlandia":{"enabled":true,"tabs":["full"]}}}'),
 ('20000000-0000-0000-0000-000000000003','outsider-full@test.invalid','{"operations":{"uberlandia":{"enabled":true,"tabs":["full"]}}}'),
 ('20000000-0000-0000-0000-000000000004','manager-full@test.invalid','{"operations":{"uberlandia":{"enabled":true,"tabs":["full"],"full_manager":true}}}'),
 ('20000000-0000-0000-0000-000000000005','other-operation-full@test.invalid','{"operations":{"giracasa":{"enabled":true,"tabs":["full"],"full_manager":true}}}'),
 ('20000000-0000-0000-0000-000000000006','approver-full@test.invalid','{"operations":{"uberlandia":{"enabled":true,"tabs":["full"]}}}');

insert into public.oraculo_fulls(id,channel,store_key,store_name,creator_user_id,logistics_user_id,approver_user_id)
values ('20000000-0000-0000-0000-0000000000ff','mercadolivre','fixture-store','Fixture',
  '20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000006');

insert into public.oraculo_full_participants(full_id,user_id,participant_role) values
 ('20000000-0000-0000-0000-0000000000ff','20000000-0000-0000-0000-000000000001','criador'),
 ('20000000-0000-0000-0000-0000000000ff','20000000-0000-0000-0000-000000000002','logistica'),
 ('20000000-0000-0000-0000-0000000000ff','20000000-0000-0000-0000-000000000006','aprovador');

select public.oraculo_write_full_revision(
  '20000000-0000-0000-0000-0000000000ff', 1, '20000000-0000-0000-0000-000000000001', 'fixture',
  '[{"channel_item_key":"MLB1/10","channel_item_id":"MLB1","channel_model_id":"10","marketplace_sku":"KIT-1","marketplace_title":"Kit fixture","marketplace_variation":"Azul","selected_olist_product_id":"olist-kit","selected_olist_sku":"KIT-1","selected_olist_title":"Kit fixture","selected_olist_is_kit":true,"requested_qty":10,"position":1,"components":[{"olist_product_id":"component-1","olist_sku":"COMP-1","olist_title":"Componente","units_per_marketplace":2,"required_qty":20}]}]'::jsonb
);

select pg_temp.assert((select required_qty=20 and ready_qty=0 and active from public.oraculo_full_production_lines where full_id='20000000-0000-0000-0000-0000000000ff' and olist_sku='COMP-1'),'kit expansion creates physical need');

update public.oraculo_full_revisions set frozen_at=now() where full_id='20000000-0000-0000-0000-0000000000ff' and revision_no=1;
do $$ begin
  begin
    update public.oraculo_full_revision_items set requested_qty=99 where full_id='20000000-0000-0000-0000-0000000000ff';
    raise exception 'frozen item update allowed';
  exception when raise_exception then
    if sqlerrm='frozen item update allowed' then raise; end if;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"20000000-0000-0000-0000-000000000001"}',true);
select pg_temp.assert((select count(*)=1 from public.oraculo_fulls where id='20000000-0000-0000-0000-0000000000ff'),'creator reads Full');
select pg_temp.assert((select count(*)=1 from public.oraculo_full_revision_items where full_id='20000000-0000-0000-0000-0000000000ff'),'creator reads revision items');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"20000000-0000-0000-0000-000000000002"}',true);
select pg_temp.assert((select count(*)=1 from public.oraculo_fulls where id='20000000-0000-0000-0000-0000000000ff'),'logistics reads Full');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"20000000-0000-0000-0000-000000000006"}',true);
select pg_temp.assert((select count(*)=1 from public.oraculo_fulls where id='20000000-0000-0000-0000-0000000000ff'),'selected approver reads Full');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"20000000-0000-0000-0000-000000000003"}',true);
select pg_temp.assert((select count(*)=0 from public.oraculo_fulls where id='20000000-0000-0000-0000-0000000000ff'),'outsider cannot read Full');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"20000000-0000-0000-0000-000000000004"}',true);
select pg_temp.assert((select count(*)=1 from public.oraculo_fulls where id='20000000-0000-0000-0000-0000000000ff'),'manager reads all Fulls');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"20000000-0000-0000-0000-000000000005"}',true);
select pg_temp.assert((select count(*)=0 from public.oraculo_fulls where id='20000000-0000-0000-0000-0000000000ff'),'other operation manager cannot read Uberlandia Full');

do $$ begin
  begin
    insert into public.oraculo_fulls(channel,store_key,store_name,creator_user_id,logistics_user_id,approver_user_id)
    values ('amazon','forbidden','Forbidden','20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000005');
    raise exception 'authenticated write allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
