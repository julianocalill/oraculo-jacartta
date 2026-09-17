import { loadActionableAlertCount } from "../../../lib/alert-count";
import { requireTabAccess } from "../../../lib/auth/access";
import { AppShell } from "../../components/app-shell";
import { MetricCard } from "../../components/metric-card";
import { NoAccess } from "../../components/no-access";
import { SortableTable } from "../../components/sortable-table";
import { LojaPills, ShopeeTabs } from "../tabs";
import { LiveMonitorAutoRefresh } from "./auto-refresh";
import { loadShopeeLiveMonitor, type LiveShop } from "./data";
import { HourlySalesChart } from "./hourly-chart";

export const dynamic = "force-dynamic";

const brl = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const count = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function currentBrHour() {
  return Number(new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hourCycle: "h23"
  }).format(new Date()));
}

function health(shop: LiveShop) {
  if (!shop.lastSuccess) return { label: "Aguardando", badge: "status-pill signal-muted" };
  if (!shop.usable) return { label: "Atrasada", badge: "status-pill signal-danger" };
  if (shop.status === "failed") return { label: "Último dado", badge: "status-pill signal-warning" };
  if (!shop.isComplete || shop.status === "partial") return { label: "Parcial", badge: "status-pill signal-warning" };
  return { label: "Atualizada", badge: "status-pill signal-good" };
}

export default async function ShopeeLiveMonitorPage({
  searchParams
}: {
  searchParams?: Promise<{ loja?: string }>;
}) {
  const params = await searchParams;
  const shopFilter = params?.loja && /^\d+$/.test(params.loja) ? Number(params.loja) : null;
  const [{ allowed }, alertCount, data] = await Promise.all([
    requireTabAccess("shopee"),
    loadActionableAlertCount(),
    loadShopeeLiveMonitor(shopFilter)
  ]);
  if (!allowed) return <NoAccess tab="shopee" />;

  const title = shopFilter == null ? "Todas as lojas" : data.shops[0]?.shopName ?? "Loja selecionada";
  const topProducts = data.products.slice(0, 5);

  return (
    <AppShell alertCount={alertCount}>
      <LiveMonitorAutoRefresh />
      <header className="topbar live-monitor-topbar">
        <div>
          <p className="eyebrow">Shopee · Open Platform API</p>
          <h1>Monitor de vendas</h1>
          <p>Vendas pagas de hoje consolidadas diretamente das lojas, sem automação do navegador.</p>
        </div>
        <div className="live-monitor-clock">
          <span>{data.complete ? "Ao vivo" : "Cobertura parcial"}</span>
          <strong>{formatDateTime(data.throughAt)}</strong>
          <small>Atualização automática da tela a cada minuto · coleta por loja a cada 5 min</small>
        </div>
      </header>

      <ShopeeTabs active="ao-vivo" />
      <LojaPills shops={data.allShops} active={shopFilter} basePath="/shopee/ao-vivo" />

      {!data.complete ? (
        <section className="panel live-monitor-warning">
          <strong>O consolidado está parcial.</strong>
          <p>
            {data.availableShops} de {data.expectedShops} lojas têm um snapshot válido dos últimos 12 minutos.
            Os cards somam apenas essas lojas; a tabela abaixo mostra qual coleta precisa normalizar.
          </p>
        </section>
      ) : null}

      <section className="live-revenue-hero" aria-label="Faturamento de hoje">
        <span>Vendas hoje · {title}</span>
        <strong>{brl(data.current.gross)}</strong>
        <small>Produto pago · ontem completo: {brl(data.previous.gross)}</small>
      </section>

      <section className="metric-grid live-monitor-metrics">
        <MetricCard accent="accent-blue" label="Pedidos" value={count(data.current.orders)} caption="Exclui não pagos e cancelados" />
        <MetricCard accent="accent-violet" label="Unidades" value={count(data.current.units)} caption="Quantidade dos itens dos pedidos" />
        <MetricCard accent="accent-green" label="Compradores" value={count(data.current.buyers)} caption="Compradores únicos identificados" />
        <MetricCard accent="accent-yellow" label="Visitantes" value="—" caption="Não exposto pela API oficial de pedidos" />
        <MetricCard accent="accent-cyan" label="Cliques por produto" value="—" caption="Ads mede só cliques de anúncios" />
        <MetricCard accent="accent-red" label="Conversão" value="—" caption="Indisponível sem visitantes gerais" />
      </section>

      <section className="live-monitor-main-grid">
        <article className="panel live-hourly-panel">
          <div className="section-head section-row">
            <div>
              <p className="eyebrow">Tendência de vendas</p>
              <h2>Faturamento por hora</h2>
            </div>
            <span className="pill">Fuso: Brasília</span>
          </div>
          <HourlySalesChart rows={data.hourly} currentHour={currentBrHour()} />
        </article>

        <article className="panel live-ranking-panel">
          <div className="section-head">
            <p className="eyebrow">Hoje</p>
            <h2>Top 5 produtos</h2>
          </div>
          {topProducts.length ? (
            <ol className="live-product-ranking">
              {topProducts.map((product, index) => (
                <li key={product.key}>
                  <span className="live-product-rank">{index + 1}</span>
                  <div>
                    <strong>{product.product}</strong>
                    <small>
                      {[product.sku, product.variation, product.shops.join(", ")].filter(Boolean).join(" · ")}
                    </small>
                  </div>
                  <span>
                    <b>{brl(product.gmv)}</b>
                    <small>{count(product.units)} un.</small>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-state">Nenhum produto pago apareceu nas lojas disponíveis hoje.</p>
          )}
          <p className="fiscal-note">Ranking pelo valor dos itens informado no detalhe dos pedidos; frete e ajustes do total do pedido não entram no produto.</p>
        </article>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Cobertura da coleta</p>
            <h2>Vendas por loja</h2>
          </div>
          <span className="pill">Fonte: order.get_order_list + get_order_detail</span>
        </div>
        <SortableTable
          columns={[
            { label: "Loja" },
            { label: "Status" },
            { label: "Vendas", numeric: true },
            { label: "Pedidos", numeric: true },
            { label: "Unidades", numeric: true },
            { label: "Compradores", numeric: true },
            { label: "Última API" }
          ]}
          initialSort={2}
          initialDir="desc"
          rows={data.shops.map((shop) => {
            const state = health(shop);
            return [
              { text: shop.shopName, sort: shop.shopName },
              { text: state.label, sort: state.label, badge: state.badge },
              { text: shop.usable ? brl(shop.current.gross) : "—", sort: shop.usable ? shop.current.gross : null },
              { text: shop.usable ? count(shop.current.orders) : "—", sort: shop.usable ? shop.current.orders : null },
              { text: shop.usable ? count(shop.current.units) : "—", sort: shop.usable ? shop.current.units : null },
              { text: shop.usable ? count(shop.current.buyers) : "—", sort: shop.usable ? shop.current.buyers : null },
              { text: formatDateTime(shop.apiThrough), sort: shop.apiThrough, subtitle: shop.error ? "A última tentativa falhou; exibindo o último dado válido." : undefined }
            ];
          })}
        />
      </section>

      <details className="panel live-monitor-method">
        <summary>Como os números são calculados</summary>
        <p>Entram pedidos criados em America/Sao_Paulo, exceto UNPAID, CANCELLED e IN_CANCEL. Faturamento é o total do pedido; unidades vêm dos itens; compradores são IDs únicos informados pela Shopee.</p>
        <p>Visitantes, cliques gerais e conversão pertencem ao Business Insights da Central do Vendedor e não são devolvidos pelos endpoints oficiais de pedidos. O monitor não fabrica esses números nem usa endpoints internos do navegador.</p>
      </details>
    </AppShell>
  );
}
