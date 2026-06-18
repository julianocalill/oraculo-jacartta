import Link from "next/link";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type SkuRow = {
  sku: string | null;
  product_name: string | null;
  category_name: string | null;
  brand_name: string | null;
  units_30d: number | null;
  revenue_30d: number | null;
  revenue_change_pct: number | null;
  available_stock: number | null;
  stock_balance: number | null;
  days_until_stockout: number | null;
  stock_value: number | null;
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

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

function date(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

async function loadSkus(selectedSku?: string) {
  const supabase = createSupabaseAdminClient();

  const [rowsResponse, selectedResponse] = await Promise.all([
    supabase
      .from("oraculo_sku_current")
      .select("sku, product_name, category_name, brand_name, units_30d, revenue_30d, revenue_change_pct, available_stock, stock_balance, days_until_stockout, stock_value, last_sale_at")
      .order("revenue_30d", { ascending: false })
      .limit(80),
    selectedSku
      ? supabase
          .from("oraculo_sku_current")
          .select("sku, product_name, category_name, brand_name, units_30d, revenue_30d, revenue_change_pct, available_stock, stock_balance, days_until_stockout, stock_value, last_sale_at")
          .eq("sku", selectedSku)
          .limit(1)
      : Promise.resolve({ data: [] })
  ]);

  return {
    rows: (rowsResponse.data ?? []) as SkuRow[],
    selected: ((selectedResponse.data ?? []) as SkuRow[])[0] ?? null
  };
}

export default async function SkusPage({
  searchParams
}: {
  searchParams?: Promise<{ sku?: string }>;
}) {
  const params = await searchParams;
  const selectedSku = params?.sku;
  const data = await loadSkus(selectedSku);
  const selected = data.selected ?? data.rows[0] ?? null;

  return (
    <main className="workspace single-workspace">
      <header className="topbar">
        <div>
          <Link href="/" className="back-link">← Analytics</Link>
          <h1>SKUs</h1>
          <p>{count(data.rows.length)} produtos carregados para análise</p>
        </div>
        <div className="filter-row">
          <strong>Receita ↓</strong>
          <span>30d</span>
          <span>Estoque</span>
        </div>
      </header>

      <section className="detail-grid">
        <article className="panel product-panel">
          <div className="sku-toolbar">
            <div>
              <p className="eyebrow">Produtos</p>
              <h2>Ranking operacional</h2>
            </div>
            <div className="sku-actions">
              <span>ABC</span>
              <span>XYZ</span>
              <strong>Receita</strong>
            </div>
          </div>

          <div className="table-wrap dense-table-wrap">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th className="numeric">Receita</th>
                  <th className="numeric">Un.</th>
                  <th className="numeric">Ticket</th>
                  <th className="numeric">Var.</th>
                  <th className="numeric">Estoque</th>
                  <th className="numeric">Ruptura</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => (
                  <tr key={row.sku ?? row.product_name}>
                    <td>{index + 1}</td>
                    <td>{row.sku || "-"}</td>
                    <td>
                      <Link className="row-link" href={`/skus?sku=${encodeURIComponent(row.sku ?? "")}`}>
                        {row.product_name ?? "Sem nome"}
                      </Link>
                      <div className="row-subtitle">{row.category_name ?? "Sem categoria"}</div>
                    </td>
                    <td className="numeric">{money(row.revenue_30d)}</td>
                    <td className="numeric">{count(row.units_30d)}</td>
                    <td className="numeric">{money(n(row.revenue_30d) / Math.max(n(row.units_30d), 1))}</td>
                    <td className="numeric trend-value">{percent(row.revenue_change_pct)}</td>
                    <td className="numeric">{count(row.available_stock)}</td>
                    <td className="numeric">{count(row.days_until_stockout)}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="panel sku-detail">
          <p className="eyebrow">Produto aberto</p>
          <h2>{selected?.product_name ?? "Selecione um SKU"}</h2>
          <span className="detail-code">{selected?.sku ?? "-"}</span>

          <div className="detail-metrics">
            <article>
              <span>Receita 30d</span>
              <strong>{money(selected?.revenue_30d)}</strong>
            </article>
            <article>
              <span>Unidades</span>
              <strong>{count(selected?.units_30d)}</strong>
            </article>
            <article>
              <span>Estoque</span>
              <strong>{count(selected?.available_stock)}</strong>
            </article>
            <article>
              <span>Ruptura</span>
              <strong>{count(selected?.days_until_stockout)}d</strong>
            </article>
            <article>
              <span>Valor estoque</span>
              <strong>{money(selected?.stock_value)}</strong>
            </article>
            <article>
              <span>Última venda</span>
              <strong>{date(selected?.last_sale_at)}</strong>
            </article>
          </div>
        </aside>
      </section>
    </main>
  );
}
