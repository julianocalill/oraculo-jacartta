-- O relatório de vendas passou a consultar a Shopee Open Platform diretamente
-- no n8n. Removemos a RPC para impedir que o fluxo volte a depender dos dados
-- sincronizados pelo Oráculo.
drop function if exists public.shopee_sales_whatsapp_report(timestamptz, timestamptz);
