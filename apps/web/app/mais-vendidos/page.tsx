import Link from "next/link";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { requireCurrentUser } from "../../lib/auth/session";
import { formatBrDate } from "../../lib/date";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { SortableTable } from "../components/sortable-table";

export const dynamic = "force-dynamic";

type Periodo = "1d" | "3d" | "7d";

const PERIODOS: { key: Periodo; days: number; label: string }[] = [
  { key: "1d", days: 1, label: "Hoje" },
  { key: "3d", days: 3, label: "Últimos 3 dias" },
  { key: "7d", days: 7, label: "Últimos 7 dias" }
];

type ItemRow = {
  sku: string | null;
  produto_id: string | null;
  descricao: string | null;
  quantidade: number | null;
  pedido: {
    situacao: string | null;
    canal_nome: string | null;
    canal_id: string | null;
  } | null;
};

type ChannelRow = {
  source_id: string | null;
  source_name: string | null;
  display_name: string | null;
};

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function count(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function pct(value: number) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value * 100)}%`;
}

function asPeriodo(value: string | undefined): Periodo {
  if (value === "3d" || value === "7d") return value;
  return "1d";
}

// Janela de dias corridos (incluindo hoje) em America/Sao_Paulo. O corte segue
// a mesma semântica das views do dashboard (data_criacao::date).
function periodoRange(days: number) {
  const todaySp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const anchor = new Date(`${todaySp}T12:00:00Z`);
  const startDate = new Date(anchor);
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1));
  const endExclusive = new Date(anchor);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(startDate), end: todaySp, endExclusive: iso(endExclusive) };
}

const PAGE_SIZE = 1000;

// O servidor corta a resposta em 1000 linhas; sem paginar, os rankings saem
// silenciosamente incompletos. O erro sobe: total parcial é pior que erro.
async function fetchAllRows<T>(
  buildQuery: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }> }
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadMaisVendidos(start: string, endExclusive: string) {
  // Admin client: olist_order_items/olist_orders/dim_channels não têm grant
  // para authenticated (ver 20260710092000). Leitura pura, mesmo precedente
  // das tabelas de cache na aba Shopee.
  const supabase = createSupabaseAdminClient();

  const [items, channels] = await Promise.all([
    fetchAllRows<ItemRow>(() =>
      supabase
        .from("olist_order_items")
        .select(
          "sku,produto_id,descricao,quantidade,order_id,pedido:olist_orders!inner(situacao,canal_nome:payload->ecommerce->>nome,canal_id:payload->ecommerce->>id)"
        )
        .gte("order_data_criacao", start)
        .lt("order_data_criacao", endExclusive)
        .order("order_data_criacao", { ascending: false })
        .order("id")
    ) as Promise<(ItemRow & { order_id: string })[]>,
    supabase
      .from("dim_channels")
      .select("source_id,source_name,display_name")
      .eq("source", "olist")
      .then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []) as ChannelRow[];
      })
  ]);

  // Nome amigável da loja, mesmo fallback de oraculo_order_facts:
  // dim_channels.display_name > payload.ecommerce.nome > "Sem canal"
  const channelById = new Map<string, string>();
  const channelByName = new Map<string, string>();
  for (const channel of channels) {
    if (!channel.display_name) continue;
    if (channel.source_id) channelById.set(channel.source_id, channel.display_name);
    if (channel.source_name) channelByName.set(channel.source_name, channel.display_name);
  }

  type ProductAgg = { sku: string | null; name: string; units: number; orders: Set<string> };
  type ChannelAgg = { name: string; units: number; orders: Set<string> };

  const products = new Map<string, ProductAgg>();
  const lojas = new Map<string, ChannelAgg>();
  let totalUnits = 0;
  let canceledUnits = 0;
  const totalOrders = new Set<string>();

  for (const item of items) {
    const units = n(item.quantidade);
    // Status "8" (cancelado) fica fora do ranking; mostramos o volume à parte.
    if (item.pedido?.situacao === "8") {
      canceledUnits += units;
      continue;
    }

    totalUnits += units;
    totalOrders.add(item.order_id);

    const productKey = item.sku || item.produto_id || item.descricao || "sem-identificacao";
    const product = products.get(productKey) ?? {
      sku: item.sku,
      name: item.descricao ?? "Sem nome",
      units: 0,
      orders: new Set<string>()
    };
    product.units += units;
    product.orders.add(item.order_id);
    if (!product.sku && item.sku) product.sku = item.sku;
    products.set(productKey, product);

    const lojaName =
      (item.pedido?.canal_id && channelById.get(item.pedido.canal_id)) ||
      (item.pedido?.canal_nome && channelByName.get(item.pedido.canal_nome)) ||
      item.pedido?.canal_nome ||
      "Sem canal";
    const loja = lojas.get(lojaName) ?? { name: lojaName, units: 0, orders: new Set<string>() };
    loja.units += units;
    loja.orders.add(item.order_id);
    lojas.set(lojaName, loja);
  }

  return {
    products: [...products.values()].sort((a, b) => b.units - a.units),
    lojas: [...lojas.values()].sort((a, b) => b.units - a.units),
    totalUnits,
    canceledUnits,
    totalOrders: totalOrders.size
  };
}

export default async function MaisVendidosPage({
  searchParams
}: {
  searchParams?: Promise<{ periodo?: string }>;
}) {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const params = await searchParams;
  const periodo = asPeriodo(params?.periodo);
  const config = PERIODOS.find((option) => option.key === periodo) ?? PERIODOS[0];
  const range = periodoRange(config.days);
  const data = await loadMaisVendidos(range.start, range.endExclusive);
  const rangeLabel =
    range.start === range.end
      ? formatBrDate(range.start)
      : `${formatBrDate(range.start)} a ${formatBrDate(range.end)}`;

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Mais Vendidos</h1>
          <p>Ranking por quantidade vendida (Olist) — produtos e lojas, sem pedidos cancelados</p>
        </div>
      </header>

      <div className="pill-row" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {PERIODOS.map((option) => (
          <Link
            key={option.key}
            href={option.key === "1d" ? "/mais-vendidos" : `/mais-vendidos?periodo=${option.key}`}
            className={option.key === periodo ? "pill pill-gold" : "pill"}
          >
            {option.label}
          </Link>
        ))}
      </div>

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-blue">
          <span className="label">Período</span>
          <strong>{config.label}</strong>
          <small>{rangeLabel}</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Quantidade vendida</span>
          <strong>{count(data.totalUnits)}</strong>
          <small>Unidades em pedidos válidos</small>
        </article>
        <article className="metric accent-green">
          <span className="label">Pedidos</span>
          <strong>{count(data.totalOrders)}</strong>
          <small>Pedidos com itens no período</small>
        </article>
        <article className="metric accent-purple">
          <span className="label">Produtos distintos</span>
          <strong>{count(data.products.length)}</strong>
          <small>{count(data.canceledUnits)} un. em pedidos cancelados (fora do ranking)</small>
        </article>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Ranking de produtos</p>
            <h2>Produtos mais vendidos</h2>
          </div>
          <span className="pill">Por quantidade</span>
        </div>
        <SortableTable
          showRank
          columns={[
            { label: "Produto" },
            { label: "SKU" },
            { label: "Quantidade", numeric: true, hint: "Unidades vendidas no período, sem pedidos cancelados" },
            { label: "Pedidos", numeric: true, hint: "Pedidos distintos que contêm o produto" }
          ]}
          initialSort={2}
          initialDir="desc"
          rows={data.products.map((product) => [
            {
              text: product.name,
              sort: product.name,
              href: product.sku ? `/skus?source=olist&sku=${encodeURIComponent(product.sku)}` : undefined
            },
            { text: product.sku ?? "-", sort: product.sku },
            { text: count(product.units), sort: product.units },
            { text: count(product.orders.size), sort: product.orders.size }
          ])}
        />
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Ranking de lojas</p>
            <h2>Lojas que mais venderam</h2>
          </div>
          <span className="pill">Por quantidade</span>
        </div>
        <SortableTable
          showRank
          columns={[
            { label: "Loja" },
            { label: "Quantidade", numeric: true, hint: "Unidades vendidas no período, sem pedidos cancelados" },
            { label: "Pedidos", numeric: true },
            { label: "Participação", numeric: true, hint: "Fatia da loja na quantidade total do período" }
          ]}
          initialSort={1}
          initialDir="desc"
          rows={data.lojas.map((loja) => [
            { text: loja.name, sort: loja.name },
            { text: count(loja.units), sort: loja.units },
            { text: count(loja.orders.size), sort: loja.orders.size },
            {
              text: data.totalUnits > 0 ? pct(loja.units / data.totalUnits) : "-",
              sort: data.totalUnits > 0 ? loja.units / data.totalUnits : null
            }
          ])}
        />
      </section>
    </AppShell>
  );
}
