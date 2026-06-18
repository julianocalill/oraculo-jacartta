import { createSupabaseAdminClient } from "../lib/supabase/admin";

export const dynamic = "force-dynamic";

type StockRow = {
  id: string;
  sku: string | null;
  nome: string | null;
  saldo: number | null;
  reservado: number | null;
  disponivel: number | null;
  active: boolean | null;
  synced_at: string | null;
  payload: {
    precos?: {
      preco?: number;
    };
  } | null;
};

type SyncRun = {
  id: string;
  batch_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_fetched: number | null;
  records_upserted: number | null;
  error_message: string | null;
};

function formatDateTime(value: string | null) {
  if (!value) return "Sem registro";

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== "number") return "-";

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

function formatCount(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(value ?? 0);
}

async function loadDashboard() {
  const supabase = createSupabaseAdminClient();

  const [
    activeItems,
    zeroStockItems,
    lowStockItems,
    orderCount,
    latestStockRunResponse,
    watchlistResponse
  ] = await Promise.all([
    supabase
      .from("olist_stock_items")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    supabase
      .from("olist_stock_items")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .eq("disponivel", 0),
    supabase
      .from("olist_stock_items")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .lte("disponivel", 5),
    supabase.from("olist_orders").select("id", { count: "exact", head: true }),
    supabase
      .from("olist_stock_sync_runs")
      .select("*")
      .order("finished_at", { ascending: false })
      .limit(1),
    supabase
      .from("olist_stock_items")
      .select("id, sku, nome, saldo, reservado, disponivel, active, synced_at, payload")
      .eq("active", true)
      .order("disponivel", { ascending: true, nullsFirst: true })
      .limit(6)
  ]);

  const latestStockRun = (latestStockRunResponse.data?.[0] ?? null) as SyncRun | null;
  const watchlist = (watchlistResponse.data ?? []) as StockRow[];

  return {
    activeItems: activeItems.count ?? 0,
    zeroStockItems: zeroStockItems.count ?? 0,
    lowStockItems: lowStockItems.count ?? 0,
    orderCount: orderCount.count ?? 0,
    latestStockRun,
    watchlist
  };
}

export default async function HomePage() {
  const data = await loadDashboard();
  const latestRunAt = data.latestStockRun?.finished_at ?? data.latestStockRun?.started_at ?? null;

  return (
    <main className="page dashboard">
      <section className="surface surface-hero">
        <div>
          <p className="eyebrow">Oraculo</p>
          <h1>Base unica, dados vivos e operacao visivel.</h1>
          <p className="lede">
            O Supabase concentra estoque, pedidos e syncs. Esta tela mostra a situacao
            real do estoque da Olist e serve como primeiro painel operacional do projeto.
          </p>
        </div>

        <div className="stack">
          <div className="status-chip">Supabase remoto: bbtiipnmdxfxnxbemgjr</div>
          <div className="status-list">
            <div>
              <span className="label">Ultima sync de estoque</span>
              <strong>{formatDateTime(latestRunAt)}</strong>
            </div>
            <div>
              <span className="label">Status</span>
              <strong>{data.latestStockRun?.status ?? "sem execucao"}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="surface">
        <div className="section-head">
          <p className="eyebrow">Indicadores</p>
          <h2>Estado atual da base canônica.</h2>
        </div>

        <div className="metric-grid">
          <article className="metric">
            <span className="label">Itens ativos</span>
            <strong>{formatCount(data.activeItems)}</strong>
          </article>
          <article className="metric">
            <span className="label">Sem estoque</span>
            <strong>{formatCount(data.zeroStockItems)}</strong>
          </article>
          <article className="metric">
            <span className="label">Em risco imediato</span>
            <strong>{formatCount(data.lowStockItems)}</strong>
          </article>
          <article className="metric">
            <span className="label">Pedidos Olist</span>
            <strong>{formatCount(data.orderCount)}</strong>
          </article>
        </div>
      </section>

      <section className="surface split">
        <div>
          <div className="section-head">
            <p className="eyebrow">Watchlist</p>
            <h2>Produtos que precisam de atenção.</h2>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>SKU</th>
                  <th className="numeric">Disponivel</th>
                  <th className="numeric">Saldo</th>
                  <th className="numeric">Preco</th>
                </tr>
              </thead>
              <tbody>
                {data.watchlist.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="row-title">{item.nome ?? "Sem nome"}</div>
                      <div className="row-subtitle">
                        Sincronizado em {formatDateTime(item.synced_at)}
                      </div>
                    </td>
                    <td>{item.sku ?? "-"}</td>
                    <td className="numeric">{formatCount(item.disponivel)}</td>
                    <td className="numeric">{formatCount(item.saldo)}</td>
                    <td className="numeric">{formatCurrency(item.payload?.precos?.preco)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="stack">
          <section className="surface-card">
            <p className="eyebrow">Leitura tecnica</p>
            <h3>Arquitetura de construcao</h3>
            <p className="body-copy">
              O frontend so consome o banco. O trabalho de integracao, sincronizacao e
              normalizacao continua no Supabase, com documentacao viva no vault.
            </p>
          </section>

          <section className="surface-card">
            <p className="eyebrow">Backlog imediato</p>
            <h3>Proxima camada</h3>
            <ul className="bullet-list">
              <li>Pedidos e faturamento diario</li>
              <li>Canal por canal: Mercado Livre, Shopee, Magalu</li>
              <li>Produto como ativo com tendencia e ruptura</li>
            </ul>
          </section>
        </aside>
      </section>
    </main>
  );
}
