-- Aba RPA → Afiliados Shopee: emissão mensal de Recibo de Pagamento a Autônomo.
--
-- Desde 01/07/2026 a Shopee opera o repasse de comissões do Programa de
-- Afiliados do Vendedor como mera intermediação: repassa o valor BRUTO, não
-- retém tributo na fonte, e a responsabilidade fiscal pelo afiliado pessoa
-- física passa a ser do vendedor, que é o tomador do serviço. O insumo é o
-- Relatório Mensal baixado à mão em Afiliados do Vendedor > Relatórios, porque
-- a API AMS segue negando permissão aos 4 partner apps
-- (docs/shopee-affiliates-integration-map.md).
--
-- Decisões de modelagem:
--   * SEM `grant select` para `authenticated` — e isso contraria de propósito o
--     item 8 do AGENTS.md. Aqui trafegam CPF, data de nascimento, endereço,
--     e-mail e telefone de centenas de pessoas físicas, que não devem sair pelo
--     PostgREST com anon key. As páginas leem via service_role depois do
--     `requireTabAccess("rpa")`, mesmo tratamento que `shopee_order_escrow`.
--     Se um dia alguém "consertar" isso adicionando o grant, estará abrindo o
--     cadastro de 772 afiliados para qualquer JWT válido.
--   * Emitente é TABELA, não singleton: as lojas do grupo são CNPJs diferentes,
--     e o tomador muda conforme a loja de onde o relatório foi baixado.
--   * Um lote por arquivo. Nada de consolidar CPF entre lojas — se o mesmo
--     afiliado vendeu para duas lojas, são dois tomadores distintos e dois
--     recibos, cada um com o CNPJ que efetivamente pagou.
--   * Todo dinheiro em CENTAVOS INTEIROS (bigint). O total da tela precisa
--     bater centavo a centavo com a soma dos PDFs; no arquivo de Jul/2026,
--     arredondar no fim em vez de por linha já dava 3 centavos de diferença.
--   * As retenções são gravadas no item, não recalculadas na leitura. O recibo
--     é um documento: precisa continuar dizendo o que dizia no dia da emissão,
--     mesmo que a tabela do IRRF mude depois. Mesma razão pela qual a etiqueta
--     de palete congela o texto impresso (20260811210000).
--   * `endereco_raw` guarda a string original mesmo quando o parse funciona.
--     O formato casou em 772/772 linhas, mas a Shopee muda sem avisar e
--     endereço errado no recibo é pior que endereço não estruturado.

-- 1. Tomador do serviço (a empresa que paga o afiliado)

create table if not exists public.oraculo_rpa_issuers (
  id uuid primary key default gen_random_uuid(),
  razao_social text not null,
  cnpj text not null unique,
  endereco text,
  municipio text,
  uf text,
  cep text,
  inscricao_municipal text,
  descricao_servico text not null
    default 'Comissão de divulgação/afiliação - Programa de Afiliados do Vendedor (Shopee)',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.oraculo_rpa_issuers is
  'Tomadores dos serviços de afiliação (uma linha por CNPJ do grupo). Reutilizado a cada emissão.';

-- 2. Lote = um arquivo de Relatório Mensal, de uma loja, de uma competência

create table if not exists public.oraculo_rpa_batches (
  id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references public.oraculo_rpa_issuers (id) on delete restrict,
  loja text not null,
  competencia date not null,
  file_name text not null,
  status text not null default 'rascunho' check (status in ('rascunho', 'aprovado')),

  -- Configuração congelada no momento do upload: quais retenções foram
  -- aplicadas, com qual alíquota de ISS, qual piso de emissão e qual vigência
  -- da tabela do IRRF. Sem isso não dá para explicar um recibo antigo.
  aplica_inss boolean not null default true,
  aplica_irrf boolean not null default true,
  aplica_iss boolean not null default false,
  iss_rate numeric not null default 0 check (iss_rate >= 0 and iss_rate <= 100),
  piso_cents bigint not null default 0 check (piso_cents >= 0),
  irrf_table_version text,

  rows_read integer not null default 0,
  rows_rejected integer not null default 0,
  errors jsonb not null default '[]'::jsonb, -- [{row, field, message}]

  total_bruto_cents bigint not null default 0,
  total_inss_cents bigint not null default 0,
  total_irrf_cents bigint not null default 0,
  total_iss_cents bigint not null default 0,
  total_liquido_cents bigint not null default 0,
  emitidos integer not null default 0,

  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  generated_at timestamptz
);

comment on table public.oraculo_rpa_batches is
  'Um upload do Relatório Mensal de Afiliados da Shopee: loja, competência, configuração de retenções e totais.';

-- Listagem da tela: lotes mais recentes primeiro.
create index if not exists oraculo_rpa_batches_competencia_idx
  on public.oraculo_rpa_batches (competencia desc, uploaded_at desc);

-- 3. Item = um afiliado dentro do lote = um RPA

create table if not exists public.oraculo_rpa_items (
  id bigserial primary key,
  batch_id uuid not null references public.oraculo_rpa_batches (id) on delete cascade,

  numero integer not null,
  recibo_numero text not null,

  affiliate_id text,
  nome text not null,
  cpf text not null,
  cpf_valido boolean not null default true,
  nascimento date,
  email text,
  telefone text,

  endereco_raw text,
  logradouro text,
  numero_endereco text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  cep text,

  bruto_cents bigint not null check (bruto_cents >= 0),
  inss_cents bigint not null default 0,
  irrf_cents bigint not null default 0,
  iss_cents bigint not null default 0,
  liquido_cents bigint not null,

  -- false = ficou abaixo do piso do lote: aparece no consolidado, fica fora do
  -- ZIP. É informação, não descarte.
  emitido boolean not null default true,

  unique (batch_id, cpf),
  unique (batch_id, numero)
);

comment on table public.oraculo_rpa_items is
  'Um afiliado dentro de um lote, com as retenções já calculadas e congeladas. Cada linha vira um PDF de RPA.';

create index if not exists oraculo_rpa_items_batch_idx
  on public.oraculo_rpa_items (batch_id, numero);

-- 4. Permissões — service_role only, por conterem dado pessoal (ver cabeçalho)

alter table public.oraculo_rpa_issuers enable row level security;
alter table public.oraculo_rpa_batches enable row level security;
alter table public.oraculo_rpa_items enable row level security;

revoke all on table public.oraculo_rpa_issuers from public, anon, authenticated;
revoke all on table public.oraculo_rpa_batches from public, anon, authenticated;
revoke all on table public.oraculo_rpa_items from public, anon, authenticated;

grant all on table public.oraculo_rpa_issuers to service_role;
grant all on table public.oraculo_rpa_batches to service_role;
grant all on table public.oraculo_rpa_items to service_role;
grant usage, select on sequence public.oraculo_rpa_items_id_seq to service_role;
