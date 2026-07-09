alter table public.oraculo_state_tax_params
  add column if not exists interstate_icms_rate numeric not null default 0;

do $$
begin
  alter table public.oraculo_state_tax_params
    add constraint oraculo_state_tax_params_interstate_icms_rate_check
    check (interstate_icms_rate >= 0);
exception
  when duplicate_object then null;
end $$;

create or replace function public.calculate_oraculo_state_tax_difal()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.difal_rate := greatest(coalesce(new.icms_rate, 0) - coalesce(new.interstate_icms_rate, 0), 0);
  new.effective_tax_rate := coalesce(new.interstate_icms_rate, 0) + new.difal_rate + coalesce(new.fcp_rate, 0);
  return new;
end;
$$;

drop trigger if exists oraculo_state_tax_params_calculate_difal on public.oraculo_state_tax_params;

create trigger oraculo_state_tax_params_calculate_difal
before insert or update of icms_rate, interstate_icms_rate, fcp_rate, difal_rate, effective_tax_rate
on public.oraculo_state_tax_params
for each row
execute function public.calculate_oraculo_state_tax_difal();

revoke all on function public.calculate_oraculo_state_tax_difal() from public, anon, authenticated;
grant execute on function public.calculate_oraculo_state_tax_difal() to service_role;
