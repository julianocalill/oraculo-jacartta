import Link from "next/link";
import { createSupabaseUserClient } from "../../lib/supabase/user";
import { requireCurrentUser } from "../../lib/auth/session";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { SortableTable } from "../components/sortable-table";

export const dynamic = "force-dynamic";

type StockCurve = "A" | "B" | "C" | "sem_venda";
type StockCurveFilter = "all" | Exclude<StockCurve, "sem_venda">;

type StockCurveItem = {
  product_id: string;
  sku: string | null;
  product_name: string | null;
  available_stock: number | null;
  average_daily_sales: number | null;
  average_monthly_sales: number | null;
  coverage_months: number | null;
  curve: StockCurve;
};

type StockCurveSummary = {
  curve: Exclude<StockCurve, "sem_venda">;
  label: string;
  description: string;
  products: number;
  stock: number;
};

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function count(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(n(value));
}

function decimal(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

function stock(value: number | null | undefined) {
  const current = n(value);
  if (current <= 0) return "Sem estoque";
  return count(current);
}

function curveLabel(curve: StockCurve) {
  if (curve === "A") return "Curva A";
  if (curve === "B") return "Curva B";
  if (curve === "C") return "Curva C";
  return "Sem venda";
}

function curveDescription(curve: Exclude<StockCurve, "sem_venda">) {
  if (curve === "A") return "Estoque para até 3 meses";
  if (curve === "B") return "Estoque para mais de 3 e até 6 meses";
  return "Estoque para mais de 6 meses";
}

function asCurveFilter(value: string | undefined): StockCurveFilter {
  if (value === "A" || value === "B" || value === "C") return value;
  return "all";
}

function coverageLabel(value: number | null) {
  if (value == null) return "Sem venda";
  return `${decimal(value, 1)} meses`;
}

async function loadStockCurve() {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase.rpc("oraculo_stock_coverage_curve");
  if (error) throw error;
  const items = (data ?? []) as StockCurveItem[];

  const summaries: StockCurveSummary[] = (["A", "B", "C"] as Array<Exclude<StockCurve, "sem_venda">>).map((curve) => {
    const curveItems = items.filter((item) => item.curve === curve);
    return {
      curve,
      label: curveLabel(curve),
      description: curveDescription(curve),
      products: curveItems.length,
      stock: curveItems.reduce((sum, item) => sum + n(item.available_stock), 0)
    };
  });

  return {
    items: items.sort((left, right) => {
      if (left.curve !== right.curve) return curveLabel(left.curve).localeCompare(curveLabel(right.curve), "pt-BR");
      return (right.coverage_months ?? Number.POSITIVE_INFINITY) - (left.coverage_months ?? Number.POSITIVE_INFINITY);
    }),
    summaries,
    totalProducts: items.length,
    noSalesProducts: items.filter((item) => item.curve === "sem_venda").length
  };
}

export default async function CurvaDeEstoquePage({
  searchParams
}: {
  searchParams?: Promise<{ curva?: string }>;
}) {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const params = await searchParams;
  const selectedCurve = asCurveFilter(params?.curva);
  const data = await loadStockCurve();
  const visibleItems = selectedCurve === "all"
    ? data.items
    : data.items.filter((item) => item.curve === selectedCurve);
  const visibleStock = visibleItems.reduce((sum, item) => sum + n(item.available_stock), 0);
  const maxProducts = Math.max(...data.summaries.map((summary) => summary.products), 1);
  const maxStock = Math.max(...data.summaries.map((summary) => summary.stock), 1);
  const exportHref = selectedCurve === "all"
    ? "/curva-de-estoque/export"
    : `/curva-de-estoque/export?curva=${selectedCurve}`;

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Curva de Estoque</h1>
          <p>Cobertura de estoque calculada por ritmo médio de vendas</p>
        </div>
        <form className="filter-row filter-form" method="get">
          <label>
            <span>Curva</span>
            <select name="curva" defaultValue={selectedCurve}>
              <option value="all">Todas</option>
              <option value="A">Somente curva A</option>
              <option value="B">Somente curva B</option>
              <option value="C">Somente curva C</option>
            </select>
          </label>
          <button type="submit">Aplicar</button>
          <Link className="button-link" href={exportHref}>Exportar</Link>
        </form>
      </header>

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-blue">
          <span className="label">Filtro ativo</span>
          <strong>{selectedCurve === "all" ? "Todas" : `Curva ${selectedCurve}`}</strong>
          <small>{count(visibleItems.length)} produtos exibidos</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Estoque exibido</span>
          <strong>{count(visibleStock)}</strong>
          <small>Unidades disponíveis no filtro</small>
        </article>
      </section>

      <section className="metric-grid metric-grid-eight">
        {data.summaries.map((summary) => (
          <article className={`metric curve-${summary.curve.toLowerCase()}`} key={summary.curve}>
            <span className="label">{summary.label}</span>
            <strong>{count(summary.products)}</strong>
            <small>{summary.description}</small>
          </article>
        ))}
        <article className="metric accent-blue">
          <span className="label">Total analisado</span>
          <strong>{count(data.totalProducts)}</strong>
          <small>Produtos com estoque maior que zero</small>
        </article>
      </section>

      <section className="control-grid">
        <article className="panel curve-panel">
          <div className="section-head section-row">
            <div>
              <p className="eyebrow">Produtos por curva</p>
              <h2>Quantidade de produtos</h2>
            </div>
            <span className="pill">SKUs por cobertura</span>
          </div>
          <div className="horizontal-curve-chart" aria-label="Quantidade de produtos por curva de estoque">
            {data.summaries.map((summary) => {
              const width = Math.max((summary.products / maxProducts) * 100, summary.products > 0 ? 2 : 0);
              return (
                <div className={`horizontal-curve-row curve-${summary.curve.toLowerCase()}`} key={summary.curve}>
                  <div className="horizontal-curve-label">
                    <strong>{summary.label}</strong>
                    <span>{summary.description}</span>
                  </div>
                  <div className="horizontal-curve-track">
                    <i style={{ width: `${width}%` }} />
                  </div>
                  <div className="horizontal-curve-values">
                    <strong>{count(summary.products)}</strong>
                    <span>produtos</span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel curve-panel">
          <div className="section-head section-row">
            <div>
              <p className="eyebrow">Estoque por curva</p>
              <h2>Volume de estoque</h2>
            </div>
            <span className="pill">Unidades disponíveis</span>
          </div>
          <div className="horizontal-curve-chart" aria-label="Quantidade de estoque por curva">
            {data.summaries.map((summary) => {
              const width = Math.max((summary.stock / maxStock) * 100, summary.stock > 0 ? 2 : 0);
              return (
                <div className={`horizontal-curve-row curve-${summary.curve.toLowerCase()}`} key={summary.curve}>
                  <div className="horizontal-curve-label">
                    <strong>{summary.label}</strong>
                    <span>{summary.description}</span>
                  </div>
                  <div className="horizontal-curve-track">
                    <i style={{ width: `${width}%` }} />
                  </div>
                  <div className="horizontal-curve-values">
                    <strong>{count(summary.stock)}</strong>
                    <span>unidades</span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </section>

      <section className="panel product-panel">
        <div className="sku-toolbar">
          <div>
            <p className="eyebrow">Cobertura por produto</p>
            <h2>{selectedCurve === "all" ? "Produtos com estoque disponível" : `Produtos da curva ${selectedCurve}`}</h2>
          </div>
          <div className="sku-actions">
            <strong>Cobertura</strong>
            <span>Média diária</span>
            <span>Estoque</span>
          </div>
        </div>

        <SortableTable
          columns={[
            { label: "Produto" },
            { label: "Estoque Atual", numeric: true },
            { label: "Média Diária", numeric: true },
            { label: "Média Mensal", numeric: true },
            { label: "Meses de Cobertura", numeric: true },
            { label: "Curva", numeric: true }
          ]}
          initialSort={4}
          initialDir="asc"
          rows={visibleItems.map((item) => [
            {
              text: item.product_name ?? "Sem nome",
              sort: item.product_name ?? null,
              href: `/skus?source=olist&sku=${encodeURIComponent(item.sku ?? "")}`
            },
            { text: stock(item.available_stock), sort: item.available_stock ?? null },
            {
              text: n(item.average_daily_sales) <= 0 ? "Sem venda" : decimal(item.average_daily_sales, 2),
              sort: n(item.average_daily_sales) <= 0 ? null : item.average_daily_sales
            },
            {
              text: n(item.average_monthly_sales) <= 0 ? "Sem venda" : decimal(item.average_monthly_sales, 2),
              sort: n(item.average_monthly_sales) <= 0 ? null : item.average_monthly_sales
            },
            { text: coverageLabel(item.coverage_months), sort: item.coverage_months ?? null },
            item.curve === "sem_venda"
              ? { text: "Sem venda", sort: "zz_sem_venda", badge: "status-pill signal-muted" }
              : { text: item.curve, sort: item.curve, badge: `curve-badge curve-${item.curve.toLowerCase()}` }
          ])}
        />
      </section>
    </AppShell>
  );
}
