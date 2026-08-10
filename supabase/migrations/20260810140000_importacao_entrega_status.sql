-- Status de entrega das faturas de importação.
--
-- PROBLEMA (2026-08-10): o mapa plotava todo navio com fatura, para sempre.
-- Um contêiner entregue em Navegantes em 23/07 continuava seguindo o navio,
-- que a essa altura já está em outra viagem do outro lado do mundo — a
-- posição deixa de representar a carga no instante do desembarque. Sem
-- conceito de entrega, o mapa mostra "localização errada" mesmo com o AIS
-- funcionando perfeitamente.
--
-- Modelo: `port_arrival` é PREVISÃO digitada no follow-up, não fato. Por isso
-- o status tem três estados em vez de um booleano:
--   * 'auto'       (padrão) — segue a data prevista: entregue quando ela passa;
--   * 'entregue'   — confirmado manualmente, independente da data;
--   * 'em_transito'— forçado em trânsito, para quando o navio atrasa e a data
--                    prevista já passou sem o contêiner ter chegado.

alter table public.importacao_faturas
  add column if not exists delivery_status text not null default 'auto'
    check (delivery_status in ('auto', 'entregue', 'em_transito'));

alter table public.importacao_faturas
  add column if not exists delivered_at timestamptz;

-- Regra única de "está entregue?", consumida pelo app e pela Edge Function de
-- AIS (que só deve rastrear navio com carga a bordo). Fica em função para não
-- existirem duas cópias da regra divergindo com o tempo.
create or replace function public.importacao_fatura_entregue(
  p_delivery_status text,
  p_port_arrival date
)
returns boolean
language sql stable
as $$
  select case
    when p_delivery_status = 'entregue' then true
    when p_delivery_status = 'em_transito' then false
    else p_port_arrival is not null and p_port_arrival < current_date
  end;
$$;

comment on function public.importacao_fatura_entregue(text, date) is
  'Regra de entrega da fatura de importação: manual vence a data prevista.';

create or replace view public.importacao_faturas_status as
select
  f.*,
  public.importacao_fatura_entregue(f.delivery_status, f.port_arrival) as entregue
from public.importacao_faturas f;

-- Padrão do projeto: view de leitura é security definer (invoker = false) com
-- grant para authenticated; sem isso a página degrada em silêncio.
alter view public.importacao_faturas_status set (security_invoker = false);
grant select on public.importacao_faturas_status to authenticated;

-- A função é `stable` (não immutable) porque depende de current_date: o mesmo
-- argumento muda de resposta na virada do dia. Consequência: não serve para
-- índice nem generated column — e não precisa, só é usada em projeção.
