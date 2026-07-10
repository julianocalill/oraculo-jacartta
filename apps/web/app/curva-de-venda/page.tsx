import Link from "next/link";
import { createSupabaseUserClient } from "../../lib/supabase/user";
import { requireCurrentUser } from "../../lib/auth/session";
import { formatBrDate } from "../../lib/date";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { SortableTable } from "../components/sortable-table";

export const dynamic = "force-dynamic";

type Curve = "A" | "B" | "C";
type CurveFilter = "all" | Curve;

type CurveItem = {
  product_id: string;
  source: string | null;
  sku: string | null;
  product_name: string | null;
  available_stock: number | null;
  curve: Curve;
  days_without_sale: number | null;
  last_sale_at: string | null;
};

type CurveSummary = {
  curve: Curve;
  label: string;
  description: string;
  items: number;
};

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function count(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(n(value));
}

function stock(value: number | null | undefined) {
  const current = n(value);
  if (current <= 0) return "Sem estoque";
  return count(current);
}

function date(value: string | null | undefined) {
  return formatBrDate(value);
}

function curveLabel(curve: Curve) {
  if (curve === "A") return "Curva A";
  if (curve === "B") return "Curva B";
  return "Curva C";
}

function curveDescription(curve: Curve) {
  if (curve === "A") return "Até 3 meses sem saída";
  if (curve === "B") return "De 3 a 6 meses sem saída";
  return "Mais de 6 meses sem saída";
}

function asCurveFilter(value: string | undefined): CurveFilter {
  if (value === "A" || value === "B" || value === "C") return value;
  return "all";
}

async function loadSalesCurve() {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase.rpc("oraculo_sales_curve");
  if (error) throw error;
  const items = (data ?? []) as CurveItem[];

  const summaries: CurveSummary[] = (["A", "B", "C"] as Curve[]).map((curve) => {
    const curveItems = items.filter((item) => item.curve === curve);
    return {
      curve,
      label: curveLabel(curve),
      description: curveDescription(curve),
      items: curveItems.length
    };
  });

  return {
    items: items.sort((left, right) => {
      if (left.curve !== right.curve) return left.curve.localeCompare(right.curve);
      return String(left.product_name ?? "").localeCompare(String(right.product_name ?? ""), "pt-BR");
    }),
    summaries,
    totalItems: items.length,
    totalStock: items.reduce((sum, item) => sum + n(item.available_stock), 0)
  };
}

export default async function CurvaDeVendaPage({
  searchParams
}: {
  searchParams?: Promise<{ curva?: string }>;
}) {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const params = await searchParams;
  const selectedCurve = asCurveFilter(params?.curva);
  const data = await loadSalesCurve();
  const visibleItems = selectedCurve === "all"
    ? data.items
    : data.items.filter((item) => item.curve === selectedCurve);
  const visibleStock = visibleItems.reduce((sum, item) => sum + n(item.available_stock), 0);
  const maxItems = Math.max(...data.summaries.map((summary) => summary.items), 1);
  const exportHref = selectedCurve === "all"
    ? "/curva-de-venda/export"
    : `/curva-de-venda/export?curva=${selectedCurve}`;

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Curva de Venda</h1>
          <p>Classificação ABC de estoque por tempo desde a última saída</p>
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
          <article className={`metric curve-metric curve-${summary.curve.toLowerCase()}`} key={summary.curve}>
            <span className="label">{summary.label}</span>
            <strong>{count(summary.items)}</strong>
            <small>{summary.description}</small>
          </article>
        ))}
      </section>

      <section className="panel curve-panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Estoque por curva</p>
            <h2>Linhas horizontais A, B e C</h2>
          </div>
          <span className="pill">Quantidade de produtos por curva</span>
        </div>

        <div className="horizontal-curve-chart" aria-label="Quantidade de produtos em estoque por curva de venda">
          {data.summaries.map((summary) => {
            const width = Math.max((summary.items / maxItems) * 100, summary.items > 0 ? 2 : 0);
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
                  <strong>{count(summary.items)} produtos</strong>
                  <span>{summary.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel product-panel">
        <div className="sku-toolbar">
          <div>
            <p className="eyebrow">Itens do estoque</p>
            <h2>{selectedCurve === "all" ? "Todos os SKUs classificados" : `SKUs da curva ${selectedCurve}`}</h2>
          </div>
          <div className="sku-actions">
            <strong>Curva ABC</strong>
            <span>Última saída</span>
            <span>Estoque</span>
          </div>
        </div>

        <SortableTable
          columns={[
            { label: "Nome do produto" },
            { label: "Data da última venda", numeric: true },
            { label: "Quantidade em estoque", numeric: true },
            { label: "Curva de venda", numeric: true }
          ]}
          initialSort={3}
          initialDir="asc"
          rows={visibleItems.map((item) => [
            {
              text: item.product_name ?? "Sem nome",
              sort: item.product_name ?? null,
              href: `/skus?source=${encodeURIComponent(item.source ?? "all")}&sku=${encodeURIComponent(item.sku ?? "")}`
            },
            {
              text: date(item.last_sale_at),
              sort: item.last_sale_at ? Date.parse(item.last_sale_at) : null
            },
            { text: stock(item.available_stock), sort: item.available_stock ?? null },
            { text: item.curve, sort: item.curve, badge: `curve-badge curve-${item.curve.toLowerCase()}` }
          ])}
        />
      </section>
    </AppShell>
  );
}
