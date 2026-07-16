import { createSupabaseUserClient } from "../../lib/supabase/user";
import { requireCurrentUser } from "../../lib/auth/session";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { SortableTable, type SortableCell } from "../components/sortable-table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000; // PostgREST corta em 1000 linhas — sempre paginar
const PARADO_MAX_ROWS = 150;

type MlItem = {
  seller_id: number;
  mlb_id: string;
  title: string | null;
  sku: string | null;
  status: string | null;
  price: number | null;
  permalink: string | null;
  logistic_type: string | null;
  available_qty: number;
  full_stock: number;
  sold_qty_30d: number;
  revenue_30d: number;
  sold_qty_60d: number;
  revenue_60d: number;
  snapshot_days_30d: number;
  in_stock_days_30d: number;
  last_sale_at: string | null;
};

type SaleRow = { mlb_id: string; sale_date: string; qty_sold: number };

type SyncRun = { finished_at: string | null };

type Curve = "A" | "B" | "C" | null;

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function count(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function daysSince(iso: string | null) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// Velocidade de venda diária estimada sobre os dias COM estoque (estudo
// Magiic: "vendia X/dia quando possuía estoque"). A média bruta de 30 dias
// subestima itens que passaram parte da janela em ruptura.
function dailyVelocity(item: MlItem) {
  // Com histórico de snapshots suficiente, usa o ratio observado (real).
  if (item.snapshot_days_30d >= 15) {
    const ratio = Math.max(item.in_stock_days_30d / item.snapshot_days_30d, 0.1);
    return item.sold_qty_30d / (30 * ratio);
  }
  // Sem histórico: aproxima os dias sem estoque pelos dias desde a última
  // venda — velocidade = vendas 60d ÷ dias com estoque na janela de 60d.
  const daysOut = Math.min(daysSince(item.last_sale_at) ?? 60, 60);
  const inStockDays = Math.max(60 - daysOut, 3);
  return item.sold_qty_60d / inStockDays;
}

function isFull(item: MlItem) {
  return item.logistic_type === "fulfillment";
}

function stockOf(item: MlItem) {
  return isFull(item) ? item.full_stock : item.available_qty;
}

// Curva ABC 80/15/5 por contribuição de receita 30d (conta toda: Full + local)
function computeCurves(items: MlItem[]): Map<string, Curve> {
  const withRevenue = items
    .filter((item) => item.revenue_30d > 0)
    .sort((a, b) => b.revenue_30d - a.revenue_30d);
  const total = withRevenue.reduce((sum, item) => sum + item.revenue_30d, 0);
  const curves = new Map<string, Curve>();
  let cumulative = 0;
  for (const item of withRevenue) {
    cumulative += item.revenue_30d;
    const share = total > 0 ? cumulative / total : 1;
    curves.set(item.mlb_id, share <= 0.8 ? "A" : share <= 0.95 ? "B" : "C");
  }
  return curves;
}

// Buckets de tendência (120/90 · 90/60 · 60/30 · 30/0) em unidades vendidas
function computeTrends(sales: SaleRow[]): Map<string, [number, number, number, number]> {
  const today = Date.now();
  const trends = new Map<string, [number, number, number, number]>();
  for (const row of sales) {
    const age = Math.floor((today - new Date(row.sale_date).getTime()) / 86_400_000);
    if (age < 0 || age > 119) continue;
    const bucket = age < 30 ? 3 : age < 60 ? 2 : age < 90 ? 1 : 0;
    const entry = trends.get(row.mlb_id) ?? [0, 0, 0, 0];
    entry[bucket] += row.qty_sold;
    trends.set(row.mlb_id, entry);
  }
  return trends;
}

async function loadData() {
  const supabase = await createSupabaseUserClient();

  // Busca paginada — sem isso o PostgREST devolve só as primeiras 1000 linhas
  const items: MlItem[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("mercadolivre_items")
      .select(
        "seller_id, mlb_id, title, sku, status, price, permalink, logistic_type, available_qty, full_stock, sold_qty_30d, revenue_30d, sold_qty_60d, revenue_60d, snapshot_days_30d, in_stock_days_30d, last_sale_at"
      )
      .neq("status", "closed")
      .order("mlb_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("mercado-livre page:", error.message);
      return null;
    }
    items.push(...((data ?? []) as MlItem[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const sales: SaleRow[] = [];
  const cutoff = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("mercadolivre_sales_daily")
      .select("mlb_id, sale_date, qty_sold")
      .gte("sale_date", cutoff)
      .order("sale_date")
      .range(from, from + PAGE_SIZE - 1);
    if (error) break; // tendência é opcional; página segue sem ela
    sales.push(...((data ?? []) as SaleRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const { data: runData } = await supabase
    .from("mercadolivre_sync_runs")
    .select("finished_at")
    .eq("status", "success")
    .order("finished_at", { ascending: false })
    .limit(1);
  const lastRun = ((runData ?? []) as SyncRun[])[0] ?? null;

  return { items, sales, lastRun };
}

function trendText(trend: [number, number, number, number] | undefined) {
  if (!trend) return "—";
  return trend.join(" · ");
}

// última posição do bucket mais recente comparada à anterior, p/ ordenação
function trendSlope(trend: [number, number, number, number] | undefined) {
  if (!trend) return null;
  return trend[3] - trend[2];
}

const curveBadge: Record<Exclude<Curve, null>, string> = {
  A: "status-pill signal-good",
  B: "status-pill signal-warning",
  C: "status-pill signal-muted"
};

function curveCell(curve: Curve): SortableCell {
  return curve
    ? { text: `Curva ${curve}`, sort: curve, badge: curveBadge[curve] }
    : { text: "—", sort: null };
}

function origemCell(item: MlItem): SortableCell {
  return isFull(item)
    ? { text: "Full", sort: "Full", badge: "status-pill signal-good" }
    : { text: "Local", sort: "Local", badge: "status-pill signal-muted" };
}

function itemCell(item: MlItem): SortableCell {
  return {
    text: item.title ?? item.mlb_id,
    sort: item.title ?? item.mlb_id,
    href: item.permalink ?? undefined,
    subtitle: [item.mlb_id, item.sku ? `SKU ${item.sku}` : null].filter(Boolean).join(" · ")
  };
}

export default async function MercadoLivrePage() {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const data = await loadData();

  if (!data || data.items.length === 0) {
    return (
      <AppShell alertCount={alertCount}>
        <header className="topbar">
          <div>
            <h1>Mercado Livre</h1>
            <p>Aguardando primeira sincronização do canal.</p>
          </div>
        </header>
        <section className="panel">
          <div className="empty-state">
            <p>
              Nenhum anúncio sincronizado ainda. Verifique a função{" "}
              <code>mercadolivre-sync</code> e o <code>/status</code>.
            </p>
          </div>
        </section>
      </AppShell>
    );
  }

  const { items, sales, lastRun } = data;
  const curves = computeCurves(items);
  const trends = computeTrends(sales);

  // ---- Ruptura: Full E fora do Full, critério de venda em 60 dias (Magiic) ----
  const ruptura = items
    .filter((item) => stockOf(item) <= 0 && item.sold_qty_60d > 0)
    .map((item) => {
      const velocity = dailyVelocity(item);
      return { item, velocity, lossPerDay: velocity * n(item.price) };
    })
    .sort((a, b) => b.lossPerDay - a.lossPerDay);

  // ---- Cobertura: somente Full com giro ----
  const cobertura = items
    .filter((item) => isFull(item) && item.full_stock > 0 && item.sold_qty_30d > 0 && item.status === "active")
    .map((item) => {
      const velocity = dailyVelocity(item);
      return { item, velocity, coverageDays: item.full_stock / velocity };
    })
    .sort((a, b) => a.coverageDays - b.coverageDays);

  // ---- Parado: estoque sem giro (Full: sem venda 30d; local: sem venda 60d) ----
  const parado = items
    .filter((item) => {
      const stock = stockOf(item);
      if (stock <= 0) return false;
      if (item.status === "paused") return true;
      return isFull(item) ? item.sold_qty_30d <= 0 : item.sold_qty_60d <= 0;
    })
    .map((item) => {
      const idle = daysSince(item.last_sale_at);
      const curve = curves.get(item.mlb_id) ?? null;
      // heurística de ação (estudo Magiic): 120d+ sem venda → retirada;
      // curva A parada → investigar/enviar; demais → promoção
      const acao =
        idle === null || idle > 120
          ? "Avaliar retirada"
          : curve === "A"
            ? "Investigar (Curva A)"
            : "Ativar promoção";
      return { item, curve, acao, capital: stockOf(item) * n(item.price) };
    })
    .sort((a, b) => b.capital - a.capital);

  const lossPerDay = ruptura.reduce((sum, r) => sum + r.lossPerDay, 0);
  const criticalCoverage = cobertura.filter((c) => c.coverageDays < 7);
  const capitalParado = parado.reduce((sum, p) => sum + p.capital, 0);
  const curveARisk =
    ruptura.filter((r) => curves.get(r.item.mlb_id) === "A").length +
    criticalCoverage.filter((c) => curves.get(c.item.mlb_id) === "A").length;

  const rupturaRows: SortableCell[][] = ruptura.map(({ item, velocity, lossPerDay: loss }) => [
    itemCell(item),
    origemCell(item),
    curveCell(curves.get(item.mlb_id) ?? null),
    { text: `${count(item.sold_qty_30d)} / ${count(item.sold_qty_60d)}`, sort: item.sold_qty_60d },
    { text: trendText(trends.get(item.mlb_id)), sort: trendSlope(trends.get(item.mlb_id)) },
    { text: velocity.toFixed(1), sort: velocity },
    { text: brl(loss), sort: loss, badge: "status-pill signal-danger" },
    {
      text: daysSince(item.last_sale_at) != null ? `há ${daysSince(item.last_sale_at)}d` : "—",
      sort: daysSince(item.last_sale_at)
    }
  ]);

  const coberturaRows: SortableCell[][] = cobertura.map(({ item, velocity, coverageDays }) => [
    itemCell(item),
    curveCell(curves.get(item.mlb_id) ?? null),
    { text: count(item.full_stock), sort: item.full_stock },
    { text: trendText(trends.get(item.mlb_id)), sort: trendSlope(trends.get(item.mlb_id)) },
    { text: velocity.toFixed(1), sort: velocity },
    { text: `${Math.floor(coverageDays)} dias`, sort: coverageDays },
    {
      text: coverageDays < 7 ? "Crítico" : coverageDays < 15 ? "Atenção" : "OK",
      sort: coverageDays < 7 ? 0 : coverageDays < 15 ? 1 : 2,
      badge:
        coverageDays < 7
          ? "status-pill signal-danger"
          : coverageDays < 15
            ? "status-pill signal-warning"
            : "status-pill signal-good"
    }
  ]);

  const paradoVisible = parado.slice(0, PARADO_MAX_ROWS);
  const paradoRows: SortableCell[][] = paradoVisible.map(({ item, curve, acao, capital }) => [
    itemCell(item),
    origemCell(item),
    curveCell(curve),
    { text: brl(n(item.price)), sort: n(item.price) },
    { text: count(stockOf(item)), sort: stockOf(item) },
    { text: brl(capital), sort: capital, badge: "status-pill signal-warning" },
    {
      text: acao,
      sort: acao,
      badge:
        acao === "Avaliar retirada"
          ? "status-pill signal-danger"
          : acao === "Investigar (Curva A)"
            ? "status-pill signal-good"
            : "status-pill signal-warning"
    }
  ]);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Mercado Livre</h1>
          <p>
            Ruptura, cobertura e capital parado (Full e local) ·{" "}
            {lastRun?.finished_at
              ? `último sync ${new Date(lastRun.finished_at).toLocaleString("pt-BR")}`
              : "aguardando primeira sincronização"}
          </p>
        </div>
      </header>

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-red">
          <span className="label">Perda estimada / dia</span>
          <strong>{brl(lossPerDay)}</strong>
          <small>{count(ruptura.length)} itens em ruptura (Full + local)</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Curva A em risco</span>
          <strong>{count(curveARisk)}</strong>
          <small>Itens A em ruptura ou cobertura crítica</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Cobertura crítica</span>
          <strong>{count(criticalCoverage.length)}</strong>
          <small>Full com menos de 7 dias</small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Capital parado</span>
          <strong>{brl(capitalParado)}</strong>
          <small>{count(parado.length)} itens sem giro</small>
        </article>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Dinheiro sendo perdido agora · velocidade calculada sobre dias com estoque</p>
            <h2>Ruptura de estoque</h2>
          </div>
          <span className="pill">{count(ruptura.length)} itens</span>
        </div>
        <SortableTable
          columns={[
            { label: "Anúncio" },
            { label: "Origem" },
            { label: "Curva" },
            { label: "Vendas 30/60d", numeric: true },
            { label: "Tendência 120→0", numeric: true },
            { label: "Média/dia", numeric: true },
            { label: "Perda/dia", numeric: true },
            { label: "Última venda", numeric: true }
          ]}
          rows={rupturaRows}
          initialSort={6}
          initialDir="desc"
        />
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Reponha antes do vermelho · Full</p>
            <h2>Cobertura de estoque Full</h2>
          </div>
          <span className="pill">
            {count(criticalCoverage.length)} críticos · {count(cobertura.length)} com giro
          </span>
        </div>
        <SortableTable
          columns={[
            { label: "Anúncio" },
            { label: "Curva" },
            { label: "Estoque Full", numeric: true },
            { label: "Tendência 120→0", numeric: true },
            { label: "Média/dia", numeric: true },
            { label: "Cobertura", numeric: true },
            { label: "Status" }
          ]}
          rows={coberturaRows}
          initialSort={5}
          initialDir="asc"
        />
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Capital imobilizado · com ação sugerida</p>
            <h2>Estoque parado</h2>
          </div>
          <span className="pill">{brl(capitalParado)}</span>
        </div>
        <SortableTable
          columns={[
            { label: "Anúncio" },
            { label: "Origem" },
            { label: "Curva" },
            { label: "Preço", numeric: true },
            { label: "Estoque", numeric: true },
            { label: "Capital parado", numeric: true },
            { label: "Ação sugerida" }
          ]}
          rows={paradoRows}
          initialSort={5}
          initialDir="desc"
        />
        {parado.length > PARADO_MAX_ROWS && (
          <p className="table-note">
            Exibindo os {PARADO_MAX_ROWS} itens de maior capital parado — {count(parado.length - PARADO_MAX_ROWS)} itens
            menores não exibidos.
          </p>
        )}
      </section>
    </AppShell>
  );
}
