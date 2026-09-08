update public.oraculo_operations
set initial_history_days = 40
where id = 'giracasa';

comment on column public.oraculo_operations.initial_history_days is
  'Janela inicial de importação por operação, em dias. Giracasa usa 40 dias conforme decisão de 08/09/2026.';
