import { createSupabaseUserClient } from "../../lib/supabase/user";
import { requireCurrentUser } from "../../lib/auth/session";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { SortableTable, type SortableCell } from "../components/sortable-table";

export const dynamic = "force-dynamic";

const DAYS_WINDOW = 30;

type MlItem = {
  seller_id: number;
  mlb_id: string;
  title: string | null;
  sku: string | null;
  status: string | null;
  price: number | null;
  permalink: string | null;
  logistic_type: string | null;
  full_stock: number;
  sold_qty_30d: number;
  revenue_30d: number;
  last_sale_at: string | null;
};

type SyncRun = {
  finished_at: string | null;
  status: string;
  items_count: number;
  orders_count: number;
};

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

async function loadData() {
  const supabase = await createSupabaseUserClient();
  const [itemsResult, runResult] = await Promise.all([
    supabase
      .from("mercadolivre_items")
      .select(
        "seller_id, mlb_id, title, sku, status, price, permalink, logistic_type, full_stock, sold_qty_30d, revenue_30d, last_sale_at"
      )
      .eq("logistic_type", "fulfillment")
      .neq("status", "closed"),
    supabase
      .from("mercadolivre_sync_runs")
      .select("finished_at, status, items_count, orders_count")
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
  ]);
  // Degrada para estado vazio se a migration de ingestão ainda não foi
  // aplicada (padrão de degradação usado nos snapshots fiscais).
  if (itemsResult.error) {
    console.error("mercado-livre page:", itemsResult.error.message);
    return { items: [] as MlItem[], ruptura: [], cobertura: [], parado: [], lastRun: null };
  }
  const items = (itemsResult.data ?? []) as MlItem[];
  const lastRun = ((runResult.data ?? []) as SyncRun[])[0] ?? null;

  const ruptura = items
    .filter((item) => item.full_stock <= 0 && item.sold_qty_30d > 0)
    .map((item) => {
      const dailyAvg = item.sold_qty_30d / DAYS_WINDOW;
      return { ...item, dailyAvg, lossPerDay: dailyAvg * n(item.price) };
    })
    .sort((a, b) => b.lossPerDay - a.lossPerDay);

  const cobertura = items
    .filter((item) => item.full_stock > 0 && item.sold_qty_30d > 0 && item.status === "active")
    .map((item) => {
      const dailyAvg = item.sold_qty_30d / DAYS_WINDOW;
      return { ...item, dailyAvg, coverageDays: item.full_stock / dailyAvg };
    })
    .sort((a, b) => a.coverageDays - b.coverageDays);

  const parado = items
    .filter((item) => item.full_stock > 0 && (item.sold_qty_30d <= 0 || item.status === "paused"))
    .map((item) => ({
      ...item,
      capitalParado: item.full_stock * n(item.price),
      motivo: item.status === "paused" ? "Anúncio pausado" : "Sem venda 30d"
    }))
    .sort((a, b) => b.capitalParado - a.capitalParado);

  return { items, ruptura, cobertura, parado, lastRun };
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

  const lossPerDay = data.ruptura.reduce((sum, item) => sum + item.lossPerDay, 0);
  const criticalCoverage = data.cobertura.filter((item) => item.coverageDays < 7);
  const capitalParado = data.parado.reduce((sum, item) => sum + item.capitalParado, 0);

  const rupturaRows: SortableCell[][] = data.ruptura.map((item) => [
    itemCell(item),
    { text: brl(n(item.price)), sort: n(item.price) },
    { text: count(item.sold_qty_30d), sort: item.sold_qty_30d },
    { text: item.dailyAvg.toFixed(1), sort: item.dailyAvg },
    {
      text: brl(item.lossPerDay),
      sort: item.lossPerDay,
      badge: "status-pill signal-danger"
    },
    {
      text: daysSince(item.last_sale_at) != null ? `há ${daysSince(item.last_sale_at)}d` : "-",
      sort: daysSince(item.last_sale_at)
    }
  ]);

  const coberturaRows: SortableCell[][] = data.cobertura.map((item) => [
    itemCell(item),
    { text: count(item.full_stock), sort: item.full_stock },
    { text: item.dailyAvg.toFixed(1), sort: item.dailyAvg },
    { text: `${Math.floor(item.coverageDays)} dias`, sort: item.coverageDays },
    {
      text: item.coverageDays < 7 ? "Crítico" : item.coverageDays < 15 ? "Atenção" : "OK",
      sort: item.coverageDays < 7 ? 0 : item.coverageDays < 15 ? 1 : 2,
      badge:
        item.coverageDays < 7
          ? "status-pill signal-danger"
          : item.coverageDays < 15
            ? "status-pill signal-warning"
            : "status-pill signal-good"
    }
  ]);

  const paradoRows: SortableCell[][] = data.parado.map((item) => [
    itemCell(item),
    { text: brl(n(item.price)), sort: n(item.price) },
    { text: count(item.full_stock), sort: item.full_stock },
    { text: brl(item.capitalParado), sort: item.capitalParado, badge: "status-pill signal-warning" },
    {
      text: item.motivo,
      sort: item.motivo,
      badge: item.motivo === "Anúncio pausado" ? "status-pill signal-warning" : "status-pill signal-muted"
    }
  ]);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Mercado Livre Full</h1>
          <p>
            Ruptura, cobertura e capital parado no fulfillment ·{" "}
            {data.lastRun?.finished_at
              ? `último sync ${new Date(data.lastRun.finished_at).toLocaleString("pt-BR")}`
              : "aguardando primeira sincronização"}
          </p>
        </div>
      </header>

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-red">
          <span className="label">Perda estimada / dia</span>
          <strong>{brl(lossPerDay)}</strong>
          <small>{count(data.ruptura.length)} itens em ruptura</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Perda projetada / mês</span>
          <strong>{brl(lossPerDay * 30)}</strong>
          <small>Se nada for reposto</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Cobertura crítica</span>
          <strong>{count(criticalCoverage.length)}</strong>
          <small>Itens com menos de 7 dias</small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Capital parado</span>
          <strong>{brl(capitalParado)}</strong>
          <small>{count(data.parado.length)} itens sem giro no Full</small>
        </article>
      </section>

      {data.items.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            <p>
              Nenhum anúncio Full sincronizado ainda. Ative a função{" "}
              <code>mercadolivre-sync</code> para importar os dados (ver{" "}
              <code>docs/mercadolivre-integration.md</code>).
            </p>
          </div>
        </section>
      ) : (
        <>
          <section className="panel">
            <div className="section-head section-row">
              <div>
                <p className="eyebrow">Dinheiro sendo perdido agora</p>
                <h2>Ruptura de estoque no Full</h2>
              </div>
              <span className="pill">{count(data.ruptura.length)} itens</span>
            </div>
            <SortableTable
              columns={[
                { label: "Anúncio" },
                { label: "Preço", numeric: true },
                { label: "Vendas 30d", numeric: true },
                { label: "Média/dia", numeric: true },
                { label: "Perda/dia", numeric: true },
                { label: "Última venda", numeric: true }
              ]}
              rows={rupturaRows}
              initialSort={4}
              initialDir="desc"
            />
          </section>

          <section className="panel">
            <div className="section-head section-row">
              <div>
                <p className="eyebrow">Reponha antes do vermelho</p>
                <h2>Cobertura de estoque Full</h2>
              </div>
              <span className="pill">
                {count(criticalCoverage.length)} críticos · {count(data.cobertura.length)} com giro
              </span>
            </div>
            <SortableTable
              columns={[
                { label: "Anúncio" },
                { label: "Estoque Full", numeric: true },
                { label: "Média/dia", numeric: true },
                { label: "Cobertura", numeric: true },
                { label: "Status" }
              ]}
              rows={coberturaRows}
              initialSort={3}
              initialDir="asc"
            />
          </section>

          <section className="panel">
            <div className="section-head section-row">
              <div>
                <p className="eyebrow">Capital imobilizado + armazenagem correndo</p>
                <h2>Estoque parado no Full</h2>
              </div>
              <span className="pill">{brl(capitalParado)}</span>
            </div>
            <SortableTable
              columns={[
                { label: "Anúncio" },
                { label: "Preço", numeric: true },
                { label: "Estoque Full", numeric: true },
                { label: "Capital parado", numeric: true },
                { label: "Motivo" }
              ]}
              rows={paradoRows}
              initialSort={3}
              initialDir="desc"
            />
          </section>
        </>
      )}
    </AppShell>
  );
}
