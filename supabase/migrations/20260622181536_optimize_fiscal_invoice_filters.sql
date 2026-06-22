create index if not exists olist_invoices_fiscal_filter_idx
  on public.olist_invoices (
    emission_date,
    status,
    (upper(coalesce(raw_json->>'tipo', ''))),
    (lower(coalesce(raw_json->'origem'->>'tipo', '')))
  );

create index if not exists olist_invoices_raw_tipo_idx
  on public.olist_invoices ((raw_json->>'tipo'));

create index if not exists olist_invoices_raw_origem_tipo_idx
  on public.olist_invoices ((raw_json->'origem'->>'tipo'));
