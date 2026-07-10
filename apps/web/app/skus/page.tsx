import { createSupabaseUserClient } from "../../lib/supabase/user";
import {
  loadFiscalSkuCoverageSnapshot,
  loadFiscalSkuMarginSnapshot,
  type FiscalSkuMarginRow
} from "../../lib/fiscal-snapshots";
import { requireCurrentUser } from "../../lib/auth/session";
import { formatBrDate, getSaoPauloMonthRange } from "../../lib/date";
import { SkuTable, type SkuTableRow } from "./sku-table";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";

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

type FiscalSkuMargin = FiscalSkuMarginRow;

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

// A margem fiscal vem de um snapshot pré-computado (refresh noturno via pg_cron),
// não do cálculo on-the-fly, que era pesado demais e estourava o statement_timeout.
async function loadFiscalSkuMargins(
  supabase: Awaited<ReturnType<typeof createSupabaseUserClient>>
): Promise<{ margins: Map<string, FiscalSkuMargin>; period: { start: string; end: string } }> {
  const fallback = getSaoPauloMonthRange();
  try {
    const snapshot = await loadFiscalSkuMarginSnapshot(supabase);
    const margins = new Map<string, FiscalSkuMargin>();
    for (const row of snapshot.rows) {
      margins.set(row.sku, row);
    }
    return {
      margins,
      period: {
        start: snapshot.periodStart ?? fallback.start,
        end: snapshot.periodEnd ?? fallback.end
      }
    };
  } catch (err) {
    console.error("loadFiscalSkuMargins snapshot failed; degrading fiscal columns", err);
    return { margins: new Map<string, FiscalSkuMargin>(), period: fallback };
  }
}

async function loadSkus(selectedSku?: string, source: SourceFilter = "all") {
  const supabase = await createSupabaseUserClient();

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

  const [rowsResponse, selectedResponse, fiscalCoverage, fiscal] = await Promise.all([
    rowsQuery,
    selectedQuery,
    loadFiscalSkuCoverageSnapshot(supabase),
    loadFiscalSkuMargins(supabase)
  ]);

  return {
    rows: (rowsResponse.data ?? []) as SkuRow[],
    selected: ((selectedResponse.data ?? []) as SkuRow[])[0] ?? null,
    fiscalCoverage,
    fiscalMargins: fiscal.margins,
    fiscalPeriod: fiscal.period
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
  const alertCount = await loadActionableAlertCount();
  const params = await searchParams;
  const selectedSku = params?.sku;
  const source = asSource(params?.source);
  const data = await loadSkus(selectedSku, source);
  const selected = data.selected ?? data.rows[0] ?? null;
  const selectedFiscal = selected ? fiscalFor(data.fiscalMargins, selected) : null;
  const fiscalPeriodLabel = `${date(data.fiscalPeriod.start)} – ${date(data.fiscalPeriod.end)}`;

  const tableRows: SkuTableRow[] = data.rows.map((row) => {
    const fiscal = fiscalFor(data.fiscalMargins, row);
    return {
      source: row.source,
      sku: row.sku,
      product_name: row.product_name,
      status_label: row.status_label,
      units_30d: row.units_30d,
      revenue_30d: row.revenue_30d,
      revenue_change_pct: row.revenue_change_pct,
      available_stock: row.available_stock,
      days_until_stockout: row.days_until_stockout,
      margin_rate_30d: row.margin_rate_30d,
      roi_30d: row.roi_30d,
      margin_signal: row.margin_signal,
      fiscalMarginRate: fiscal?.marginRate ?? null,
      fiscalRoi: fiscal?.roi ?? null
    };
  });

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
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

          <SkuTable rows={tableRows} source={source} />
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
    </AppShell>
  );
}
