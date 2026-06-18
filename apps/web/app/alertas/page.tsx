import Link from "next/link";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type StockSignal = {
  sku: string | null;
  product_name: string | null;
  category_name: string | null;
  brand_name: string | null;
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
  const supabase = createSupabaseAdminClient();

  const response = await supabase
    .from("oraculo_stock_watchlist")
    .select("sku, product_name, category_name, brand_name, stock_signal, available_stock, stock_balance, units_30d, revenue_30d, days_until_stockout, last_sale_at")
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
  const data = await loadAlertas();

  return (
    <main className="workspace single-workspace">
      <header className="topbar">
        <div>
          <Link href="/" className="back-link">← Analytics</Link>
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

        <div className="table-wrap dense-table-wrap">
          <table className="data-table dense-table">
            <thead>
              <tr>
                <th>Alerta</th>
                <th>SKU</th>
                <th>Produto</th>
                <th className="numeric">Disponível</th>
                <th className="numeric">Cobertura</th>
                <th className="numeric">Un. 30d</th>
                <th className="numeric">Receita 30d</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={`${row.sku}-${row.product_name}`}>
                  <td>
                    <span className={`badge ${row.stock_signal ?? "atencao"}`}>
                      {label(row.stock_signal)}
                    </span>
                  </td>
                  <td>{row.sku || "-"}</td>
                  <td>
                    <Link className="row-link" href={`/skus?sku=${encodeURIComponent(row.sku ?? "")}`}>
                      {row.product_name ?? "Sem nome"}
                    </Link>
                    <div className="row-subtitle">{row.category_name ?? "Sem categoria"}</div>
                  </td>
                  <td className="numeric">{stock(row.available_stock)}</td>
                  <td className="numeric">{coverage(row.days_until_stockout)}</td>
                  <td className="numeric">{count(row.units_30d)}</td>
                  <td className="numeric">{money(row.revenue_30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
