-- As páginas de estoque/reposição leem shopee_shops com o papel authenticated
-- para exibir o NOME das lojas (sem isso caíam no fallback do shop_id).
grant select on table public.shopee_shops to authenticated;

do $$
begin
  create policy shopee_shops_authenticated_read
    on public.shopee_shops for select to authenticated using (true);
exception when duplicate_object then null;
end $$;
