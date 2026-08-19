import Link from "next/link";
import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { requireTabAccess } from "../../lib/auth/access";
import { NoAccess } from "../components/no-access";
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
  // Só no modo período (ABC por volume vendido).
  units_sold?: number | null;
  share_pct?: number | null;
  cum_share_pct?: number | null;
};

type CurveSummary = {
  curve: Curve;
  label: string;
  description: string;
  items: number;
  units: number;
};

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function count(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(n(value));
}

function pct(value: number | null | undefined) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(n(value))}%`;
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

function curveDescription(curve: Curve, byVolume: boolean) {
  if (byVolume) {
    if (curve === "A") return "Até 80% das unidades vendidas";
    if (curve === "B") return "Dos 80% aos 95% das unidades";
    return "Últimos 5% e itens sem venda";
  }
  if (curve === "A") return "Até 3 meses sem saída";
  if (curve === "B") return "De 3 a 6 meses sem saída";
  return "Mais de 6 meses sem saída";
}

function asCurveFilter(value: string | undefined): CurveFilter {
  if (value === "A" || value === "B" || value === "C") return value;
  return "all";
}

function asIsoDate(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
}

// Valor sentinela do select: tudo menos os pedidos sem canal (atacado B2B, que
// entra na Olist sem marketplace e sozinho vira a curva A do mês de cabeça
// para baixo).
const MARKETPLACES = "marketplaces";
const NO_CHANNEL = "Sem canal";

type ChannelFilter = "all" | typeof MARKETPLACES | string;

function asChannelFilter(value: string | undefined, known: string[]): ChannelFilter {
  if (value === MARKETPLACES) return MARKETPLACES;
  if (value && known.includes(value)) return value;
  return "all";
}

function channelLabel(channel: ChannelFilter) {
  if (channel === "all") return "Todos";
  if (channel === MARKETPLACES) return "Marketplaces";
  return channel;
}

// Período só vale com as duas pontas preenchidas e na ordem certa; qualquer
// coisa fora disso cai no comportamento antigo (curva por recência).
function asPeriod(start: string | undefined, end: string | undefined) {
  const from = asIsoDate(start);
  const to = asIsoDate(end);
  if (!from || !to || from > to) return null;
  return { from, to };
}

function summarize(items: CurveItem[], byVolume: boolean): CurveSummary[] {
  return (["A", "B", "C"] as Curve[]).map((curve) => {
    const curveItems = items.filter((item) => item.curve === curve);
    return {
      curve,
      label: curveLabel(curve),
      description: curveDescription(curve, byVolume),
      items: curveItems.length,
      units: curveItems.reduce((sum, item) => sum + n(item.units_sold), 0)
    };
  });
}

// Cache de 5min compartilhado entre usuários: a curva vem de RPC global (mesmo
// resultado para todo mundo) e muda no ritmo dos syncs, não por navegação.
// unstable_cache não pode ler cookies(), por isso o client aqui é o admin.
const loadSalesCurve = unstable_cache(loadSalesCurveUncached, ["sales-curve"], {
  revalidate: 300
});

async function loadSalesCurveUncached() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("oraculo_sales_curve");
  if (error) throw error;
  const items = (data ?? []) as CurveItem[];

  return {
    items: items.sort((left, right) => {
      if (left.curve !== right.curve) return left.curve.localeCompare(right.curve);
      return String(left.product_name ?? "").localeCompare(String(right.product_name ?? ""), "pt-BR");
    }),
    summaries: summarize(items, false)
  };
}

// Com período, a classificação muda de significado: deixa de ser recência e
// vira ABC clássica por volume vendido na janela (ver migration
// 20260819120000_oraculo_sales_curve_volume.sql).
async function loadSalesCurveByVolume(
  period: { from: string; to: string },
  channel: ChannelFilter
) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("oraculo_sales_curve_volume", {
    p_start: period.from,
    p_end: period.to,
    p_channel: channel === "all" || channel === MARKETPLACES ? null : channel,
    p_exclude_no_channel: channel === MARKETPLACES
  });
  if (error) throw error;
  const items = (data ?? []) as CurveItem[];

  return { items, summaries: summarize(items, true) };
}

// Nomes de canal vêm do cache diário de quantidade por canal (barato) e mudam
// pouco: 1h de cache basta e evita uma ida ao banco por navegação.
const loadChannels = unstable_cache(loadChannelsUncached, ["sales-curve-channels"], {
  revalidate: 3600
});

async function loadChannelsUncached() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("oraculo_sales_curve_channels");
  if (error) throw error;
  return ((data ?? []) as { channel_name: string }[])
    .map((row) => row.channel_name)
    .filter((name): name is string => Boolean(name));
}

export default async function CurvaDeVendaPage({
  searchParams
}: {
  searchParams?: Promise<{ curva?: string; de?: string; ate?: string; canal?: string }>;
}) {
  const params = await searchParams;
  const selectedCurve = asCurveFilter(params?.curva);
  const period = asPeriod(params?.de, params?.ate);
  const byVolume = period !== null;
  const channels = await loadChannels();
  const selectedChannel = asChannelFilter(params?.canal, channels);
  const [{ allowed }, alertCount, data] = await Promise.all([
    requireTabAccess("curva-de-venda"),
    loadActionableAlertCount(),
    period ? loadSalesCurveByVolume(period, selectedChannel) : loadSalesCurve()
  ]);
  if (!allowed) return <NoAccess tab="curva-de-venda" />;
  const visibleItems = selectedCurve === "all"
    ? data.items
    : data.items.filter((item) => item.curve === selectedCurve);
  const visibleStock = visibleItems.reduce((sum, item) => sum + n(item.available_stock), 0);
  const visibleUnits = visibleItems.reduce((sum, item) => sum + n(item.units_sold), 0);
  const periodDays = period
    ? Math.round(
        (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86400000
      ) + 1
    : 0;
  const chartValue = (summary: CurveSummary) => (byVolume ? summary.units : summary.items);
  const maxValue = Math.max(...data.summaries.map(chartValue), 1);
  const exportParams = new URLSearchParams();
  if (selectedCurve !== "all") exportParams.set("curva", selectedCurve);
  if (period) {
    exportParams.set("de", period.from);
    exportParams.set("ate", period.to);
    if (selectedChannel !== "all") exportParams.set("canal", selectedChannel);
  }
  const exportQuery = exportParams.toString();
  const exportHref = exportQuery ? `/curva-de-venda/export?${exportQuery}` : "/curva-de-venda/export";

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Curva de Venda</h1>
          <p>
            {byVolume
              ? "Classificação ABC por volume vendido no período selecionado"
              : "Classificação ABC de estoque por tempo desde a última saída"}
          </p>
        </div>
        <form className="filter-row filter-form" method="get">
          <label>
            <span>De</span>
            <input type="date" name="de" defaultValue={params?.de ?? ""} />
          </label>
          <label>
            <span>Até</span>
            <input type="date" name="ate" defaultValue={params?.ate ?? ""} />
          </label>
          <label>
            <span>Canal</span>
            <select name="canal" defaultValue={selectedChannel}>
              <option value="all">Todos os canais</option>
              <option value={MARKETPLACES}>Só marketplaces (sem atacado)</option>
              {channels.map((channel) => (
                <option value={channel} key={channel}>
                  {channel === NO_CHANNEL ? "Só atacado (sem canal)" : channel}
                </option>
              ))}
            </select>
          </label>
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
        <article className="metric accent-green">
          <span className="label">Período</span>
          <strong>{period ? `${periodDays} dias` : "Sem período"}</strong>
          <small>
            {period
              ? `${date(period.from)} a ${date(period.to)} — ABC por unidades vendidas`
              : "Sem filtro de data: curva por tempo sem venda"}
          </small>
        </article>
        <article className="metric accent-violet metric-text">
          <span className="label">Canal</span>
          <strong>{channelLabel(selectedChannel)}</strong>
          <small>
            {byVolume
              ? selectedChannel === MARKETPLACES
                ? "Exclui pedidos sem canal (atacado B2B)"
                : selectedChannel === "all"
                  ? "Inclui atacado B2B (pedidos sem canal)"
                  : "Somente este canal de venda"
              : "Só vale com período preenchido"}
          </small>
        </article>
        {byVolume ? (
          <article className="metric accent-yellow">
            <span className="label">Unidades no filtro</span>
            <strong>{count(visibleUnits)}</strong>
            <small>Vendidas no período exibido</small>
          </article>
        ) : null}
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
            <small>
              {byVolume ? `${count(summary.units)} un — ${summary.description}` : summary.description}
            </small>
          </article>
        ))}
      </section>

      <section className="panel curve-panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">{byVolume ? "Volume por curva" : "Estoque por curva"}</p>
            <h2>Linhas horizontais A, B e C</h2>
          </div>
          <span className="pill">
            {byVolume ? "Unidades vendidas por curva" : "Quantidade de produtos por curva"}
          </span>
        </div>

        <div
          className="horizontal-curve-chart"
          aria-label={
            byVolume
              ? "Unidades vendidas por curva de venda no período"
              : "Quantidade de produtos em estoque por curva de venda"
          }
        >
          {data.summaries.map((summary) => {
            const value = chartValue(summary);
            const width = Math.max((value / maxValue) * 100, value > 0 ? 2 : 0);
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
                  <strong>{byVolume ? `${count(summary.units)} unidades` : `${count(summary.items)} produtos`}</strong>
                  <span>{byVolume ? `${count(summary.items)} produtos` : summary.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel product-panel">
        <div className="sku-toolbar">
          <div>
            <p className="eyebrow">{byVolume ? "Produtos vendidos no período" : "Itens do estoque"}</p>
            <h2>{selectedCurve === "all" ? "Todos os SKUs classificados" : `SKUs da curva ${selectedCurve}`}</h2>
          </div>
          <div className="sku-actions">
            <strong>Curva ABC</strong>
            <span>{byVolume ? "Unidades vendidas" : "Última saída"}</span>
            <span>Estoque</span>
          </div>
        </div>

        {byVolume ? (
          <SortableTable
            columns={[
              { label: "Nome do produto" },
              { label: "Unidades vendidas", numeric: true },
              { label: "% do volume", numeric: true },
              { label: "% acumulado", numeric: true },
              { label: "Data da última venda", numeric: true },
              { label: "Quantidade em estoque", numeric: true },
              { label: "Curva de venda", numeric: true }
            ]}
            initialSort={1}
            initialDir="desc"
            rows={visibleItems.map((item) => [
              {
                text: item.product_name ?? "Sem nome",
                sort: item.product_name ?? null,
                href: `/skus?source=${encodeURIComponent(item.source ?? "all")}&sku=${encodeURIComponent(item.sku ?? "")}`
              },
              { text: count(item.units_sold), sort: n(item.units_sold) },
              { text: pct(item.share_pct), sort: n(item.share_pct) },
              { text: pct(item.cum_share_pct), sort: n(item.cum_share_pct) },
              {
                text: date(item.last_sale_at),
                sort: item.last_sale_at ? Date.parse(item.last_sale_at) : null
              },
              { text: stock(item.available_stock), sort: item.available_stock ?? null },
              { text: item.curve, sort: item.curve, badge: `curve-badge curve-${item.curve.toLowerCase()}` }
            ])}
          />
        ) : (
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
        )}
      </section>
    </AppShell>
  );
}
