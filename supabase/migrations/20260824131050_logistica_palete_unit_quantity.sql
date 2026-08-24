-- Etiqueta de palete: quantidade total de unidades informada livremente.
--
-- O valor é congelado no palete junto do restante do documento. NULL preserva
-- etiquetas antigas e permite que o campo continue opcional no formulário.

alter table public.logistica_paletes
  add column if not exists unit_quantity numeric
  check (unit_quantity is null or unit_quantity > 0);

comment on column public.logistica_paletes.unit_quantity is
  'Quantidade total de unidades informada manualmente e congelada na etiqueta do palete; NULL nas etiquetas antigas ou quando não preenchida.';
