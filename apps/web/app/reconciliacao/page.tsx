import Link from "next/link";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { requireTabAccess } from "../../lib/auth/access";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { HINTS } from "../../lib/column-hints";
import { AppShell } from "../components/app-shell";
import { MetricCard } from "../components/metric-card";
import { NoAccess } from "../components/no-access";
import { SortableTable, type SortableCell } from "../components/sortable-table";

export const dynamic = "force-dynamic";

type ReconciliationRow = {
  id: string;
  shop_id: number;
  shop_name: string | null;
  order_sn: string;
  order_created_at: string | null;
  order_status: string | null;
  gross_order_amount: number | string | null;
  invoice_total_amount: number | string | null;
  invoice_numbers: string[] | null;
  invoice_count: number | null;
  amount_to_receive: number | string | null;
  wallet_paid_amount: number | string | null;
  wallet_balance_after: number | string | null;
  wallet_credit_at: string | null;
  income_status: "pending" | "released" | "closed";
  income_status_label: string | null;
  estimated_release_at: string | null;
  gross_nf_difference: number | string | null;
  wallet_difference: number | string | null;
  reconciliation_status: string;
  source_synced_at: string;
};

type Shop = { shop_id: number; shop_name: string | null };

type ReconciliationSummary = {
  orders_count: number | string | null;
  gross_amount: number | string | null;
  invoice_amount: number | string | null;
  pending_count: number | string | null;
  pending_amount: number | string | null;
  released_count: number | string | null;
  paid_amount: number | string | null;
  attention_count: number | string | null;
  missing_invoice_count: number | string | null;
  last_synced_at: string | null;
};

type SearchParams = {
  inicio?: string;
  fim?: string;
  loja?: string;
  situacao?: string;
  pagina?: string;
};

const PAGE_SIZE = 100;
const SP_TZ = "America/Sao_Paulo";

function dateInSaoPaulo(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function currentMonthStart() {
  return `${dateInSaoPaulo().slice(0, 7)}-01`;
}

function safeDate(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function nextDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

function n(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown) {
  const parsed = nOrNull(value);
  if (parsed == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(parsed);
}

function count(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: SP_TZ
  }).format(new Date(value));
}

function dateOnly(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: SP_TZ
  }).format(new Date(value));
}

function statusBadge(row: ReconciliationRow) {
  if (row.income_status === "pending") return "status-pill signal-warning";
  if (row.income_status === "closed") return "status-pill signal-muted";
  return "status-pill signal-good";
}

function alertCell(row: ReconciliationRow): SortableCell {
  if (row.reconciliation_status === "ok") {
    return { text: "Confere", sort: 0, badge: "status-pill signal-good" };
  }
  if (row.reconciliation_status === "pending") {
    return { text: "A receber", sort: 1, badge: "status-pill signal-warning" };
  }
  if (row.reconciliation_status === "closed") {
    return { text: "Encerrado", sort: 2, badge: "status-pill signal-muted" };
  }
  if (row.reconciliation_status === "divergent") {
    return {
      text: "Divergente",
      sort: 4,
      badge: "status-pill signal-danger",
      subtitle: `Diferença ${money(row.wallet_difference)}`
    };
  }
  return {
    text: "Dado ausente",
    sort: 3,
    badge: "status-pill signal-danger",
    subtitle: row.reconciliation_status === "missing_wallet_credit" ? "Crédito não localizado" : "Líquido não localizado"
  };
}

function applySituation<T extends {
  eq: (column: string, value: string) => T;
  neq: (column: string, value: string) => T;
  not: (column: string, operator: string, value: string) => T;
}>(query: T, situation: string): T {
  if (situation === "pending") return query.eq("income_status", "pending");
  if (situation === "released") return query.eq("income_status", "released");
  if (situation === "attention") return query.not("reconciliation_status", "in", "(ok,pending,closed)");
  return query.neq("income_status", "closed");
}

async function loadRows(start: string, end: string, shop: string, situation: string, page: number) {
  const supabase = createSupabaseAdminClient();
  const from = (page - 1) * PAGE_SIZE;
  let query = supabase
    .from("shopee_order_reconciliation")
    .select("id,shop_id,shop_name,order_sn,order_created_at,order_status,gross_order_amount,invoice_total_amount,invoice_numbers,invoice_count,amount_to_receive,wallet_paid_amount,wallet_balance_after,wallet_credit_at,income_status,income_status_label,estimated_release_at,gross_nf_difference,wallet_difference,reconciliation_status,source_synced_at", { count: "exact" })
    .gte("order_created_at", `${start}T00:00:00-03:00`)
    .lt("order_created_at", `${nextDate(end)}T00:00:00-03:00`)
    .order("order_created_at", { ascending: false })
    .order("id")
    .range(from, from + PAGE_SIZE - 1);
  if (shop !== "all") query = query.eq("shop_id", Number(shop));
  query = applySituation(query, situation);
  const { data, error, count: total } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as ReconciliationRow[], total: total ?? 0 };
}

async function loadSummary(start: string, end: string, shop: string, situation: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("shopee_reconciliation_summary", {
    p_start: `${start}T00:00:00-03:00`,
    p_end_exclusive: `${nextDate(end)}T00:00:00-03:00`,
    p_shop_id: shop === "all" ? null : Number(shop),
    p_situation: situation
  });
  if (error) throw error;
  return ((data ?? [])[0] ?? {
    orders_count: 0,
    gross_amount: 0,
    invoice_amount: 0,
    pending_count: 0,
    pending_amount: 0,
    released_count: 0,
    paid_amount: 0,
    attention_count: 0,
    missing_invoice_count: 0,
    last_synced_at: null
  }) as ReconciliationSummary;
}

async function loadShops() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("shopee_shops")
    .select("shop_id,shop_name")
    .eq("is_active", true)
    .order("shop_name");
  if (error) throw error;
  return (data ?? []) as Shop[];
}

export default async function ReconciliacaoPage({
  searchParams
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const today = dateInSaoPaulo();
  const start = safeDate(params.inicio, currentMonthStart());
  const requestedEnd = safeDate(params.fim, today);
  const end = requestedEnd < start ? start : requestedEnd;
  const shop = params.loja && /^\d+$/.test(params.loja) ? params.loja : "all";
  const situation = ["all", "pending", "released", "attention"].includes(params.situacao ?? "")
    ? String(params.situacao)
    : "all";
  const requestedPage = Number(params.pagina ?? 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const [{ allowed }, alertCount, rowResult, summary, shops] = await Promise.all([
    requireTabAccess("reconciliacao"),
    loadActionableAlertCount(),
    loadRows(start, end, shop, situation, page),
    loadSummary(start, end, shop, situation),
    loadShops()
  ]);
  if (!allowed) return <NoAccess tab="reconciliacao" />;

  const rows = rowResult.rows;
  const total = rowResult.total;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(page * PAGE_SIZE, total);
  const attention = n(summary.attention_count);
  const pageHref = (targetPage: number) => {
    const query = new URLSearchParams({
      inicio: start,
      fim: end,
      loja: shop,
      situacao: situation,
      pagina: String(targetPage)
    });
    return `/reconciliacao?${query.toString()}`;
  };

  const tableRows: SortableCell[][] = rows.map((row) => {
    const grossNfDiff = nOrNull(row.gross_nf_difference);
    const releaseText = row.income_status === "released"
      ? dateTime(row.wallet_credit_at)
      : row.estimated_release_at
        ? dateTime(row.estimated_release_at)
        : "Aguardando conclusão";
    return [
      { text: dateOnly(row.order_created_at), sort: row.order_created_at },
      { text: row.shop_name ?? String(row.shop_id), sort: row.shop_name ?? row.shop_id },
      { text: row.order_sn, sort: row.order_sn, subtitle: row.order_status ?? undefined },
      { text: money(row.gross_order_amount), sort: nOrNull(row.gross_order_amount) },
      {
        text: money(row.invoice_total_amount),
        sort: nOrNull(row.invoice_total_amount),
        subtitle: row.invoice_count
          ? `${row.invoice_numbers?.join(", ") ?? `${row.invoice_count} NF(s)`}${grossNfDiff != null && Math.abs(grossNfDiff) > 0.01 ? ` · bruto − NF ${money(grossNfDiff)}` : ""}`
          : "NF não localizada"
      },
      { text: money(row.amount_to_receive), sort: nOrNull(row.amount_to_receive) },
      { text: money(row.wallet_paid_amount), sort: nOrNull(row.wallet_paid_amount) },
      { text: money(row.wallet_balance_after), sort: nOrNull(row.wallet_balance_after) },
      {
        text: row.income_status === "released" ? "Liberado" : row.income_status === "pending" ? "Pendente" : "Encerrado",
        sort: row.income_status,
        badge: statusBadge(row),
        subtitle: row.income_status_label ?? undefined
      },
      {
        text: releaseText,
        sort: row.wallet_credit_at ?? row.estimated_release_at,
        subtitle: row.income_status === "released" ? "Crédito na carteira" : row.estimated_release_at ? "Previsão da Shopee" : "Shopee ainda não informou uma data"
      },
      alertCell(row)
    ];
  });

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Reconciliação</h1>
          <p>
            Pedido Shopee × NF Olist × líquido previsto × crédito real da carteira
            {summary.last_synced_at ? ` · atualizado em ${dateTime(summary.last_synced_at)}` : ""}
          </p>
        </div>
        <form className="filter-row filter-form" method="get">
          <label>
            <span>Início</span>
            <input type="date" name="inicio" defaultValue={start} />
          </label>
          <label>
            <span>Fim</span>
            <input type="date" name="fim" defaultValue={end} />
          </label>
          <label>
            <span>Loja</span>
            <select name="loja" defaultValue={shop}>
              <option value="all">Todas</option>
              {shops.map((item) => (
                <option key={item.shop_id} value={item.shop_id}>{item.shop_name ?? item.shop_id}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Situação</span>
            <select name="situacao" defaultValue={situation}>
              <option value="all">Todas</option>
              <option value="pending">Pendentes</option>
              <option value="released">Liberados</option>
              <option value="attention">Com alerta</option>
            </select>
          </label>
          <button type="submit">Aplicar</button>
        </form>
      </header>

      <section className="metric-grid">
        <MetricCard accent="accent-blue" label="Pedidos" value={count(n(summary.orders_count))} caption={`${money(summary.gross_amount)} em valor bruto`} />
        <MetricCard accent="accent-violet" label="Valor das NFs" value={money(summary.invoice_amount)} caption={n(summary.missing_invoice_count) ? `${count(n(summary.missing_invoice_count))} pedidos sem NF localizada` : "NF localizada em todos os pedidos"} />
        <MetricCard accent="accent-yellow" label="Pendente a receber" value={money(summary.pending_amount)} caption={`${count(n(summary.pending_count))} pedidos ainda não liberados`} />
        <MetricCard accent="accent-green" label="Pago na carteira" value={money(summary.paid_amount)} caption={`${count(n(summary.released_count))} pedidos liberados`} />
        <MetricCard accent={attention ? "accent-red" : "accent-green"} label="Alertas" value={count(attention)} caption={attention ? "diferença de repasse ou líquido esperado ausente" : "créditos conferem com o líquido"} />
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Pedido a pedido</p>
          <h2>Conferência financeira</h2>
        </div>
        <p className="muted">
          O filtro usa a data do pedido. “Saldo após” é o saldo total da carteira depois daquele crédito;
          o valor pago do pedido está na coluna anterior. Diferença entre bruto e NF pode ser frete pago pelo comprador.
        </p>
        <div className="filter-row">
          <span className="muted">Mostrando {count(firstShown)}–{count(lastShown)} de {count(total)} · página {count(page)} de {count(totalPages)}</span>
          {page > 1 ? <Link className="button-link" href={pageHref(page - 1)}>← Anterior</Link> : null}
          {page < totalPages ? <Link className="button-link" href={pageHref(page + 1)}>Próxima →</Link> : null}
        </div>
        <SortableTable
          initialSort={0}
          initialDir="desc"
          columns={[
            { label: "Data", hint: HINTS.reconciliacaoData },
            { label: "Loja" },
            { label: "Pedido" },
            { label: "Bruto", numeric: true, hint: HINTS.reconciliacaoBruto },
            { label: "NF", numeric: true, hint: HINTS.reconciliacaoNf },
            { label: "A receber", numeric: true, hint: HINTS.reconciliacaoAReceber },
            { label: "Pago carteira", numeric: true, hint: HINTS.reconciliacaoPago },
            { label: "Saldo após", numeric: true, hint: HINTS.reconciliacaoSaldo },
            { label: "Situação" },
            { label: "Liberação" },
            { label: "Alerta" }
          ]}
          rows={tableRows}
        />
        {totalPages > 1 ? (
          <div className="filter-row">
            {page > 1 ? <Link className="button-link" href={pageHref(page - 1)}>← Anterior</Link> : null}
            {page < totalPages ? <Link className="button-link" href={pageHref(page + 1)}>Próxima →</Link> : null}
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
