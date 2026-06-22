import { createSupabaseAdminClient } from "../lib/supabase/admin";
import Link from "next/link";

export const dynamic = "force-dynamic";

type DailySale = {
  order_date: string;
  gross_revenue: number | null;
  effective_revenue: number | null;
  orders_count: number | null;
  canceled_orders: number | null;
  units: number | null;
  average_ticket: number | null;
};

type UnifiedChannelSale = {
  order_date: string;
  source: string | null;
  channel_name: string | null;
  net_revenue: number | null;
  orders_count: number | null;
  canceled_orders: number | null;
  average_ticket: number | null;
};

type SourceSummary = {
  source: string;
  label: string;
  orders: number;
  canceled: number;
  revenue: number;
  averageTicket: number | null;
};

type SkuCurrent = {
  source?: string | null;
  sku: string | null;
  product_name: string | null;
  revenue_30d: number | null;
  units_30d: number | null;
  revenue_change_pct: number | null;
  available_stock: number | null;
  stock_balance?: number | null;
  days_until_stockout: number | null;
  last_sale_at: string | null;
};

type SkuPeriodRank = {
  source?: string | null;
  sku: string | null;
  product_name: string | null;
  gross_revenue: number | null;
  effective_revenue: number | null;
  units: number | null;
  available_stock: number | null;
  stock_balance?: number | null;
  days_until_stockout: number | null;
  last_sale_at: string | null;
};

type StockSignal = {
  source?: string | null;
  sku: string | null;
  product_name: string | null;
  stock_signal: string | null;
  available_stock: number | null;
  days_until_stockout: number | null;
  last_sale_at: string | null;
};

type RuptureProduct = {
  id: string;
  sku: string | null;
  product_name: string | null;
  available_stock: number | null;
  days_without_sale: number | null;
  last_sale_at: string | null;
};

type OlistOrderRow = {
  id: string;
  situacao: string | null;
  data_criacao: string | null;
  payload: Record<string, unknown> | null;
};

type DashboardSearchParams = {
  start?: string;
  end?: string;
};

type DashboardFilters = {
  start: string;
  end: string;
};

type BillingWindowMetrics = {
  detailedOrders: number;
  billedOrders: number;
  uninvoicedOrders: number;
};

type NfMetrics = {
  confirmedRevenue: number;
  emittedCount: number;
  canceledCount: number;
  pendingCount: number;
};

type NfMetricsRow = {
  confirmed_revenue: number | string | null;
  emitted_count: number | string | null;
  canceled_count: number | string | null;
  pending_count: number | string | null;
};

type FiscalMetrics = {
  invoicesCount: number;
  billedRevenue: number;
  averageInvoiceValue: number;
  linkedOrdersCount: number;
  excludedDevolutionsCount: number;
  excludedDevolutionsRevenue: number;
  canceledCount: number;
  canceledRevenue: number;
};

type FiscalMetricsRow = {
  invoices_count: number | string | null;
  billed_revenue: number | string | null;
  average_invoice_value: number | string | null;
  linked_orders_count: number | string | null;
  excluded_devolutions_count: number | string | null;
  excluded_devolutions_revenue: number | string | null;
  canceled_count: number | string | null;
  canceled_revenue: number | string | null;
};

function isIsoDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function getDashboardFilters(params: DashboardSearchParams | undefined): DashboardFilters {
  return {
    start: isIsoDate(params?.start) ? params!.start! : "2026-06-01",
    end: isIsoDate(params?.end) ? params!.end! : "2026-06-30"
  };
}

function asNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(asNumber(value));
}

function formatCount(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(asNumber(value));
}

function formatDecimal(value: number | null | undefined, digits = 1) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(asNumber(value));
}

function toDisplayDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00.000Z`);
  }
  return new Date(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo"
  }).format(toDisplayDate(value));
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  }).format(value);
}

function sourceLabel(value: string | null | undefined) {
  if (value === "shopee") return "Shopee";
  if (value === "olist") return "Olist";
  return "Outros";
}

function signalLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    ruptura: "Ruptura",
    ruptura_iminente: "Ruptura iminente",
    sem_venda: "Sem venda",
    parado: "Parado",
    ok: "OK"
  };

  return labels[value ?? ""] ?? "Atenção";
}

function stockLabel(value: number | null | undefined) {
  const stock = asNumber(value);
  if (stock <= 0) return "Sem estoque";
  return `${formatCount(stock)} disp.`;
}

function coverageLabel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value <= 0) return "0d";
  if (value > 999) return "999d+";
  return `${formatDecimal(value, 0)}d`;
}

function formatDateShort(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo"
  }).format(toDisplayDate(value));
}

function daysSince(value: string | null | undefined) {
  if (!value) return null;
  const today = new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(Math.floor((today.getTime() - date.getTime()) / 86_400_000), 0);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateRange(start: string, end: string, maxDays = 45) {
  const dates: string[] = [];
  let cursor = start;

  while (cursor <= end && dates.length < maxDays) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }

  return dates;
}

function parseMoney(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asMetricNumber(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return parseMoney(value);
  return 0;
}

function orderValue(order: OlistOrderRow) {
  const payload = order.payload ?? {};
  return parseMoney(
    payload.valorTotalPedido ??
    payload.valor ??
    payload.total ??
    payload.valorTotalProdutos
  );
}

function isCanceled(order: OlistOrderRow) {
  return String(order.situacao ?? order.payload?.situacao ?? "") === "8";
}

function hasBillingDate(order: OlistOrderRow) {
  return Boolean(String(order.payload?.dataFaturamento ?? "").trim());
}

async function fetchAll<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
) {
  const pageSize = 1000;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);

    if (page.length < pageSize) break;
  }

  return rows;
}

async function loadNfMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: DashboardFilters
): Promise<NfMetrics> {
  const { data, error } = await supabase
    .rpc("oraculo_nf_metrics", {
      start_date: filters.start,
      end_date: filters.end
    })
    .maybeSingle();

  if (error) throw error;

  const row = data as NfMetricsRow | null;
  return {
    confirmedRevenue: asMetricNumber(row?.confirmed_revenue),
    emittedCount: asMetricNumber(row?.emitted_count),
    canceledCount: asMetricNumber(row?.canceled_count),
    pendingCount: asMetricNumber(row?.pending_count)
  };
}

async function loadFiscalMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: DashboardFilters
): Promise<FiscalMetrics> {
  const { data, error } = await supabase
    .rpc("oraculo_fiscal_metrics", {
      start_date: filters.start,
      end_date: filters.end
    })
    .maybeSingle();

  if (error) throw error;

  const row = data as FiscalMetricsRow | null;
  return {
    invoicesCount: asMetricNumber(row?.invoices_count),
    billedRevenue: asMetricNumber(row?.billed_revenue),
    averageInvoiceValue: asMetricNumber(row?.average_invoice_value),
    linkedOrdersCount: asMetricNumber(row?.linked_orders_count),
    excludedDevolutionsCount: asMetricNumber(row?.excluded_devolutions_count),
    excludedDevolutionsRevenue: asMetricNumber(row?.excluded_devolutions_revenue),
    canceledCount: asMetricNumber(row?.canceled_count),
    canceledRevenue: asMetricNumber(row?.canceled_revenue)
  };
}

async function loadRuptureProducts(
  supabase: ReturnType<typeof createSupabaseAdminClient>
): Promise<RuptureProduct[]> {
  const { data: products, error } = await supabase
    .from("olist_products")
    .select("id, sku, nome, disponivel")
    .eq("active", true)
    .neq("tipo", "K")
    .lte("disponivel", 0)
    .order("disponivel", { ascending: true })
    .limit(20);

  if (error) throw error;

  const productRows = (products ?? []) as Array<{
    id: string;
    sku: string | null;
    nome: string | null;
    disponivel: number | null;
  }>;
  const productIds = productRows.map((product) => product.id);

  if (productIds.length === 0) return [];

  const { data: salesRows, error: salesError } = await supabase
    .from("olist_order_items")
    .select("produto_id, order_data_criacao")
    .in("produto_id", productIds)
    .order("order_data_criacao", { ascending: false })
    .limit(5000);

  if (salesError) throw salesError;

  const lastSaleByProduct = new Map<string, string>();
  for (const sale of (salesRows ?? []) as Array<{ produto_id: string | null; order_data_criacao: string | null }>) {
    if (!sale.produto_id || !sale.order_data_criacao || lastSaleByProduct.has(sale.produto_id)) continue;
    lastSaleByProduct.set(sale.produto_id, sale.order_data_criacao);
  }

  return productRows
    .map((product) => {
      const lastSale = lastSaleByProduct.get(product.id) ?? null;
      return {
        id: product.id,
        sku: product.sku,
        product_name: product.nome,
        available_stock: product.disponivel,
        days_without_sale: daysSince(lastSale),
        last_sale_at: lastSale
      };
    })
    .sort((left, right) => asNumber(right.days_without_sale) - asNumber(left.days_without_sale))
    .slice(0, 8);
}

async function loadBillingWindowMetrics(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: DashboardFilters
): Promise<BillingWindowMetrics> {
  const endExclusive = addDays(filters.end, 1);

  const [detailedCountResponse, billedCountResponse] = await Promise.all([
    supabase
      .from("olist_orders")
      .select("id", { count: "exact", head: true })
      .gte("data_criacao", filters.start)
      .lt("data_criacao", endExclusive)
      .not("payload->itens", "is", null),
    supabase
      .from("olist_orders")
      .select("id", { count: "exact", head: true })
      .gte("data_criacao", filters.start)
      .lt("data_criacao", endExclusive)
      .not("payload->>dataFaturamento", "is", null)
  ]);

  const detailedOrders = detailedCountResponse.count ?? 0;
  const billedOrders = billedCountResponse.count ?? 0;

  return {
    detailedOrders,
    billedOrders,
    uninvoicedOrders: Math.max(detailedOrders - billedOrders, 0)
  };
}

async function loadUnifiedChannelRows(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  filters: DashboardFilters
) {
  const fetchRows = () =>
    supabase
      .from("oraculo_channel_sales_unified_cache")
      .select("*")
      .gte("order_date", filters.start)
      .lte("order_date", filters.end)
      .order("order_date", { ascending: false })
      .limit(240);

  let response = await fetchRows();

  if (!response.error && (response.data ?? []).length === 0) {
    const dates = dateRange(filters.start, filters.end);

    for (let index = 0; index < dates.length; index += 5) {
      const batch = dates.slice(index, index + 5);
      await Promise.all(
        batch.map((date) =>
          supabase.rpc("refresh_oraculo_channel_sales_unified_cache", {
            p_start_date: date,
            p_end_date: date
          })
        )
      );
    }

    response = await fetchRows();
  }

  return response;
}

async function loadDashboard(filters: DashboardFilters) {
  const supabase = createSupabaseAdminClient();
  let dailyQuery = supabase
    .from("oraculo_daily_sales")
    .select("*")
    .order("order_date", { ascending: false })
    .limit(120);

  dailyQuery = dailyQuery.gte("order_date", filters.start).lte("order_date", filters.end);

  const [
    dailyResponse,
    channelsResponse,
    skuSalesResponse,
    stockWatchlistResponse,
    orderCount,
    itemCount,
    productCount,
    billingMetrics,
    nfMetrics,
    fiscalMetrics,
    ruptureProducts
  ] = await Promise.all([
    dailyQuery,
    loadUnifiedChannelRows(supabase, filters),
    supabase
      .rpc("oraculo_sku_period_rank_unified", {
        start_date: filters.start,
        end_date: filters.end,
        result_limit: 10,
        source_filter: null
      }),
    supabase
      .from("oraculo_stock_watchlist_unified")
      .select("source, sku, product_name, stock_signal, available_stock, days_until_stockout, last_sale_at")
      .not("sku", "is", null)
      .neq("sku", "")
      .order("days_until_stockout", { ascending: true, nullsFirst: false })
      .limit(8),
    supabase.from("olist_orders").select("id", { count: "exact", head: true }),
    supabase.from("olist_order_items").select("id", { count: "exact", head: true }),
    supabase.from("olist_products").select("id", { count: "exact", head: true }),
    loadBillingWindowMetrics(supabase, filters),
    loadNfMetrics(supabase, filters),
    loadFiscalMetrics(supabase, filters),
    loadRuptureProducts(supabase)
  ]);

  const daily = (dailyResponse.data ?? []) as DailySale[];
  const skuRows = ((skuSalesResponse.data ?? []) as SkuPeriodRank[]).map((sku) => ({
    source: sku.source,
    sku: sku.sku,
    product_name: sku.product_name,
    revenue_30d: asNumber(sku.effective_revenue),
    units_30d: asNumber(sku.units),
    revenue_change_pct: null,
    available_stock: sku.available_stock,
    stock_balance: sku.stock_balance,
    days_until_stockout: sku.days_until_stockout,
    last_sale_at: sku.last_sale_at
  }));
  const monthEffective = daily.reduce((sum, row) => sum + asNumber(row.effective_revenue), 0);
  const monthOrders = daily.reduce((sum, row) => sum + asNumber(row.orders_count), 0);
  const monthUnits = daily.reduce((sum, row) => sum + asNumber(row.units), 0);
  const latestDay = daily[0] ?? null;
  const dailyChart = daily.slice().reverse();
  const maxDailyRevenue = Math.max(...dailyChart.map((row) => asNumber(row.effective_revenue)), 1);
  const actionableWatchlist = ((stockWatchlistResponse.data ?? []) as StockSignal[]).filter(
    (row) => row.stock_signal === "ruptura" || row.stock_signal === "ruptura_iminente"
  );
  const unifiedRows = (channelsResponse.data ?? []) as UnifiedChannelSale[];
  const sourceMap = new Map<string, SourceSummary>();
  const channelMap = new Map<string, UnifiedChannelSale>();

  for (const row of unifiedRows) {
    const source = row.source ?? "other";
    const sourceEntry = sourceMap.get(source) ?? {
      source,
      label: sourceLabel(source),
      orders: 0,
      canceled: 0,
      revenue: 0,
      averageTicket: null
    };
    sourceEntry.orders += asNumber(row.orders_count);
    sourceEntry.canceled += asNumber(row.canceled_orders);
    sourceEntry.revenue += asNumber(row.net_revenue);
    sourceEntry.averageTicket = sourceEntry.orders > sourceEntry.canceled
      ? sourceEntry.revenue / Math.max(sourceEntry.orders - sourceEntry.canceled, 1)
      : null;
    sourceMap.set(source, sourceEntry);

    const channelKey = `${source}:${row.channel_name ?? "Sem canal"}`;
    const channelEntry = channelMap.get(channelKey) ?? {
      order_date: row.order_date,
      source,
      channel_name: row.channel_name,
      net_revenue: 0,
      orders_count: 0,
      canceled_orders: 0,
      average_ticket: null
    };
    channelEntry.orders_count = asNumber(channelEntry.orders_count) + asNumber(row.orders_count);
    channelEntry.canceled_orders = asNumber(channelEntry.canceled_orders) + asNumber(row.canceled_orders);
    channelEntry.net_revenue = asNumber(channelEntry.net_revenue) + asNumber(row.net_revenue);
    channelEntry.average_ticket = asNumber(channelEntry.orders_count) - asNumber(channelEntry.canceled_orders) > 0
      ? asNumber(channelEntry.net_revenue) / Math.max(asNumber(channelEntry.orders_count) - asNumber(channelEntry.canceled_orders), 1)
      : null;
    if (row.order_date > channelEntry.order_date) channelEntry.order_date = row.order_date;
    channelMap.set(channelKey, channelEntry);
  }

  const sourceSummaries = Array.from(sourceMap.values()).sort((left, right) => right.revenue - left.revenue);
  const channels = Array.from(channelMap.values()).sort(
    (left, right) => asNumber(right.net_revenue) - asNumber(left.net_revenue)
  );
  const totalUnifiedOrders = sourceSummaries.reduce((sum, item) => sum + item.orders, 0);
  const totalUnifiedRevenue = sourceSummaries.reduce((sum, item) => sum + item.revenue, 0);
  const totalUnifiedCanceled = sourceSummaries.reduce((sum, item) => sum + item.canceled, 0);
  const latestUnifiedDay = unifiedRows.reduce<string | null>(
    (latest, row) => (!latest || row.order_date > latest ? row.order_date : latest),
    latestDay?.order_date ?? null
  );

  return {
    daily,
    latestDay,
    dailyChart,
    maxDailyRevenue,
    monthEffective,
    nfMetrics,
    fiscalMetrics,
    monthOrders,
    monthUnits,
    monthTicket: monthOrders > 0 ? monthEffective / monthOrders : null,
    billingMetrics,
    sourceSummaries,
    channels,
    totalUnifiedOrders,
    totalUnifiedRevenue,
    totalUnifiedCanceled,
    skus: skuRows,
    stockWatchlist: (stockWatchlistResponse.data ?? []) as StockSignal[],
    ruptureProducts,
    actionableWatchlist,
    filteredOrderCount: totalUnifiedOrders,
    availableThrough: latestUnifiedDay,
    orderCount: orderCount.count ?? 0,
    itemCount: itemCount.count ?? 0,
    productCount: productCount.count ?? 0
  };
}

export default async function HomePage({
  searchParams
}: {
  searchParams?: Promise<DashboardSearchParams>;
}) {
  const filters = getDashboardFilters(await searchParams);
  const data = await loadDashboard(filters);
  const filterQuery = `?start=${encodeURIComponent(filters.start)}&end=${encodeURIComponent(filters.end)}`;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">O</span>
          <div>
            <strong>Oraculo</strong>
            <small>Multi-channel BI</small>
          </div>
        </div>

        <nav className="nav-group" aria-label="Principal">
          <span>Principal</span>
          <Link href="/" className="nav-active">Analytics</Link>
          <Link href={`/pedidos${filterQuery}`}>Pedidos</Link>
          <Link href="/skus">SKUs</Link>
          <Link href="/skus">Análise SKU</Link>
          <Link href="/alertas">Alertas <b>{formatCount(data.actionableWatchlist.length)}</b></Link>
          <Link href="/pedidos">Performance</Link>
          <Link href="/alertas">Ruptura</Link>
          <Link href="/parametros">Parâmetros</Link>
        </nav>

        <nav className="nav-group nav-admin" aria-label="Admin">
          <span>Admin</span>
          <Link href="/usuarios">Usuários</Link>
          <Link href="/">Logs</Link>
          <Link href="/parametros">Config</Link>
        </nav>

        <div className="sidebar-footer">
          <span className="sync-dot">•••••</span>
          <small>Período ativo</small>
          <strong>{filters.start} a {filters.end}</strong>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>Analytics</h1>
            <p>
              {formatCount(data.filteredOrderCount)} pedidos no período · {formatCount(data.productCount)} produtos Olist
              {data.availableThrough ? ` · dados até ${formatDateShort(data.availableThrough)}` : ""}
            </p>
          </div>
          <form className="filter-row filter-form" method="get">
            <label>
              <span>Início</span>
              <input type="date" name="start" defaultValue={filters.start} />
            </label>
            <label>
              <span>Fim</span>
              <input type="date" name="end" defaultValue={filters.end} />
            </label>
            <button type="submit">Aplicar</button>
          </form>
        </header>

        <section className="dashboard-section">
          <div className="section-head section-row">
            <div>
              <p className="eyebrow">Fiscal oficial</p>
              <h2>Venda por NF faturada</h2>
            </div>
            <span className="pill">Regra: status 6/7 · saída · sem devolução</span>
          </div>
          <div className="metric-grid metric-grid-eight">
            <Link className="metric metric-link accent-yellow" href={`/pedidos${filterQuery}`}>
              <span className="label">Receita faturada</span>
              <strong>{formatCurrency(data.fiscalMetrics.billedRevenue)}</strong>
              <small>Valor total das NFs emitidas/autorizadas</small>
            </Link>
            <Link className="metric metric-link accent-blue" href={`/pedidos${filterQuery}`}>
              <span className="label">NFs emitidas</span>
              <strong>{formatCount(data.fiscalMetrics.invoicesCount)}</strong>
              <small>NFs fiscais válidas no período</small>
            </Link>
            <Link className="metric metric-link accent-blue" href={`/pedidos${filterQuery}`}>
              <span className="label">Ticket médio faturado</span>
              <strong>{data.fiscalMetrics.invoicesCount <= 0 ? "-" : formatCurrency(data.fiscalMetrics.averageInvoiceValue)}</strong>
              <small>Receita faturada / NFs emitidas</small>
            </Link>
            <Link className="metric metric-link accent-white" href={`/pedidos${filterQuery}`}>
              <span className="label">NFs com pedido</span>
              <strong>{formatCount(data.fiscalMetrics.linkedOrdersCount)}</strong>
              <small>Cobertura de vínculo pedido/NF</small>
            </Link>
            <Link className="metric metric-link accent-red" href={`/pedidos${filterQuery}`}>
              <span className="label">Canceladas</span>
              <strong>{formatCount(data.fiscalMetrics.canceledCount)}</strong>
              <small>{formatCurrency(data.fiscalMetrics.canceledRevenue)} fora da receita</small>
            </Link>
            <Link className="metric metric-link accent-red" href={`/pedidos${filterQuery}`}>
              <span className="label">Devoluções excluídas</span>
              <strong>{formatCount(data.fiscalMetrics.excludedDevolutionsCount)}</strong>
              <small>{formatCurrency(data.fiscalMetrics.excludedDevolutionsRevenue)} fora da receita</small>
            </Link>
          </div>
        </section>

        <section className="dashboard-section">
          <div className="section-head">
            <p className="eyebrow">Operacional auxiliar</p>
            <h2>Pedidos e itens ainda não oficiais para ROI</h2>
          </div>
        <section className="metric-grid metric-grid-eight">
          <Link className="metric metric-link accent-yellow" href={`/pedidos${filterQuery}`}>
            <span className="label">Receita operacional</span>
            <strong>{formatCurrency(data.nfMetrics.confirmedRevenue)}</strong>
            <small>Pedidos válidos no período</small>
          </Link>
          <Link className="metric metric-link accent-blue" href={`/pedidos${filterQuery}`}>
            <span className="label">Vendas confirmadas</span>
            <strong>{formatCount(data.nfMetrics.emittedCount)}</strong>
            <small>Status não pendente/cancelado</small>
          </Link>
          <Link className="metric metric-link accent-yellow" href="/skus">
            <span className="label">Itens vendidos</span>
            <strong>{formatCount(data.monthUnits)}</strong>
            <small>{formatCount(data.itemCount)} linhas de item na base</small>
          </Link>
          <Link className="metric metric-link accent-blue" href={`/pedidos${filterQuery}`}>
            <span className="label">Ticket Médio</span>
            <strong>{data.nfMetrics.emittedCount <= 0 ? "-" : formatCurrency(data.nfMetrics.confirmedRevenue / data.nfMetrics.emittedCount)}</strong>
            <small>Receita operacional / vendas</small>
          </Link>
          <Link className="metric metric-link accent-red" href={`/pedidos${filterQuery}`}>
            <span className="label">Canceladas</span>
            <strong>{formatCount(data.nfMetrics.canceledCount)}</strong>
            <small>Status cancelado no período</small>
          </Link>
          <Link className="metric metric-link accent-white" href={`/pedidos${filterQuery}`}>
            <span className="label">Pendentes</span>
            <strong>{formatCount(data.nfMetrics.pendingCount)}</strong>
            <small>Status pendente no período</small>
          </Link>
        </section>
        </section>

        <section className="source-summary-grid">
          <Link className="panel panel-link source-summary-card" href={`/pedidos${filterQuery}`}>
            <div className="section-head">
              <p className="eyebrow">Consolidado</p>
              <h2>Total multi-canal</h2>
            </div>
            <div className="source-summary-stats">
              <article>
                <span>Pedidos</span>
                <strong>{formatCount(data.totalUnifiedOrders)}</strong>
              </article>
              <article>
                <span>Receita líquida</span>
                <strong>{formatCurrency(data.totalUnifiedRevenue)}</strong>
              </article>
              <article>
                <span>Cancelados</span>
                <strong>{formatCount(data.totalUnifiedCanceled)}</strong>
              </article>
            </div>
          </Link>

          {data.sourceSummaries.map((summary) => (
            <Link
              key={summary.source}
              className="panel panel-link source-summary-card"
              href={`/pedidos${filterQuery}&source=${encodeURIComponent(summary.source)}`}
            >
              <div className="section-head">
                <p className="eyebrow">Fonte</p>
                <h2>{summary.label}</h2>
              </div>
              <div className="source-summary-stats">
                <article>
                  <span>Pedidos</span>
                  <strong>{formatCount(summary.orders)}</strong>
                </article>
                <article>
                  <span>Receita</span>
                  <strong>{formatCurrency(summary.revenue)}</strong>
                </article>
                <article>
                  <span>Ticket</span>
                  <strong>{summary.averageTicket == null ? "-" : formatCurrency(summary.averageTicket)}</strong>
                </article>
              </div>
            </Link>
          ))}
        </section>

        <section className="control-grid">
          <Link className="panel panel-link chart-panel" href={`/pedidos${filterQuery}`}>
            <div className="section-head section-row">
              <div>
                <p className="eyebrow">Receita por dia</p>
                <h2>Curva do periodo</h2>
              </div>
              <span className="pill">Último dia: {formatDate(data.availableThrough)}</span>
            </div>

            <div className="bar-chart" aria-label="Receita por dia">
              {data.dailyChart.map((row) => {
                const effectiveRevenue = asNumber(row.effective_revenue);
                const height = Math.max((effectiveRevenue / data.maxDailyRevenue) * 100, 3);
                const tooltip = `${formatDate(row.order_date)}: ${formatCurrency(effectiveRevenue)} · ${formatCount(row.orders_count)} pedidos`;
                return (
                  <div className="bar-item has-tooltip" key={row.order_date} title={tooltip} aria-label={tooltip} data-tooltip={tooltip}>
                    <div className="bar-track">
                      <span style={{ height: `${height}%` }} />
                    </div>
                    <small>{formatDate(row.order_date)}</small>
                  </div>
                );
              })}
            </div>
          </Link>

          <Link className="panel panel-link funnel-panel" href={`/pedidos${filterQuery}`}>
            <div>
              <p className="eyebrow">Canais</p>
              <h2>Receita por canal e fonte</h2>
            </div>

            <div className="funnel-list">
              {data.channels.length === 0 ? (
                <p className="empty-state">Sem receita por canal no periodo selecionado.</p>
              ) : (
                data.channels.slice(0, 9).map((channel) => {
                  const max = Math.max(...data.channels.map((item) => asNumber(item.net_revenue)), 1);
                  const width = Math.max((asNumber(channel.net_revenue) / max) * 100, 2);
                  return (
                    <div className="funnel-row" key={`${channel.source}-${channel.channel_name}`}>
                      <span>{sourceLabel(channel.source)} · {channel.channel_name ?? "Sem canal"}</span>
                      <div><i style={{ width: `${width}%` }} /></div>
                      <strong>{formatCount(channel.orders_count)}</strong>
                      <em>{formatCurrency(channel.net_revenue)}</em>
                    </div>
                  );
                })
              )}
            </div>
          </Link>
        </section>

        <section className="panel product-panel">
          <div className="sku-toolbar">
            <div>
              <p className="eyebrow">Produtos</p>
              <h2>SKUs por receita</h2>
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
                  <th className="numeric">Receita</th>
                  <th className="numeric">Un.</th>
                  <th className="numeric">Ticket</th>
                  <th className="numeric">Var %</th>
                  <th className="numeric">Estoque</th>
                  <th className="numeric">Cobertura</th>
                </tr>
              </thead>
              <tbody>
                {data.skus.length === 0 ? (
                  <tr>
                    <td colSpan={10}>
                      <p className="empty-state table-empty">Sem SKUs vendidos no periodo selecionado.</p>
                    </td>
                  </tr>
                ) : (
                  data.skus.map((sku, index) => (
                    <tr key={sku.sku ?? sku.product_name}>
                      <td>{index + 1}</td>
                      <td>{sourceLabel(sku.source)}</td>
                      <td>{sku.sku || "-"}</td>
                      <td>
                        <Link className="row-link" href={`/skus?sku=${encodeURIComponent(sku.sku ?? "")}`}>
                          {sku.product_name ?? "Sem nome"}
                        </Link>
                      </td>
                      <td className="numeric">{formatCurrency(sku.revenue_30d)}</td>
                      <td className="numeric">{formatCount(sku.units_30d)}</td>
                      <td className="numeric">{formatCurrency(asNumber(sku.revenue_30d) / Math.max(asNumber(sku.units_30d), 1))}</td>
                      <td className="numeric trend-value">{formatPercent(sku.revenue_change_pct)}</td>
                      <td className="numeric">{sku.available_stock == null ? "-" : formatCount(sku.available_stock)}</td>
                      <td className="numeric">{coverageLabel(sku.days_until_stockout)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bottom-grid">
          <article className="panel">
            <p className="eyebrow">Top SKUs</p>
            <h2>Ranking rápido</h2>
            <div className="rank-list">
              {data.skus.length === 0 ? (
                <p className="empty-state">Sem ranking para o periodo selecionado.</p>
              ) : (
                data.skus.slice(0, 5).map((sku) => (
                  <Link href={`/skus?sku=${encodeURIComponent(sku.sku ?? "")}`} key={`rank-${sku.sku}`}>
                    <span>{sku.product_name ?? "Sem nome"}</span>
                    <div className="rank-metrics">
                      <strong>{formatCurrency(sku.revenue_30d)}</strong>
                      <small>{formatCount(sku.units_30d)} un.</small>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </article>

          <article className="panel">
            <p className="eyebrow">Estoque</p>
            <h2>Ruptura por produto simples</h2>
            <div className="watchlist">
              {data.ruptureProducts.length === 0 ? (
                <p className="empty-state">Nenhum produto simples em ruptura encontrado.</p>
              ) : (
                data.ruptureProducts.map((item) => (
                  <Link href={`/skus?sku=${encodeURIComponent(item.sku ?? "")}`} key={`${item.id}-${item.sku}`}>
                    <div>
                      <strong>{item.product_name ?? "Sem nome"}</strong>
                      <span>{item.sku || "-"}</span>
                    </div>
                    <div className="watch-meta">
                      <span className="badge ruptura">Ruptura</span>
                      <small>
                        {formatCount(item.days_without_sale)} dias sem venda · {stockLabel(item.available_stock)}
                      </small>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </article>
        </section>
      </main>
    </div>
  );
}
