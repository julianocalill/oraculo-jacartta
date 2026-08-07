-- Índice parcial covering para as views fiscais ao vivo.
--
-- oraculo_fiscal_daily_revenue (e as queries da home sobre ela) faziam
-- Parallel Seq Scan de olist_invoices inteira (543 MB, 53k páginas) a cada
-- chamada: 2,4-8s medidos em produção, e era a query que estourava o
-- statement_timeout nos incidentes de 05-06/08.
--
-- O predicado espelha oraculo_fiscal_invoices_valid. Não dá para indexar a
-- expressão (emission_date::date) — cast de timestamptz para date não é
-- IMMUTABLE — então o índice cobre a coluna crua + fiscal_amount e o planner
-- faz Index Only Scan do índice parcial (~113k entradas) aplicando o cast em
-- cima. Medido pós-VACUUM: 2.390 ms -> 60 ms, Heap Fetches: 0.
--
-- Aplicado em produção em 2026-08-07 com CREATE INDEX CONCURRENTLY (via
-- Management API). Aqui fica a forma transacional para replay do zero.
create index if not exists olist_invoices_fiscal_valid_date_idx
  on olist_invoices (emission_date) include (fiscal_amount)
  where status in ('6','7')
    and fiscal_invoice_type <> 'E'
    and fiscal_origin_type <> 'devolucao';

-- O ganho do Index Only Scan depende do visibility map limpo; a tabela tem
-- churn alto de updates (sync de 15 em 15 min), então sem isto os primeiros
-- planos continuam buscando heap (medido: 75k heap fetches = 1.478 ms).
analyze olist_invoices;
