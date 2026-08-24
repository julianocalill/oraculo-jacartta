import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { requireTabAccess } from "../../lib/auth/access";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { AppShell } from "../components/app-shell";
import { MetricCard } from "../components/metric-card";
import { NoAccess } from "../components/no-access";

export const dynamic = "force-dynamic";

type Summary = {
  total_packages: number;
  tracking_available: number;
  commercial_scanned: number;
  logistics_received: number;
  carrier_collected: number;
  pending_commercial: number;
  between_departments: number;
  waiting_carrier: number;
  divergences: number;
  overdue: number;
  avg_minutes_commercial_to_logistics: number | null;
  avg_minutes_logistics_to_carrier: number | null;
  shopee_refreshed_at: string | null;
  bip_refreshed_at: string | null;
};

type Daily = {
  due_day: string;
  total_packages: number;
  commercial_scanned: number;
  logistics_received: number;
  carrier_collected: number;
  divergences: number;
};

type SalesDaily = {
  sale_day: string;
  sold_orders: number;
  sold_units: number;
  packages_from_sold_orders: number;
  sold_orders_without_package: number;
  orders_without_tracking: number;
  data_refreshed_at: string | null;
};

type Shop = {
  shop_id: number;
  shop_name: string | null;
  total_packages: number;
  commercial_scanned: number;
  logistics_received: number;
  carrier_collected: number;
  overdue: number;
};

type ExceptionRow = {
  shop_name: string | null;
  tracking_number: string | null;
  pipeline_status: string;
  ship_by_at: string | null;
  commercial_scanned_at: string | null;
  logistics_received_at: string | null;
};

const nf = new Intl.NumberFormat("pt-BR");
const pct = (value: number, total: number) => total ? `${((value / total) * 100).toFixed(1).replace(".", ",")}%` : "0%";
const count = (value: number | null | undefined) => nf.format(Number(value ?? 0));
const minutes = (value: number | null | undefined) => value == null ? "—" : `${Math.round(Number(value))} min`;
const dateTime = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
  : "—";

function dayBrt(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

function validDay(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function maskTracking(value: string | null) {
  if (!value) return "Sem rastreio";
  return value.length > 9 ? `${value.slice(0, 4)}••••${value.slice(-4)}` : value;
}

const STATUS_LABEL: Record<string, string> = {
  pending_commercial: "Pendente no Comercial",
  between_departments: "Entre Comercial e Logística",
  waiting_carrier: "Aguardando coleta",
  divergence_carrier_without_logistics: "Coletado sem bip da Logística",
  divergence_logistics_without_commercial: "Logística sem bip do Comercial"
};

async function loadData(from: string, to: string) {
  const supabase = createSupabaseAdminClient();
  const [summary, daily, salesDaily, shops, exceptions] = await Promise.all([
    supabase.rpc("oraculo_fulfillment_summary", { p_from: from, p_to: to, p_shop_id: null }),
    supabase.rpc("oraculo_fulfillment_daily", { p_from: from, p_to: to, p_shop_id: null }),
    supabase.rpc("oraculo_fulfillment_sales_daily", { p_from: from, p_to: to, p_shop_id: null }),
    supabase.rpc("oraculo_fulfillment_by_shop", { p_from: from, p_to: to }),
    supabase
      .from("oraculo_fulfillment_pipeline")
      .select("shop_name,tracking_number,pipeline_status,ship_by_at,commercial_scanned_at,logistics_received_at")
      .gte("due_day", from)
      .lte("due_day", to)
      .in("pipeline_status", [
        "pending_commercial",
        "between_departments",
        "waiting_carrier",
        "divergence_carrier_without_logistics",
        "divergence_logistics_without_commercial"
      ])
      .order("ship_by_at", { ascending: true })
      .limit(100)
  ]);

  return {
    summary: ((summary.data ?? [])[0] ?? null) as Summary | null,
    daily: (daily.data ?? []) as Daily[],
    salesDaily: (salesDaily.data ?? []) as SalesDaily[],
    shops: (shops.data ?? []) as Shop[],
    exceptions: (exceptions.data ?? []) as ExceptionRow[],
    error: summary.error?.message || daily.error?.message || salesDaily.error?.message || shops.error?.message || exceptions.error?.message || null
  };
}

export default async function ExpedicaoPage({
  searchParams
}: {
  searchParams: Promise<{ de?: string; ate?: string }>;
}) {
  const [{ allowed }, alertCount, params] = await Promise.all([
    requireTabAccess("expedicao"),
    loadActionableAlertCount(),
    searchParams
  ]);
  if (!allowed) return <NoAccess tab="expedicao" />;

  const today = dayBrt();
  const weekAgoDate = new Date(`${today}T12:00:00-03:00`);
  weekAgoDate.setDate(weekAgoDate.getDate() - 6);
  const from = validDay(params.de, dayBrt(weekAgoDate));
  const to = validDay(params.ate, today);
  const data = await loadData(from, to);
  const summary = data.summary ?? {
    total_packages: 0, tracking_available: 0, commercial_scanned: 0,
    logistics_received: 0, carrier_collected: 0, pending_commercial: 0,
    between_departments: 0, waiting_carrier: 0, divergences: 0, overdue: 0,
    avg_minutes_commercial_to_logistics: null, avg_minutes_logistics_to_carrier: null,
    shopee_refreshed_at: null, bip_refreshed_at: null
  };
  const sales = data.salesDaily.reduce((total, row) => ({
    soldOrders: total.soldOrders + Number(row.sold_orders),
    soldUnits: total.soldUnits + Number(row.sold_units),
    packages: total.packages + Number(row.packages_from_sold_orders),
    missingPackages: total.missingPackages + Number(row.sold_orders_without_package)
  }), { soldOrders: 0, soldUnits: 0, packages: 0, missingPackages: 0 });
  const salesUpdatedAt = data.salesDaily.reduce<string | null>((latest, row) => {
    if (!row.data_refreshed_at) return latest;
    return !latest || row.data_refreshed_at > latest ? row.data_refreshed_at : latest;
  }, null);
  const salesByDay = new Map(data.salesDaily.map((row) => [row.sale_day, row]));
  const fulfillmentByDay = new Map(data.daily.map((row) => [row.due_day, row]));
  const historyDays = [...new Set([...salesByDay.keys(), ...fulfillmentByDay.keys()])].sort();

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Expedição</h1>
          <p>Shopee → Comercial → Logística → coleta, conciliado por pacote e rastreio.</p>
        </div>
        <form className="filter-form filter-row" method="get">
          <label><span>De</span><input type="date" name="de" defaultValue={from} /></label>
          <label><span>Até</span><input type="date" name="ate" defaultValue={to} /></label>
          <button type="submit">Aplicar</button>
        </form>
      </header>

      {data.error ? (
        <section className="status-alerts"><div className="status-alert status-alert-critical">Funil ainda não disponível: {data.error}</div></section>
      ) : null}

      <section>
        <div className="section-head"><p className="eyebrow">Vendas no período</p><h2>O que foi vendido</h2></div>
        <div className="metric-grid">
          <MetricCard accent="accent-blue" label="Pedidos pagos" value={count(sales.soldOrders)} caption="Pela data de pagamento na Shopee" />
          <MetricCard accent="accent-violet" label="Unidades vendidas" value={count(sales.soldUnits)} caption="Quantidade somada dos itens" />
          <MetricCard accent="accent-cyan" label="Pacotes dessas vendas" value={count(sales.packages)} caption="Um pedido pode gerar mais de um pacote" />
          <MetricCard accent={sales.missingPackages ? "accent-red" : "accent-green"} label="Vendas sem pacote" value={count(sales.missingPackages)} caption={sales.missingPackages ? "Exigem correção na sincronização" : "Cobertura completa no período"} />
        </div>
        <p className="muted">Vendas atualizadas em {dateTime(salesUpdatedAt)}. A Shopee sincroniza cada loja a cada 15 minutos.</p>
      </section>

      <section>
        <div className="section-head"><p className="eyebrow">Carga operacional</p><h2>O que precisa ser expedido pelo prazo</h2></div>
        <div className="metric-grid fulfillment-metric-grid">
          <MetricCard accent="accent-blue" label="Pacotes com prazo" value={count(summary.total_packages)} caption={`${count(summary.tracking_available)} com rastreio disponível`} />
          <MetricCard accent="accent-violet" label="Bipados Comercial" value={count(summary.commercial_scanned)} caption={`${pct(summary.commercial_scanned, summary.total_packages)} da carga`} />
          <MetricCard accent="accent-cyan" label="Recebidos Logística" value={count(summary.logistics_received)} caption={`${pct(summary.logistics_received, summary.total_packages)} da carga`} />
          <MetricCard accent="accent-green" label="Coleta confirmada" value={count(summary.carrier_collected)} caption={`${pct(summary.carrier_collected, summary.total_packages)} da carga`} />
          <MetricCard accent="accent-red" label="Fora do prazo" value={count(summary.overdue)} caption={`${count(summary.divergences)} divergências de sequência`} />
        </div>
      </section>

      <section className="panel fulfillment-funnel-panel">
        <div className="section-head"><p className="eyebrow">Funil consolidado</p><h2>Onde os pacotes estão parando</h2></div>
        <div className="fulfillment-funnel">
          {[
            ["Shopee", summary.total_packages, "pacotes pelo prazo de envio"],
            ["Comercial", summary.commercial_scanned, `${summary.pending_commercial} pendentes`],
            ["Logística", summary.logistics_received, `${summary.between_departments} entre setores`],
            ["Coleta", summary.carrier_collected, `${summary.waiting_carrier} aguardando`]
          ].map(([label, value, detail], index) => (
            <div className="fulfillment-step" key={String(label)}>
              <span>{index + 1}</span><div><small>{label}</small><strong>{count(Number(value))}</strong><em>{detail}</em></div>
            </div>
          ))}
        </div>
      </section>

      <section className="fulfillment-two-columns">
        <article className="panel">
          <div className="section-head"><p className="eyebrow">Tempo entre etapas</p><h2>Velocidade operacional</h2></div>
          <div className="fulfillment-sla-grid">
            <div><span>Comercial → Logística</span><strong>{minutes(summary.avg_minutes_commercial_to_logistics)}</strong></div>
            <div><span>Logística → Coleta</span><strong>{minutes(summary.avg_minutes_logistics_to_carrier)}</strong></div>
          </div>
          <p className="muted">Shopee atualizada em {dateTime(summary.shopee_refreshed_at)} · Bip atualizado em {dateTime(summary.bip_refreshed_at)}.</p>
        </article>

        <article className="panel">
          <div className="section-head"><p className="eyebrow">Lojas</p><h2>Conclusão por operação</h2></div>
          <div className="table-wrap">
            <table className="data-table dense-table">
              <thead><tr><th>Loja</th><th>Pacotes</th><th>Comercial</th><th>Logística</th><th>Coleta</th><th>Atrasados</th></tr></thead>
              <tbody>{data.shops.map((shop) => (
                <tr key={shop.shop_id}><td>{shop.shop_name ?? shop.shop_id}</td><td>{count(shop.total_packages)}</td><td>{count(shop.commercial_scanned)}</td><td>{count(shop.logistics_received)}</td><td>{count(shop.carrier_collected)}</td><td>{count(shop.overdue)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="section-head"><p className="eyebrow">Exceções acionáveis</p><h2>Pacotes que ainda exigem atenção</h2></div>
        <div className="table-wrap dense-table-wrap">
          <table className="data-table dense-table">
            <thead><tr><th>Loja</th><th>Rastreio</th><th>Situação</th><th>Prazo</th><th>Comercial</th><th>Logística</th></tr></thead>
            <tbody>
              {data.exceptions.length ? data.exceptions.map((row, index) => (
                <tr key={`${row.tracking_number}-${index}`}><td>{row.shop_name ?? "Shopee"}</td><td className="numeric">{maskTracking(row.tracking_number)}</td><td>{STATUS_LABEL[row.pipeline_status] ?? row.pipeline_status}</td><td>{dateTime(row.ship_by_at)}</td><td>{dateTime(row.commercial_scanned_at)}</td><td>{dateTime(row.logistics_received_at)}</td></tr>
              )) : <tr><td colSpan={6}>Nenhuma exceção no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-head"><p className="eyebrow">Histórico diário</p><h2>Venda e prazo de envio, sem misturar as datas</h2></div>
        <div className="table-wrap dense-table-wrap">
          <table className="data-table dense-table">
            <thead><tr><th>Dia</th><th>Pedidos pagos</th><th>Unidades vendidas</th><th>Pacotes com prazo</th><th>Comercial</th><th>Logística</th><th>Coleta</th><th>Divergências</th></tr></thead>
            <tbody>{historyDays.map((day) => {
              const sale = salesByDay.get(day);
              const fulfillment = fulfillmentByDay.get(day);
              const totalPackages = Number(fulfillment?.total_packages ?? 0);
              return (
                <tr key={day}>
                  <td>{new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}</td>
                  <td>{count(sale?.sold_orders)}</td>
                  <td>{count(sale?.sold_units)}</td>
                  <td>{count(totalPackages)}</td>
                  <td>{count(fulfillment?.commercial_scanned)} · {pct(Number(fulfillment?.commercial_scanned ?? 0), totalPackages)}</td>
                  <td>{count(fulfillment?.logistics_received)} · {pct(Number(fulfillment?.logistics_received ?? 0), totalPackages)}</td>
                  <td>{count(fulfillment?.carrier_collected)} · {pct(Number(fulfillment?.carrier_collected ?? 0), totalPackages)}</td>
                  <td>{count(fulfillment?.divergences)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
        <p className="muted">Pedidos e unidades usam a data do pagamento. As etapas operacionais usam o prazo de envio informado pela Shopee.</p>
      </section>
    </AppShell>
  );
}
