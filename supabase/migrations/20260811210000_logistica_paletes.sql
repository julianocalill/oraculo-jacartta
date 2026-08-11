-- Aba Logística → Etiqueta: paletes etiquetados para expedição.
--
-- Primeira peça do módulo de Logística. Cada linha aqui é um palete real que
-- saiu com etiqueta 100x150mm colada; o `code` é o que viaja dentro do QR e
-- vira a URL /logistica/palete/<code>.
--
-- Decisões de modelagem:
--   * `code` é gerado no app (12 chars, alfabeto sem 0/O/1/I) e é a chave
--     pública da etiqueta. Não usamos o uuid na URL para o código caber legível
--     embaixo do QR — quem não consegue escanear digita.
--   * Visibilidade é binária (`using (true)`), como o resto do projeto: quem
--     tem a aba Logística vê todos os paletes. A RLS por linha da Agenda
--     (20260810120000) é a exceção do repo, não a regra.
--   * `product_label` é o agrupador digitado na tela ("Pote de Vidro"); o
--     rótulo de cada variação vive no item. A Olist NÃO tem variação
--     estruturada (olist_products é plana, 1 SKU = 1 linha), então cada
--     variação é um SKU real e `variation_label` é o texto derivado do nome
--     desse SKU. Guardamos o texto final em vez de recalcular na leitura: a
--     etiqueta impressa é um documento, precisa continuar dizendo o que dizia
--     no dia em que foi impressa mesmo que o cadastro da Olist mude depois.
--   * `olist_product_id`/`sku` são referência solta para `olist_products`, sem
--     FK: o sync marca produto sumido como `active = false` e um dia pode
--     apagar, e isso não pode invalidar um palete já expedido.
--   * Escrita SÓ via service_role (Server Actions com assertTabAccess), padrão
--     do projeto.

create table if not exists public.logistica_paletes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  product_label text not null,
  invoice_number text,
  boxes_per_pallet integer,
  label_count integer not null default 1 check (label_count between 1 and 100),
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Consulta dominante hoje: abrir o palete pelo código do QR.
create index if not exists logistica_paletes_code_idx
  on public.logistica_paletes (code);

-- Para a listagem/histórico que virá depois.
create index if not exists logistica_paletes_created_idx
  on public.logistica_paletes (created_at desc);

create table if not exists public.logistica_palete_itens (
  id bigserial primary key,
  palete_id uuid not null
    references public.logistica_paletes (id) on delete cascade,
  position smallint not null check (position between 1 and 4),
  olist_product_id text,
  sku text,
  variation_label text not null,
  quantity numeric not null check (quantity > 0),
  unique (palete_id, position)
);

create index if not exists logistica_palete_itens_palete_idx
  on public.logistica_palete_itens (palete_id, position);

alter table public.logistica_paletes enable row level security;
alter table public.logistica_palete_itens enable row level security;

revoke all on table public.logistica_paletes from public, anon, authenticated;
revoke all on table public.logistica_palete_itens from public, anon, authenticated;

grant all on table public.logistica_paletes to service_role;
grant all on table public.logistica_palete_itens to service_role;
grant usage, select on sequence public.logistica_palete_itens_id_seq to service_role;

-- Checklist do AGENTS.md (item 8): tabela lida por página precisa de grant
-- select E policy select para authenticated, senão a página degrada em
-- silêncio em vez de falhar alto.
grant select on table public.logistica_paletes to authenticated;
grant select on table public.logistica_palete_itens to authenticated;

drop policy if exists logistica_paletes_read on public.logistica_paletes;
create policy logistica_paletes_read
  on public.logistica_paletes for select to authenticated
  using (true);

drop policy if exists logistica_palete_itens_read on public.logistica_palete_itens;
create policy logistica_palete_itens_read
  on public.logistica_palete_itens for select to authenticated
  using (true);
