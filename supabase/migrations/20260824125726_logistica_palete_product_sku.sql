-- Etiqueta de palete: SKU físico digitado livremente e congelado no documento.
--
-- O campo fica no cabeçalho do palete (e não nos itens de variação) porque a
-- operação pediu um único SKU ao lado esquerdo do nome do produto. Ele não tem
-- FK nem validação contra a Olist: o cadastro do ERP continua inadequado como
-- vocabulário da doca. NULL preserva a reimpressão das etiquetas antigas.

alter table public.logistica_paletes
  add column if not exists product_sku text;

comment on column public.logistica_paletes.product_sku is
  'SKU físico digitado livremente e congelado na etiqueta do palete. Não é validado nem vinculado ao catálogo Olist; NULL identifica etiquetas antigas.';
