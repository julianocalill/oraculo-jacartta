import Link from "next/link";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { requireCurrentUser } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

type SyncRun = {
  started_at: string | null;
  finished_at: string | null;
  status: string | null;
  records_fetched?: number | null;
  records_upserted?: number | null;
  items_upserted?: number | null;
  orders_processed?: number | null;
  orders_with_error?: number | null;
  error_message: string | null;
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

function count(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("pt-BR").format(value);
}

function hasTokenFailure(run?: SyncRun | null) {
  const message = String(run?.error_message ?? "").toLowerCase();
  return message.includes("invalid_grant") || message.includes("token is not active");
}

function runFailed(run?: SyncRun | null) {
  return Boolean(run && run.status && run.status !== "success" && run.status !== "partial");
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

async function loadStatus() {
  const supabase = createSupabaseAdminClient();

  const [tokenResult, ordersRun, stockRun, invoicesRun, backfillRun] = await Promise.all([
    supabase
      .from("olist_oauth_tokens")
      .select("updated_at, expires_at, token_type, scope")
      .eq("provider", "olist")
      .maybeSingle(),
    latestRun(supabase, "olist_sync_runs", "started_at, finished_at, status, records_fetched, records_upserted, error_message"),
    latestRun(supabase, "olist_stock_sync_runs", "started_at, finished_at, status, records_fetched, records_upserted, error_message"),
    latestRun(supabase, "olist_invoice_sync_runs", "started_at, finished_at, status, records_fetched, records_upserted, items_upserted, error_message"),
    latestRun(supabase, "olist_order_items_backfill_runs", "started_at, finished_at, status, orders_processed, orders_with_error, items_upserted, error_message")
  ]);

  const token = (tokenResult.data as TokenRow | null) ?? null;
  const today = todayBrt();
  const tokenExpired = !token?.expires_at || new Date(token.expires_at).getTime() <= Date.now();
  const ordersNotRunToday = brtDate(ordersRun?.started_at) !== today;
  const stockNotRunToday = brtDate(stockRun?.started_at) !== today;
  const needsReauth = tokenExpired || hasTokenFailure(ordersRun) || hasTokenFailure(stockRun);

  const alerts = [
    tokenExpired ? "Token Olist expirado ou ausente." : "",
    hasTokenFailure(ordersRun) || hasTokenFailure(stockRun)
      ? "Olist recusou o refresh token. É necessário reautorizar o aplicativo."
      : "",
    runFailed(ordersRun) ? `Sync de pedidos falhou: ${ordersRun?.error_message ?? "sem mensagem"}` : "",
    runFailed(stockRun) ? `Sync de estoque falhou: ${stockRun?.error_message ?? "sem mensagem"}` : "",
    runFailed(invoicesRun) ? `Sync de notas falhou: ${invoicesRun?.error_message ?? "sem mensagem"}` : "",
    ordersNotRunToday ? "Sync de pedidos ainda não rodou hoje." : "",
    stockNotRunToday ? "Sync de estoque ainda não rodou hoje." : ""
  ].filter(Boolean);

  return {
    ok: alerts.length === 0,
    today,
    tokenExpired,
    needsReauth,
    token,
    alerts,
    runs: [
      { key: "orders", label: "Pedidos", run: ordersRun },
      { key: "stock", label: "Estoque / produtos", run: stockRun },
      { key: "invoices", label: "Notas fiscais", run: invoicesRun },
      { key: "backfill", label: "Backfill de itens", run: backfillRun }
    ]
  };
}

function runBadge(run: SyncRun | null) {
  if (!run) return { label: "Sem execução", cls: "signal-muted" };
  if (run.status === "success") return { label: "OK", cls: "signal-good" };
  if (run.status === "partial") return { label: "Parcial", cls: "signal-warning" };
  if (run.status === "running") return { label: "Rodando", cls: "signal-warning" };
  return { label: "Falhou", cls: "signal-danger" };
}

export default async function StatusPage() {
  await requireCurrentUser();
  const data = await loadStatus();

  return (
    <main className="workspace single-workspace">
      <header className="topbar">
        <div>
          <Link href="/" className="back-link">← Analytics</Link>
          <h1>Status do sync</h1>
          <p>Saúde das integrações Olist · referência {data.today} (America/Sao_Paulo)</p>
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

      <section className="metric-grid metric-grid-eight">
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
                <th>Início</th>
                <th>Fim</th>
                <th className="numeric">Registros</th>
                <th>Erro</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map(({ key, label, run }) => {
                const badge = runBadge(run);
                const records = run?.records_upserted ?? run?.items_upserted ?? run?.orders_processed ?? null;
                return (
                  <tr key={key}>
                    <td>{label}</td>
                    <td><span className={badge.cls}>{badge.label}</span></td>
                    <td>{dateTime(run?.started_at)}</td>
                    <td>{dateTime(run?.finished_at)}</td>
                    <td className="numeric">{count(records)}</td>
                    <td>{run?.error_message ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
