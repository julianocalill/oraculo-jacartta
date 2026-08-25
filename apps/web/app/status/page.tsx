import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { requireTabAccess } from "../../lib/auth/access";
import { NoAccess } from "../components/no-access";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";

export const dynamic = "force-dynamic";

type SyncRun = {
  source?: string | null;
  started_at: string | null;
  finished_at: string | null;
  status: string | null;
  records_fetched?: number | null;
  records_upserted?: number | null;
  items_upserted?: number | null;
  orders_processed?: number | null;
  orders_with_error?: number | null;
  items_count?: number | null;
  orders_count?: number | null;
  vessels_targeted?: number | null;
  positions_updated?: number | null;
  error_message: string | null;
  metadata?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
};

type TokenRow = {
  updated_at: string | null;
  expires_at: string | null;
  token_type: string | null;
  scope: string | null;
};

const SP_TZ = "America/Sao_Paulo";

function todayBrt() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function brtDate(value?: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: SP_TZ
  }).format(new Date(value));
}

// Datas "YYYY-MM-DD" (order_date/issued_date) formatadas sem passar por Date:
// new Date("2026-08-22") é meia-noite UTC e exibiria o dia anterior em BRT.
function dateOnly(value: string | null | undefined) {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function count(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR").format(value);
}

function hasTokenFailure(run?: SyncRun | null) {
  const message = String(run?.error_message ?? "").toLowerCase();
  return message.includes("invalid_grant") || message.includes("token is not active");
}

const ACTIVE_RUN_MAX_AGE_MS = 90 * 60 * 1000;

function runActivityAt(run?: SyncRun | null) {
  const metadataActivity = run?.metadata?.updated_at;
  if (typeof metadataActivity === "string") return metadataActivity;
  return run?.finished_at ?? run?.started_at ?? null;
}

function hasFreshActivity(run?: SyncRun | null) {
  const activityAt = runActivityAt(run);
  if (!activityAt) return false;
  const timestamp = new Date(activityAt).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= ACTIVE_RUN_MAX_AGE_MS;
}

function isResumablePause(run?: SyncRun | null) {
  const message = String(run?.error_message ?? "").toLowerCase();
  const stopReason = String(run?.metadata?.stop_reason ?? "").toLowerCase();
  return run?.status === "failed"
    && hasFreshActivity(run)
    && (stopReason === "timeout" || (message.includes("pausa") && message.includes("resum")));
}

function runFailed(run?: SyncRun | null) {
  if (!run?.status || run.status === "success" || run.status === "partial") return false;
  if (run.status === "running") return !hasFreshActivity(run);
  return !isResumablePause(run);
}

async function latestRun(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  columns: string
): Promise<SyncRun | null> {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as SyncRun | null) ?? null;
}

async function latestStockActivity(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const [latestCompleted, stateResult] = await Promise.all([
    latestRun(
      supabase,
      "olist_stock_sync_runs",
      "started_at, finished_at, status, records_fetched, records_upserted, error_message"
    ),
    supabase
      .from("olist_stock_sync_state")
      .select("batch_id, next_offset, total, sweep_started_at, records_fetched, records_upserted, updated_at")
      .eq("id", 1)
      .maybeSingle()
  ]);

  const state = stateResult.data as {
    batch_id: string | null;
    next_offset: number;
    total: number | null;
    sweep_started_at: string | null;
    records_fetched: number;
    records_upserted: number;
    updated_at: string;
  } | null;

  if (!state?.batch_id || !state.sweep_started_at) return latestCompleted;

  return {
    started_at: state.sweep_started_at,
    // Em uma varredura aberta, esta coluna representa a última atividade.
    finished_at: state.updated_at,
    status: "running",
    records_fetched: state.records_fetched,
    records_upserted: state.records_upserted,
    error_message: state.total == null
      ? "Varredura em andamento"
      : `Varredura em andamento: ${state.next_offset} de ${state.total}`,
    metadata: { updated_at: state.updated_at }
  } satisfies SyncRun;
}

// shopee_sync_runs é multi-fonte (source = 'shopee-returns-sync:<shop_id>' etc.),
// então a última execução de uma rotina específica precisa do filtro por prefixo.
async function latestRunBySource(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  columns: string,
  sourcePrefix: string
): Promise<SyncRun | null> {
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .like("source", `${sourcePrefix}%`)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as SyncRun | null) ?? null;
}

// Rotinas Shopee agendadas por loja precisam ser avaliadas como conjunto. Ler
// só a execução mais recente esconderia uma falha em outra loja atrás de um
// sucesso posterior.
async function latestShopRunsBySource(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  sourcePrefix: string
): Promise<SyncRun | null> {
  const { data, error } = await supabase
    .from("shopee_sync_runs")
    .select("source,started_at,finished_at,status,records_fetched,records_upserted,error_message,meta")
    .like("source", `${sourcePrefix}:%`)
    .order("started_at", { ascending: false })
    .limit(40);
  if (error || !data?.length) return null;
  const latestBySource = new Map<string, SyncRun>();
  for (const row of data as SyncRun[]) {
    const source = String(row.source ?? "");
    if (source && !latestBySource.has(source)) latestBySource.set(source, row);
  }
  const runs = [...latestBySource.values()];
  const failed = runs.filter((run) => runFailed(run));
  const missingShops = Math.max(4 - runs.length, 0);
  const started = runs.map((run) => run.started_at).filter((value): value is string => Boolean(value)).sort();
  const finished = runs.map((run) => run.finished_at).filter((value): value is string => Boolean(value)).sort();
  return {
    started_at: started[0] ?? null,
    // O conjunto só está fresco quando a loja mais antiga também está fresca.
    finished_at: finished[0] ?? null,
    status: failed.length > 0 || missingShops > 0 ? "failed" : "success",
    records_fetched: runs.reduce((sum, run) => sum + Number(run.records_fetched ?? 0), 0),
    records_upserted: runs.reduce((sum, run) => {
      const wallet = Number(run.meta?.walletRecordsCycle ?? 0);
      const pending = Number(run.meta?.pendingRecordsCycle ?? 0);
      return sum + (wallet + pending || Number(run.records_upserted ?? 0));
    }, 0),
    error_message: [
      missingShops > 0 ? `${missingShops} loja(s) ainda sem execução registrada` : "",
      ...failed.map((run) => `${run.source}: ${run.error_message ?? "sem mensagem"}`)
    ].filter(Boolean).join(" · ") || null
  };
}

function olderThan(run: SyncRun | null, milliseconds: number) {
  const activity = runActivityAt(run);
  if (!activity) return true;
  const timestamp = Date.parse(activity);
  return !Number.isFinite(timestamp) || Date.now() - timestamp > milliseconds;
}

// mercadolivre_sync_runs é compartilhada com o sync principal e não tem coluna
// `source`; a rotina de devoluções se identifica em meta->>'source'.
async function latestReturnsRunML(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from("mercadolivre_sync_runs")
    .select("started_at, finished_at, status, orders_count, error_message")
    .eq("meta->>source", "mercadolivre-returns-sync")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as SyncRun | null) ?? null;
}

// O cache de NF de venda não tem tabela de runs: a saúde dele é o dia mais
// recente marcado como processado (oraculo_olist_order_ref_cache_days).
async function latestCacheDay(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from("oraculo_olist_order_ref_cache_days")
    .select("day, rows_upserted, refreshed_at")
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { day: string; rows_upserted: number; refreshed_at: string };
  return {
    started_at: row.refreshed_at,
    finished_at: row.refreshed_at,
    status: "success",
    records_upserted: row.rows_upserted,
    error_message: null
  } as SyncRun;
}

// O cache diário de quantidade (canal/SKU) também não tem tabela de runs; o
// refresh horário reescreve os últimos 10 dias, então o refreshed_at do dia
// mais recente diz quando o job rodou pela última vez. A Previsão de Vendas
// depende inteiramente dele.
async function latestQtyCacheRun(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from("oraculo_olist_qty_channel_daily_cache")
    .select("order_date, refreshed_at")
    .order("order_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { order_date: string; refreshed_at: string };
  return {
    started_at: row.refreshed_at,
    finished_at: row.refreshed_at,
    status: "success",
    error_message: null
  } as SyncRun;
}

// Cache curto (60s): é página de monitoramento, mas as rotinas rodam em
// escala de minutos/horas — 60s de defasagem não muda nenhum selo, e evita
// refazer as queries a cada F5 do operador.
const loadStatus = unstable_cache(loadStatusUncached, ["status-panel"], {
  revalidate: 60
});

// Até quando os dados realmente chegam, medido no próprio dado (não na hora em
// que o sync rodou): último dia com venda agregada e última NF emitida na base.
async function loadDataWatermarks(supabase: ReturnType<typeof createSupabaseAdminClient>) {
  const [ordersDay, invoicesDay] = await Promise.all([
    supabase
      .from("oraculo_daily_sales")
      .select("order_date")
      .order("order_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("oraculo_fiscal_daily_revenue")
      .select("issued_date")
      .order("issued_date", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  return {
    lastOrderDay: (ordersDay.data as { order_date: string } | null)?.order_date ?? null,
    lastInvoiceDay: (invoicesDay.data as { issued_date: string } | null)?.issued_date ?? null
  };
}

async function loadStatusUncached() {
  const supabase = createSupabaseAdminClient();

  const [
    tokenResult, ordersRun, stockRun, invoicesRun, backfillRun, mercadolivreRun,
    importacoesAisRun, shopeeReturnsRun, shopeeReconciliationRun, mercadolivreReturnsRun, returnsCacheRun,
    bipFulfillmentRun, qtyCacheRun, watermarks
  ] = await Promise.all([
    supabase
      .from("olist_oauth_tokens")
      .select("updated_at, expires_at, token_type, scope")
      .eq("provider", "olist")
      .maybeSingle(),
    // O sync operacional retomável grava em olist_order_sync_runs. A tabela
    // legada olist_sync_runs é usada pela carga histórica local e não pode
    // determinar a saúde dos pedidos correntes.
    latestRun(supabase, "olist_order_sync_runs", "started_at, finished_at, status, records_fetched, records_upserted, error_message, metadata"),
    latestStockActivity(supabase),
    latestRun(supabase, "olist_invoice_sync_runs", "started_at, finished_at, status, records_fetched, records_upserted, items_upserted, error_message, metadata"),
    latestRun(supabase, "olist_order_items_backfill_runs", "started_at, finished_at, status, orders_processed, orders_with_error, items_upserted, error_message"),
    latestRun(supabase, "mercadolivre_sync_runs", "started_at, finished_at, status, items_count, orders_count, error_message"),
    latestRun(supabase, "importacao_ais_sync_runs", "started_at, finished_at, status, vessels_targeted, positions_updated, error_message"),
    latestRunBySource(supabase, "shopee_sync_runs", "started_at, finished_at, status, records_fetched, records_upserted, error_message", "shopee-returns-sync"),
    latestShopRunsBySource(supabase, "shopee-reconciliation-sync"),
    latestReturnsRunML(supabase),
    latestCacheDay(supabase),
    latestRun(supabase, "bip_fulfillment_sync_runs", "started_at, finished_at, status, records_fetched, records_upserted, error_message"),
    latestQtyCacheRun(supabase),
    loadDataWatermarks(supabase)
  ]);

  const token = (tokenResult.data as TokenRow | null) ?? null;
  const today = todayBrt();
  const tokenExpired = !token?.expires_at || new Date(token.expires_at).getTime() <= Date.now();
  // Pedidos e estoque são varreduras longas e podem atravessar a meia-noite.
  // Saúde diária é a última atividade do cursor, não o instante em que a
  // varredura começou.
  const ordersNotRunToday = brtDate(runActivityAt(ordersRun)) !== today;
  const stockNotRunToday = brtDate(runActivityAt(stockRun)) !== today;
  const needsReauth = tokenExpired || hasTokenFailure(ordersRun) || hasTokenFailure(stockRun);

  const alerts = [
    tokenExpired ? "Token Olist expirado ou ausente." : "",
    hasTokenFailure(ordersRun) || hasTokenFailure(stockRun)
      ? "Olist recusou o refresh token. É necessário reautorizar o aplicativo."
      : "",
    runFailed(ordersRun) ? `Sync de pedidos falhou: ${ordersRun?.error_message ?? "sem mensagem"}` : "",
    runFailed(stockRun) ? `Sync de estoque falhou: ${stockRun?.error_message ?? "sem mensagem"}` : "",
    runFailed(invoicesRun) ? `Sync de notas falhou: ${invoicesRun?.error_message ?? "sem mensagem"}` : "",
    runFailed(mercadolivreRun)
      ? `Sync Mercado Livre falhou: ${mercadolivreRun?.error_message ?? "sem mensagem"}`
      : "",
    runFailed(importacoesAisRun)
      ? `Sync AIS das importações falhou: ${importacoesAisRun?.error_message ?? "sem mensagem"}`
      : "",
    hasTokenFailure(mercadolivreRun)
      ? "Mercado Livre recusou o refresh token. É necessário reautorizar o aplicativo."
      : "",
    ordersNotRunToday ? "Sync de pedidos ainda não rodou hoje." : "",
    stockNotRunToday ? "Sync de estoque ainda não rodou hoje." : "",
    brtDate(mercadolivreRun?.started_at) !== today
      ? "Sync do Mercado Livre ainda não rodou hoje."
      : "",
    runFailed(shopeeReturnsRun) ? `Devoluções Shopee falharam: ${shopeeReturnsRun?.error_message ?? "sem mensagem"}` : "",
    runFailed(shopeeReconciliationRun)
      ? `Reconciliação Shopee falhou: ${shopeeReconciliationRun?.error_message ?? "sem mensagem"}`
      : "",
    olderThan(shopeeReconciliationRun, 8 * 24 * 60 * 60 * 1000)
      ? "Reconciliação Shopee não foi atualizada nos últimos 8 dias."
      : "",
    runFailed(bipFulfillmentRun) ? `Espelho do Bip falhou: ${bipFulfillmentRun?.error_message ?? "sem mensagem"}` : "",
    brtDate(bipFulfillmentRun?.started_at) !== today
      ? "Espelho de expedição do Bip ainda não rodou hoje."
      : "",
    // Cache parado é falha silenciosa — a página segue servindo dado velho sem
    // erro nenhum. Já custou 45 dias de número errado neste projeto.
    brtDate(returnsCacheRun?.started_at) !== today
      ? "Cache de NF de venda (devoluções) não foi atualizado hoje."
      : "",
    brtDate(qtyCacheRun?.started_at) !== today
      ? "Cache de quantidade por canal/SKU (Previsão de Vendas) não foi atualizado hoje."
      : ""
  ].filter(Boolean);

  return {
    ok: alerts.length === 0,
    today,
    tokenExpired,
    needsReauth,
    token,
    alerts,
    watermarks,
    // `coverage` responde "o que esta rotina cobre e com que atraso" — a coluna
    // Início/Fim diz quando rodou, mas não até onde o dado chega.
    runs: [
      {
        key: "orders",
        label: "Pedidos",
        run: ordersRun,
        coverage: "Pedidos Olist alterados numa janela móvel de ~3 dias; a varredura completa leva horas, então o dia corrente entra com atraso"
      },
      {
        key: "stock",
        label: "Estoque / produtos",
        run: stockRun,
        coverage: "Estoque por depósito em varredura contínua (cursor, 2× por hora); cadastro completo de produtos 1× ao dia de madrugada"
      },
      {
        key: "invoices",
        label: "Notas fiscais",
        run: invoicesRun,
        coverage: "NFs novas a cada 15 min; varredura de segurança do histórico 1× ao dia"
      },
      {
        key: "backfill",
        label: "Backfill de itens",
        run: backfillRun,
        coverage: "Completa itens de pedidos antigos; roda só de madrugada"
      },
      {
        key: "mercadolivre",
        label: "Mercado Livre (Full)",
        run: mercadolivreRun,
        coverage: "Pedidos e estoque Full a cada hora"
      },
      {
        key: "importacoes-ais",
        label: "Importações (AIS)",
        run: importacoesAisRun,
        coverage: "Posição dos navios a cada 6 h; só há sinal perto da costa — navio em alto-mar sem posição é normal"
      },
      {
        key: "shopee-returns",
        label: "Devoluções Shopee",
        run: shopeeReturnsRun,
        coverage: "Devoluções das 4 lojas, cada loja a cada 2 h"
      },
      {
        key: "shopee-reconciliation",
        label: "Reconciliação Shopee",
        run: shopeeReconciliationRun,
        coverage: "Carteira liberada, pendências e previsão das 4 lojas; ciclo semanal retomável por loja"
      },
      {
        key: "mercadolivre-returns",
        label: "Devoluções / claims ML",
        run: mercadolivreReturnsRun,
        coverage: "Devoluções e claims a cada hora"
      },
      {
        key: "returns-cache",
        label: "Cache NF de venda (devoluções)",
        run: returnsCacheRun,
        coverage: "Reprocessa as NFs de venda dos últimos 3 dias, 2× por hora"
      },
      {
        key: "bip-fulfillment",
        label: "Expedição · espelho do Bip",
        run: bipFulfillmentRun,
        coverage: "Espelho das bipagens a cada 2 min — praticamente tempo real"
      },
      {
        key: "qty-cache",
        label: "Cache de quantidade (Previsão de Vendas)",
        run: qtyCacheRun,
        coverage: "Reescreve os últimos 10 dias de quantidade por canal/SKU, de hora em hora"
      }
    ]
  };
}

function runBadge(run: SyncRun | null) {
  if (!run) return { label: "Sem execução", cls: "signal-muted" };
  if (run.status === "success") return { label: "OK", cls: "signal-good" };
  if (run.status === "partial") return { label: "Parcial", cls: "signal-warning" };
  if (isResumablePause(run)) return { label: "Retomando", cls: "signal-warning" };
  if (run.status === "running" && hasFreshActivity(run)) return { label: "Rodando", cls: "signal-warning" };
  if (run.status === "running") return { label: "Sem atividade", cls: "signal-danger" };
  return { label: "Falhou", cls: "signal-danger" };
}

function runMessage(run: SyncRun | null) {
  if (isResumablePause(run)) return "Pausa controlada; retomada automática no próximo ciclo.";
  return run?.error_message ?? "—";
}

export default async function StatusPage() {
  const [{ allowed }, alertCount, data] = await Promise.all([
    requireTabAccess("status"),
    loadActionableAlertCount(),
    loadStatus()
  ]);
  if (!allowed) return <NoAccess tab="status" />;

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Status do sync</h1>
          <p>
            Saúde das integrações e até onde os dados chegam · referência {data.today} (America/Sao_Paulo).
            A coluna Cobertura diz o que cada rotina varre e com que atraso.
          </p>
        </div>
        <span className={`status-pill ${data.ok ? "signal-good" : "signal-danger"}`}>
          {data.ok ? "Tudo operacional" : `${data.alerts.length} alerta(s)`}
        </span>
      </header>

      {data.alerts.length > 0 && (
        <section className="status-alerts">
          {data.alerts.map((alert) => (
            <div key={alert} className="status-alert">{alert}</div>
          ))}
        </section>
      )}

      {/* Cobertura medida no dado em si: até quando pedidos e NFs chegam na base. */}
      <section className="metric-grid metric-grid-eight">
        <article className={`metric ${data.watermarks.lastOrderDay === data.today ? "accent-blue" : "accent-red"}`}>
          <span className="label">Pedidos na base até</span>
          <strong>{dateOnly(data.watermarks.lastOrderDay)}</strong>
          <small>Último dia com venda registrada · o dia corrente entra com atraso</small>
        </article>
        <article className={`metric ${data.watermarks.lastInvoiceDay === data.today ? "accent-blue" : "accent-red"}`}>
          <span className="label">NFs na base até</span>
          <strong>{dateOnly(data.watermarks.lastInvoiceDay)}</strong>
          <small>Última nota fiscal emitida já sincronizada</small>
        </article>
        <article className={`metric ${data.tokenExpired ? "accent-red" : "accent-blue"}`}>
          <span className="label">Token Olist</span>
          <strong>{data.tokenExpired ? "Expirado" : "Válido"}</strong>
          <small>Tipo {data.token?.token_type ?? "—"}</small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Expira em</span>
          <strong>{dateTime(data.token?.expires_at)}</strong>
          <small>Renovação automática pelo sync</small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Token atualizado</span>
          <strong>{dateTime(data.token?.updated_at)}</strong>
          <small>Último refresh persistido</small>
        </article>
        <article className={`metric ${data.needsReauth ? "accent-red" : "accent-blue"}`}>
          <span className="label">Reautorização</span>
          <strong>{data.needsReauth ? "Necessária" : "Não"}</strong>
          <small>OAuth do aplicativo Olist</small>
        </article>
      </section>

      <section className="panel product-panel">
        <div className="sku-toolbar">
          <div>
            <p className="eyebrow">Integrações</p>
            <h2>Últimas execuções</h2>
          </div>
        </div>
        <div className="table-wrap dense-table-wrap">
          <table className="data-table dense-table">
            <thead>
              <tr>
                <th>Sync</th>
                <th>Status</th>
                <th>Cobertura</th>
                <th>Início</th>
                <th>Fim / atividade</th>
                <th className="numeric">Registros</th>
                <th>Erro</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map(({ key, label, run, coverage }) => {
                const badge = runBadge(run);
                const records = run?.records_upserted ?? run?.items_upserted ?? run?.orders_processed ?? run?.items_count ?? run?.positions_updated ?? null;
                return (
                  <tr key={key}>
                    <td>{label}</td>
                    <td><span className={badge.cls}>{badge.label}</span></td>
                    <td className="muted-cell">{coverage}</td>
                    <td>{dateTime(run?.started_at)}</td>
                    <td>{dateTime(run?.finished_at)}</td>
                    <td className="numeric">{count(records)}</td>
                    <td>{runMessage(run)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
