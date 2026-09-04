-- Run against a disposable database only. All fixtures roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',message; end if; end $$;
insert into auth.users(id,email,raw_app_meta_data) values
 ('10000000-0000-0000-0000-000000000001','mg@test.invalid','{"operations":{"uberlandia":{"enabled":true}}}'),
 ('10000000-0000-0000-0000-000000000002','sp@test.invalid','{"operations":{"giracasa":{"enabled":true}}}'),
 ('10000000-0000-0000-0000-000000000003','both@test.invalid','{"operations":{"uberlandia":{"enabled":true},"giracasa":{"enabled":true}}}');
update public.oraculo_operations set enabled=true where id='giracasa';
insert into public.olist_products(id,sku,nome,tipo,preco_custo,payload) values ('isolation-fixture','SAME-SKU','MG product','S',100,'{"origem":"1"}');
insert into giracasa.olist_products(id,sku,nome,tipo,preco_custo,payload) values ('isolation-fixture','SAME-SKU','SP product','S',40,'{"origem":"1"}');
insert into giracasa.olist_invoices(id,emission_date,status,uf,total_amount,channel_name,raw_json)
values ('isolation-invoice','2026-09-01','6','SP',100,'Shopee','{"tipo":"S"}');
insert into giracasa.olist_invoice_items(id,invoice_id,product_id,sku,quantity,unit_value,total_value)
values ('isolation-item','isolation-invoice','isolation-fixture','SAME-SKU',1,100,100);
insert into giracasa.oraculo_marketplace_fee_params(marketplace_key,display_name,match_pattern,tiers)
values ('test-shopee','Shopee','%Shopee%','[{"max":null,"rate":10,"fixed":0}]');
select pg_temp.assert((select operation_id='uberlandia' from public.olist_products where id='isolation-fixture'),'MG ownership default');
select pg_temp.assert((select operation_id='giracasa' from giracasa.olist_products where id='isolation-fixture'),'SP ownership default');
select pg_temp.assert((select unit_cost=88.25 from public.oraculo_sku_unit_cost where sku='SAME-SKU'),'MG retains net cost');
select pg_temp.assert((select unit_cost=40 from giracasa.oraculo_sku_unit_cost where sku='SAME-SKU'),'SP does not use MG reducer');
select pg_temp.assert((select abs(profit-26.45)<0.00001 and icms=18 and difal=0 and pis_cofins=5.55 from giracasa.oraculo_fiscal_margin_lines('2026-09-01','2026-09-01')),'SP financial golden example');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000001"}',true);
select pg_temp.assert((select count(*)=1 from public.olist_products where id='isolation-fixture'),'MG reads own table');
select pg_temp.assert((select count(*)=0 from giracasa.olist_products),'MG cannot read SP table');
select pg_temp.assert((select count(*)=0 from giracasa.oraculo_sku_unit_cost),'MG cannot read SP owner view');
select pg_temp.assert((select unit_cost=88.25 from public.oraculo_sku_unit_cost where sku='SAME-SKU'),'MG authenticated cost view');
do $$ begin
 begin perform * from giracasa.oraculo_fiscal_margin_lines('2026-09-01','2026-09-01'); raise exception 'RPC allowed wrong operation';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"10000000-0000-0000-0000-000000000002"}',true);
select pg_temp.assert((select count(*)=0 from public.olist_products),'SP cannot read MG table');
select pg_temp.assert((select count(*)=0 from public.oraculo_sku_unit_cost),'SP cannot read MG owner view');
select pg_temp.assert((select unit_cost=40 from giracasa.oraculo_sku_unit_cost where sku='SAME-SKU'),'SP authenticated cost view');
select pg_temp.assert((select abs(profit-26.45)<0.00001 from giracasa.oraculo_fiscal_margin_lines('2026-09-01','2026-09-01')),'SP authenticated RPC');
reset role;
update auth.users set raw_app_meta_data='{"operations":{}}' where id='10000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.assert((select count(*)=0 from giracasa.olist_products),'Revocation applies with the same JWT');
reset role;
select set_config('request.jwt.claims','',true);
do $$ begin
 begin insert into giracasa.olist_products(id,operation_id) values ('invalid-operation','uberlandia'); raise exception 'wrong operation accepted';
 exception when check_violation then null; end;
end $$;
rollback;
