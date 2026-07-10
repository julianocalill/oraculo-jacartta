import { createSupabaseUserClient } from "../../lib/supabase/user";
import { requireCurrentUser } from "../../lib/auth/session";
import { AppShell } from "../components/app-shell";
import { SortableTable } from "../components/sortable-table";

export const dynamic = "force-dynamic";

type StockSignal = {
  source: string | null;
  sku: string | null;
  product_name: string | null;
  status_label: string | null;
  stock_signal: string | null;
  available_stock: number | null;
  stock_balance: number | null;
  units_30d: number | null;
  revenue_30d: number | null;
  days_until_stockout: number | null;
  last_sale_at: string | null;
};

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sourceLabel(value: string | null | undefined) {
  if (value === "shopee") return "Shopee";
  if (value === "olist") return "Olist";
  return "Outros";
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(n(value));
}

function count(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(n(value));
}

function stock(value: number | null | undefined) {
  const current = n(value);
  if (current <= 0) return "Sem estoque";
  return count(current);
}

function coverage(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value <= 0) return "Sem estoque";
  if (value > 999) return "999d+";
  return `${Math.round(value)}d`;
}

function label(signal: string | null | undefined) {
  const labels: Record<string, string> = {
    ruptura: "Ruptura",
    ruptura_iminente: "Ruptura iminente",
    sem_venda: "Sem venda",
    parado: "Parado"
  };

  return labels[signal ?? ""] ?? "Atenção";
}

async function loadAlertas() {
  const supabase = await createSupabaseUserClient();

  const response = await supabase
    .from("oraculo_stock_watchlist_unified")
    .select("source, sku, product_name, status_label, stock_signal, available_stock, stock_balance, units_30d, revenue_30d, days_until_stockout, last_sale_at")
    .not("sku", "is", null)
    .neq("sku", "")
    .order("days_until_stockout", { ascending: true, nullsFirst: false })
    .limit(120);

  const rows = (response.data ?? []) as StockSignal[];

  return {
    rows,
    rupture: rows.filter((row) => row.stock_signal === "ruptura").length,
    imminent: rows.filter((row) => row.stock_signal === "ruptura_iminente").length,
    stopped: rows.filter((row) => row.stock_signal === "parado" || row.stock_signal === "sem_venda").length
  };
}

export default async function AlertasPage() {
  await requireCurrentUser();
  const data = await loadAlertas();

  return (
    <AppShell>
      <header className="topbar">
        <div>
          <h1>Alertas</h1>
          <p>{count(data.rows.length)} produtos exigem atenção operacional</p>
        </div>
        <div className="filter-row">
          <strong>Ruptura</strong>
          <span>Estoque</span>
          <span>Sem giro</span>
        </div>
      </header>

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-red">
          <span className="label">Ruptura</span>
          <strong>{count(data.rupture)}</strong>
          <small>Estoque disponível zerado</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Ruptura iminente</span>
          <strong>{count(data.imminent)}</strong>
          <small>Risco nos próximos dias</small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Parados / sem venda</span>
          <strong>{count(data.stopped)}</strong>
          <small>Produtos sem giro recente</small>
        </article>
      </section>

      <section className="panel product-panel">
        <div className="sku-toolbar">
          <div>
            <p className="eyebrow">Watchlist</p>
            <h2>Prioridade de ação</h2>
          </div>
          <div className="sku-actions">
            <strong>Mais urgente</strong>
            <span>SKU</span>
            <span>Receita</span>
          </div>
        </div>

        <SortableTable
          columns={[
            { label: "Alerta" },
            { label: "Fonte" },
            { label: "SKU" },
            { label: "Produto" },
            { label: "Disponível", numeric: true },
            { label: "Cobertura", numeric: true },
            { label: "Un. 30d", numeric: true },
            { label: "Receita 30d", numeric: true }
          ]}
          initialSort={5}
          initialDir="asc"
          rows={data.rows.map((row) => [
            { text: label(row.stock_signal), sort: label(row.stock_signal), badge: `badge ${row.stock_signal ?? "atencao"}` },
            { text: sourceLabel(row.source), sort: sourceLabel(row.source) },
            { text: row.sku || "-", sort: row.sku ?? null },
            {
              text: row.product_name ?? "Sem nome",
              sort: row.product_name ?? null,
              href: `/skus?source=${encodeURIComponent(row.source ?? "all")}&sku=${encodeURIComponent(row.sku ?? "")}`,
              subtitle: row.status_label ?? "Sem status"
            },
            { text: stock(row.available_stock), sort: row.available_stock ?? null },
            { text: coverage(row.days_until_stockout), sort: row.days_until_stockout ?? null },
            { text: count(row.units_30d), sort: row.units_30d ?? null },
            { text: money(row.revenue_30d), sort: row.revenue_30d ?? null }
          ])}
        />
      </section>
    </AppShell>
  );
}
