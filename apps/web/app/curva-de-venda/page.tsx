import Link from "next/link";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type Curve = "A" | "B" | "C";
type CurveFilter = "all" | Curve;

type ProductRow = {
  id: string;
  source: string | null;
  sku: string | null;
  product_name: string | null;
  available_stock: number | null;
};

type CurveItem = ProductRow & {
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
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function daysSince(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(Math.floor((Date.now() - parsed.getTime()) / 86_400_000), 0);
}

function curveForDays(days: number | null): Curve {
  if (days == null) return "C";
  if (days <= 90) return "A";
  if (days <= 180) return "B";
  return "C";
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

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchAllSimpleStockProducts() {
  const supabase = createSupabaseAdminClient();
  const pageSize = 1000;
  const rows: ProductRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("olist_products")
      .select("id, sku, nome, disponivel")
      .gt("disponivel", 0)
      .or("tipo.is.null,tipo.neq.K")
      .order("nome", { ascending: true, nullsFirst: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const page = (data ?? []) as Array<{
      id: string;
      sku: string | null;
      nome: string | null;
      disponivel: number | null;
    }>;
    rows.push(...page.map((row) => ({
      id: row.id,
      source: "olist",
      sku: row.sku,
      product_name: row.nome,
      available_stock: row.disponivel
    })));

    if (page.length < pageSize) break;
  }

  return rows;
}

async function fetchLastSalesByProduct(productIds: string[]) {
  const supabase = createSupabaseAdminClient();
  const lastSales = new Map<string, string>();
  const pageSize = 1000;

  for (const productChunk of chunk(productIds, 200)) {
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("olist_order_items")
        .select("produto_id, order_data_criacao")
        .in("produto_id", productChunk)
        .not("order_data_criacao", "is", null)
        .order("order_data_criacao", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const page = (data ?? []) as Array<{
        produto_id: string | null;
        order_data_criacao: string | null;
      }>;

      for (const row of page) {
        if (!row.produto_id || !row.order_data_criacao || lastSales.has(row.produto_id)) continue;
        lastSales.set(row.produto_id, row.order_data_criacao);
      }

      if (productChunk.every((productId) => lastSales.has(productId)) || page.length < pageSize) break;
    }
  }

  return lastSales;
}

async function loadSalesCurve() {
  const products = await fetchAllSimpleStockProducts();
  const lastSalesByProduct = await fetchLastSalesByProduct(products.map((product) => product.id));
  const items: CurveItem[] = products.map((product) => {
    const lastSale = lastSalesByProduct.get(product.id) ?? null;
    const days = daysSince(lastSale);
    return {
      ...product,
      last_sale_at: lastSale,
      days_without_sale: days,
      curve: curveForDays(days)
    };
  });

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
    <main className="workspace single-workspace">
      <header className="topbar">
        <div>
          <Link href="/" className="back-link">← Analytics</Link>
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

        <div className="table-wrap dense-table-wrap">
          <table className="data-table dense-table">
            <thead>
              <tr>
                <th>Nome do produto</th>
                <th className="numeric">Data da última venda</th>
                <th className="numeric">Quantidade em estoque</th>
                <th className="numeric">Curva de venda</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <p className="empty-state table-empty">Nenhum item com estoque disponível encontrado.</p>
                  </td>
                </tr>
              ) : (
                visibleItems.map((item) => (
                  <tr key={`${item.source}-${item.sku ?? item.product_name}`}>
                    <td>
                      <Link className="row-link" href={`/skus?source=${encodeURIComponent(item.source ?? "all")}&sku=${encodeURIComponent(item.sku ?? "")}`}>
                        {item.product_name ?? "Sem nome"}
                      </Link>
                    </td>
                    <td className="numeric">{date(item.last_sale_at)}</td>
                    <td className="numeric">{stock(item.available_stock)}</td>
                    <td className="numeric">
                      <span className={`curve-badge curve-${item.curve.toLowerCase()}`}>{item.curve}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
