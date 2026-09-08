-- A premissa da Giracasa é usar as regras padrão do aplicativo Financeiro.
-- A única tarifa de marketplace definida naquela referência é a Shopee.
-- TikTok e Mercado Livre permanecem sem regra até a operação fornecer seus
-- contratos; o motor continuará retornando lucro pendente nesses canais.
insert into giracasa.oraculo_marketplace_fee_params (
  marketplace_key,
  display_name,
  match_pattern,
  match_priority,
  tiers,
  fee_configured,
  notes
)
values (
  'shopee',
  'Shopee',
  'Shopee%',
  10,
  '[
    {"max": 79.99,  "rate": 20, "fixed": 4},
    {"max": 99.99,  "rate": 14, "fixed": 16},
    {"max": 199.99, "rate": 14, "fixed": 20},
    {"max": 499.99, "rate": 14, "fixed": 26},
    {"max": null,   "rate": 14, "fixed": 28}
  ]'::jsonb,
  true,
  'Regra padrão do aplicativo Financeiro: percentual por faixa e tarifa fixa por unidade.'
)
on conflict (marketplace_key) do update set
  display_name = excluded.display_name,
  match_pattern = excluded.match_pattern,
  match_priority = excluded.match_priority,
  tiers = excluded.tiers,
  fee_configured = excluded.fee_configured,
  notes = excluded.notes,
  updated_at = now();

notify pgrst, 'reload schema';
