-- shopee_orders e shopee_order_items carregam dados pessoais de terceiros.
-- A RPC de vendas da Expedição é consumida somente pelo Server Component após
-- requireTabAccess(), usando createSupabaseAdminClient(); não deve ser exposta
-- diretamente a qualquer JWT autenticado.

revoke execute on function public.oraculo_fulfillment_sales_daily(date, date, bigint)
  from public, anon, authenticated;
grant execute on function public.oraculo_fulfillment_sales_daily(date, date, bigint)
  to service_role;
