import Link from "next/link";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type SourceFilter = "all" | "olist" | "shopee";

type SkuRow = {
  source: string | null;
  sku: string | null;
  product_name: string | null;
  status_label: string | null;
  units_30d: number | null;
  revenue_30d: number | null;
  revenue_change_pct: number | null;
  available_stock: number | null;
  stock_balance: number | null;
  days_until_stockout: number | null;
  last_sale_at: string | null;
  unit_cost: number | null;
  product_cost_30d: number | null;
  margin_amount_30d: number | null;
  margin_rate_30d: number | null;
  roi_30d: number | null;
  margin_signal: string | null;
  params_configured: boolean | null;
};

type FiscalCoverage = {
  invoicesWithOrderItems: number;
  revenueWithOrderItems: number;
  revenueWithoutOrderItems: number;
  orderItemsInvoicePct: number;
  orderItemsRevenuePct: number;
  missingOrderItemsRevenuePct: number;
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
  if (value == null || !Number.isFinite(value)) return "-";
  const current = n(value);
  if (current <= 0) return "Sem estoque";
  return count(current);
}

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1
  }).format(value);
}

function marginSignalLabel(value: string | null | undefined) {
  if (value === "saudavel") return "Saudável";
  if (value === "atencao") return "Atenção";
  if (value === "critico") return "Crítico";
  if (value === "sem_custo") return "Sem custo";
  if (value === "configurar_parametros") return "Configurar";
  if (value === "sem_venda") return "Sem venda";
  return "Pendente";
}

function marginSignalClass(value: string | null | undefined) {
  if (value === "saudavel") return "signal-good";
  if (value === "atencao") return "signal-warning";
  if (value === "critico") return "signal-danger";
  return "signal-muted";
}

function date(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function coverage(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value <= 0) return "Sem estoque";
  if (value > 999) return "999d+";
  return `${Math.round(value)}d`;
}

function sourceLabel(value: string | null | undefined) {
  if (value === "shopee") return "Shopee";
  if (value === "olist") return "Olist";
  return "Outros";
}

function asSource(value: string | undefined): SourceFilter {
  if (value === "olist" || value === "shopee") return value;
  return "all";
}

function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function loadFiscalCoverage(supabase: ReturnType<typeof createSupabaseAdminClient>): Promise<FiscalCoverage> {
  const { data, error } = await supabase.rpc("oraculo_fiscal_order_item_backfill_progress", {
    p_start_date: "2026-06-01",
    p_end_date: "2026-06-19"
  });

  if (error) throw error;

  const payload = (data ?? {}) as {
    metrics?: Record<string, unknown>;
    coverage?: Record<string, unknown>;
  };
  const metrics = payload.metrics ?? {};
  const coverageRow = payload.coverage ?? {};

  return {
    invoicesWithOrderItems: parseNumber(metrics.invoices_with_order_items),
    revenueWithOrderItems: parseNumber(metrics.revenue_with_order_items),
    revenueWithoutOrderItems: parseNumber(metrics.revenue_without_order_items),
    orderItemsInvoicePct: parseNumber(coverageRow.order_items_invoice_pct),
    orderItemsRevenuePct: parseNumber(coverageRow.order_items_revenue_pct),
    missingOrderItemsRevenuePct: parseNumber(coverageRow.missing_order_items_revenue_pct)
  };
}

async function loadSkus(selectedSku?: string, source: SourceFilter = "all") {
  const supabase = createSupabaseAdminClient();

  let rowsQuery = supabase
    .from("oraculo_sku_margin_30d")
    .select("source, sku, product_name, status_label, units_30d, revenue_30d, revenue_change_pct, available_stock, stock_balance, days_until_stockout, last_sale_at, unit_cost, product_cost_30d, margin_amount_30d, margin_rate_30d, roi_30d, margin_signal, params_configured")
    .order("revenue_30d", { ascending: false })
    .limit(120);

  if (source !== "all") {
    rowsQuery = rowsQuery.eq("source", source);
  }

  const selectedQuery = (() => {
    if (!selectedSku) return Promise.resolve({ data: [] as SkuRow[] });

    let query = supabase
      .from("oraculo_sku_margin_30d")
      .select("source, sku, product_name, status_label, units_30d, revenue_30d, revenue_change_pct, available_stock, stock_balance, days_until_stockout, last_sale_at, unit_cost, product_cost_30d, margin_amount_30d, margin_rate_30d, roi_30d, margin_signal, params_configured")
      .eq("sku", selectedSku)
      .limit(1);

    if (source !== "all") {
      query = query.eq("source", source);
    }

    return query;
  })();

  const [rowsResponse, selectedResponse, fiscalCoverage] = await Promise.all([
    rowsQuery,
    selectedQuery,
    loadFiscalCoverage(supabase)
  ]);

  return {
    rows: (rowsResponse.data ?? []) as SkuRow[],
    selected: ((selectedResponse.data ?? []) as SkuRow[])[0] ?? null,
    fiscalCoverage
  };
}

export default async function SkusPage({
  searchParams
}: {
  searchParams?: Promise<{ sku?: string; source?: string }>;
}) {
  const params = await searchParams;
  const selectedSku = params?.sku;
  const source = asSource(params?.source);
  const data = await loadSkus(selectedSku, source);
  const selected = data.selected ?? data.rows[0] ?? null;

  return (
    <main className="workspace single-workspace">
      <header className="topbar">
        <div>
          <Link href="/" className="back-link">← Analytics</Link>
          <h1>SKUs</h1>
          <p>Dados parciais em processamento · não usar como ranking definitivo</p>
        </div>
        <form className="filter-row filter-form" method="get">
          <label>
            <span>Fonte</span>
            <select name="source" defaultValue={source}>
              <option value="all">Todas</option>
              <option value="olist">Olist</option>
              <option value="shopee">Shopee</option>
            </select>
          </label>
          <button type="submit">Aplicar</button>
        </form>
      </header>

      <section className="panel coverage-panel warning-panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Cobertura fiscal</p>
            <h2>Dados parciais em processamento</h2>
          </div>
          <span className="pill danger-pill">Margem, ROI e ROAS bloqueados</span>
        </div>
        <div className="coverage-grid">
          <article>
            <span>NFs com pedido + itens</span>
            <strong>{count(data.fiscalCoverage.invoicesWithOrderItems)}</strong>
            <small>{data.fiscalCoverage.orderItemsInvoicePct.toFixed(1).replace(".", ",")}% das NFs válidas</small>
          </article>
          <article>
            <span>Receita coberta</span>
            <strong>{money(data.fiscalCoverage.revenueWithOrderItems)}</strong>
            <small>{data.fiscalCoverage.orderItemsRevenuePct.toFixed(1).replace(".", ",")}% da receita fiscal</small>
          </article>
          <article>
            <span>Receita sem cobertura</span>
            <strong>{money(data.fiscalCoverage.revenueWithoutOrderItems)}</strong>
            <small>{data.fiscalCoverage.missingOrderItemsRevenuePct.toFixed(1).replace(".", ",")}% ainda em backfill</small>
          </article>
          <article>
            <span>Produtos carregados</span>
            <strong>{count(data.rows.length)}</strong>
            <small>Amostra coberta, não definitiva</small>
          </article>
        </div>
      </section>

      <section className="detail-grid">
        <article className="panel product-panel">
          <div className="sku-toolbar">
            <div>
              <p className="eyebrow">Produtos</p>
              <h2>Ranking parcial coberto</h2>
            </div>
            <div className="sku-actions">
              <span>Fonte</span>
              <span>Parcial</span>
              <strong>Receita coberta</strong>
            </div>
          </div>

          <div className="table-wrap dense-table-wrap">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Fonte</th>
                  <th>SKU</th>
                  <th>Produto</th>
                  <th>Status</th>
                  <th className="numeric">Receita</th>
                  <th className="numeric">Un.</th>
                  <th className="numeric">Ticket</th>
                  <th className="numeric">Margem</th>
                  <th className="numeric">ROI</th>
                  <th>Status margem</th>
                  <th className="numeric">Var.</th>
                  <th className="numeric">Estoque</th>
                  <th className="numeric">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => (
                  <tr key={`${row.source}-${row.sku ?? row.product_name}`}>
                    <td>{index + 1}</td>
                    <td>{sourceLabel(row.source)}</td>
                    <td>{row.sku || "-"}</td>
                    <td>
                      <Link
                        className="row-link"
                        href={`/skus?source=${encodeURIComponent(source)}&sku=${encodeURIComponent(row.sku ?? "")}`}
                      >
                        {row.product_name ?? "Sem nome"}
                      </Link>
                    </td>
                    <td>{row.status_label ?? "-"}</td>
                    <td className="numeric">{money(row.revenue_30d)}</td>
                    <td className="numeric">{count(row.units_30d)}</td>
                    <td className="numeric">{money(n(row.revenue_30d) / Math.max(n(row.units_30d), 1))}</td>
                    <td className="numeric">Bloqueado</td>
                    <td className="numeric">Bloqueado</td>
                    <td>
                      <span className={`status-pill ${marginSignalClass(row.margin_signal)}`}>
                        Em processamento
                      </span>
                    </td>
                    <td className="numeric trend-value">{percent(row.revenue_change_pct)}</td>
                    <td className="numeric">{stock(row.available_stock)}</td>
                    <td className="numeric">{coverage(row.days_until_stockout)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="panel sku-detail">
          <p className="eyebrow">Produto aberto</p>
          <h2>{selected?.product_name ?? "Selecione um SKU"}</h2>
          <span className="detail-code">{sourceLabel(selected?.source)} · {selected?.sku ?? "-"}</span>

          <div className="detail-metrics">
            <article>
              <span>Receita coberta</span>
              <strong>{money(selected?.revenue_30d)}</strong>
            </article>
            <article>
              <span>Unidades</span>
              <strong>{count(selected?.units_30d)}</strong>
            </article>
            <article>
              <span>Margem 30d</span>
              <strong>Bloqueado</strong>
            </article>
            <article>
              <span>ROI 30d</span>
              <strong>Bloqueado</strong>
            </article>
            <article>
              <span>Lucro</span>
              <strong>Bloqueado</strong>
            </article>
            <article>
              <span>Custo unit.</span>
              <strong>{selected?.unit_cost == null ? "-" : money(selected.unit_cost)}</strong>
            </article>
            <article>
              <span>Estoque</span>
              <strong>{stock(selected?.available_stock)}</strong>
            </article>
            <article>
              <span>Cobertura</span>
              <strong>{coverage(selected?.days_until_stockout)}</strong>
            </article>
            <article>
              <span>Saldo</span>
              <strong>{selected?.stock_balance == null ? "-" : count(selected?.stock_balance)}</strong>
            </article>
            <article>
              <span>Última venda</span>
              <strong>{date(selected?.last_sale_at)}</strong>
            </article>
          </div>

          <div className={`margin-callout ${marginSignalClass(selected?.margin_signal)}`}>
            <span>SKU fiscal em processamento</span>
            <p>
              Estes dados usam somente NFs que já possuem pedido e itens vinculados. Margem, ROI e ROAS permanecem bloqueados até a cobertura fiscal atingir o critério de qualidade.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
