import Link from "next/link";
import { createSupabaseUserClient } from "../../lib/supabase/user";
import { loadFiscalSkuCoverageSnapshot } from "../../lib/fiscal-snapshots";
import { requireCurrentUser } from "../../lib/auth/session";
import { formatBrDate, getSaoPauloMonthRange } from "../../lib/date";

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

type FiscalCoverage = Awaited<ReturnType<typeof loadFiscalSkuCoverageSnapshot>>;

type FiscalSkuMargin = {
  sku: string;
  units: number;
  revenue: number;
  cost: number;
  icms: number;
  pisCofins: number;
  difal: number;
  taxesTotal: number;
  profit: number;
  marginRate: number | null;
  roi: number | null;
};

function toNum(value: number | string | null | undefined) {
  if (value == null) return 0;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNumOrNull(value: number | string | null | undefined) {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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
  return formatBrDate(value);
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

async function loadFiscalSkuMargins(
  supabase: Awaited<ReturnType<typeof createSupabaseUserClient>>,
  period: { start: string; end: string }
): Promise<Map<string, FiscalSkuMargin>> {
  // Calculada on-the-fly sobre a cadeia fiscal; pode exceder o statement_timeout
  // em meses grandes. Se falhar, devolvemos um mapa vazio (colunas mostram "-")
  // em vez de derrubar a página.
  let data: unknown = null;
  try {
    const response = await supabase.rpc("oraculo_fiscal_sku_margin", {
      p_start: period.start,
      p_end: period.end,
      p_limit: 500
    });
    if (response.error) throw response.error;
    data = response.data;
  } catch (err) {
    console.error("loadFiscalSkuMargins failed; degrading fiscal columns", err);
    return new Map<string, FiscalSkuMargin>();
  }

  const map = new Map<string, FiscalSkuMargin>();
  for (const raw of (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>) {
    const sku = raw.sku == null ? null : String(raw.sku);
    if (!sku) continue;
    map.set(sku, {
      sku,
      units: toNum(raw.units as number | string | null),
      revenue: toNum(raw.revenue as number | string | null),
      cost: toNum(raw.cost as number | string | null),
      icms: toNum(raw.icms as number | string | null),
      pisCofins: toNum(raw.pis_cofins as number | string | null),
      difal: toNum(raw.difal as number | string | null),
      taxesTotal: toNum(raw.taxes_total as number | string | null),
      profit: toNum(raw.profit as number | string | null),
      marginRate: toNumOrNull(raw.margin_rate as number | string | null),
      roi: toNumOrNull(raw.roi as number | string | null)
    });
  }
  return map;
}

async function loadSkus(selectedSku?: string, source: SourceFilter = "all") {
  const supabase = await createSupabaseUserClient();
  const fiscalPeriod = getSaoPauloMonthRange();

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

  const [rowsResponse, selectedResponse, fiscalCoverage, fiscalMargins] = await Promise.all([
    rowsQuery,
    selectedQuery,
    loadFiscalSkuCoverageSnapshot(supabase),
    loadFiscalSkuMargins(supabase, fiscalPeriod)
  ]);

  return {
    rows: (rowsResponse.data ?? []) as SkuRow[],
    selected: ((selectedResponse.data ?? []) as SkuRow[])[0] ?? null,
    fiscalCoverage,
    fiscalMargins,
    fiscalPeriod
  };
}

// A margem fiscal só é válida para linhas Olist (derivada de NF vinculada a pedido).
// Shopee compartilha SKUs no catálogo, mas não passa pela cadeia fiscal do Olist.
function fiscalFor(
  fiscalMargins: Map<string, FiscalSkuMargin>,
  row: Pick<SkuRow, "source" | "sku">
): FiscalSkuMargin | null {
  if (row.source !== "olist" || !row.sku) return null;
  return fiscalMargins.get(row.sku) ?? null;
}

export default async function SkusPage({
  searchParams
}: {
  searchParams?: Promise<{ sku?: string; source?: string }>;
}) {
  await requireCurrentUser();
  const params = await searchParams;
  const selectedSku = params?.sku;
  const source = asSource(params?.source);
  const data = await loadSkus(selectedSku, source);
  const selected = data.selected ?? data.rows[0] ?? null;
  const selectedFiscal = selected ? fiscalFor(data.fiscalMargins, selected) : null;
  const fiscalPeriodLabel = `${date(data.fiscalPeriod.start)} – ${date(data.fiscalPeriod.end)}`;

  return (
    <main className="workspace single-workspace">
      <header className="topbar">
        <div>
          <Link href="/" className="back-link">← Analytics</Link>
          <h1>SKUs</h1>
          <p>Margem operacional (30d) + margem fiscal por SKU (mês) · leitura parcial até fechar a cobertura fiscal por item</p>
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
            <h2>Margem e ROI operacionais liberados</h2>
          </div>
          <span className="pill warning-pill">Parcial, não fiscal definitivo</span>
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
              <h2>Ranking operacional com margem</h2>
            </div>
            <div className="sku-actions">
              <span>Fonte</span>
              <span>Parcial</span>
              <strong>Margem/ROI</strong>
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
                  <th className="numeric">Margem fiscal</th>
                  <th className="numeric">ROI fiscal</th>
                  <th>Status margem</th>
                  <th className="numeric">Var.</th>
                  <th className="numeric">Estoque</th>
                  <th className="numeric">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => {
                  const fiscal = fiscalFor(data.fiscalMargins, row);
                  return (
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
                    <td className="numeric">{percent(row.margin_rate_30d)}</td>
                    <td className="numeric">{percent(row.roi_30d)}</td>
                    <td className="numeric">{fiscal ? percent(fiscal.marginRate) : "-"}</td>
                    <td className="numeric">{fiscal ? percent(fiscal.roi) : "-"}</td>
                    <td>
                      <span className={`status-pill ${marginSignalClass(row.margin_signal)}`}>
                        {marginSignalLabel(row.margin_signal)}
                      </span>
                    </td>
                    <td className="numeric trend-value">{percent(row.revenue_change_pct)}</td>
                    <td className="numeric">{stock(row.available_stock)}</td>
                    <td className="numeric">{coverage(row.days_until_stockout)}</td>
                  </tr>
                );
                })}
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
              <strong>{percent(selected?.margin_rate_30d)}</strong>
            </article>
            <article>
              <span>ROI 30d</span>
              <strong>{percent(selected?.roi_30d)}</strong>
            </article>
            <article>
              <span>Lucro</span>
              <strong>{selected?.margin_amount_30d == null ? "-" : money(selected.margin_amount_30d)}</strong>
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

          <div className="fiscal-detail">
            <div className="section-head section-row">
              <p className="eyebrow">Margem fiscal · {fiscalPeriodLabel}</p>
              <span className="pill warning-pill">Parcial</span>
            </div>
            {selectedFiscal ? (
              <>
                <div className="detail-metrics">
                  <article>
                    <span>Receita fiscal</span>
                    <strong>{money(selectedFiscal.revenue)}</strong>
                  </article>
                  <article>
                    <span>Custo</span>
                    <strong>{money(selectedFiscal.cost)}</strong>
                  </article>
                  <article>
                    <span>ICMS</span>
                    <strong>{money(selectedFiscal.icms)}</strong>
                  </article>
                  <article>
                    <span>PIS/COFINS</span>
                    <strong>{money(selectedFiscal.pisCofins)}</strong>
                  </article>
                  <article>
                    <span>DIFAL</span>
                    <strong>{money(selectedFiscal.difal)}</strong>
                  </article>
                  <article>
                    <span>Impostos</span>
                    <strong>{money(selectedFiscal.taxesTotal)}</strong>
                  </article>
                  <article>
                    <span>Lucro fiscal</span>
                    <strong>{money(selectedFiscal.profit)}</strong>
                  </article>
                  <article>
                    <span>Margem fiscal</span>
                    <strong>{percent(selectedFiscal.marginRate)}</strong>
                  </article>
                  <article>
                    <span>ROI fiscal</span>
                    <strong>{percent(selectedFiscal.roi)}</strong>
                  </article>
                </div>
                <p className="fiscal-note">
                  Receita − custo − ICMS − PIS/COFINS − DIFAL (regras Jacarta, Lucro Real).
                  Não inclui comissão de marketplace, frete ou ads.
                </p>
              </>
            ) : (
              <p className="fiscal-note">
                {selected?.source === "olist"
                  ? "Sem cobertura fiscal no período: falta NF com itens vinculada ao pedido ou custo confiável para este SKU."
                  : "Margem fiscal disponível apenas para SKUs Olist (derivada da cadeia de NFs)."}
              </p>
            )}
          </div>

          <div className={`margin-callout ${marginSignalClass(selected?.margin_signal)}`}>
            <span>{marginSignalLabel(selected?.margin_signal)}</span>
            <p>
              Margem e ROI estão liberados como leitura operacional parcial. A versão fiscal definitiva continua dependendo da cobertura completa de NFs com itens e da validação final dos parâmetros.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
