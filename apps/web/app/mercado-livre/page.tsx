import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { requireCurrentUser } from "../../lib/auth/session";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { SortableTable, type SortableCell } from "../components/sortable-table";
import { MlTabs } from "./tabs";
import {
  type Curve,
  type MlItem,
  brl,
  buildCostIndex,
  computeCurves,
  computeTrends,
  costOfItemFactory,
  count,
  dailyVelocity,
  daysSince,
  isFull,
  loadMlData,
  n,
  pct,
  stockOf,
  trendSlope,
  trendText,
  variationVelocity
} from "./data";

export const dynamic = "force-dynamic";

const PARADO_MAX_ROWS = 150;

// ---- Server action: estoque em trânsito (escrita via service-role) ----
async function saveTransit(formData: FormData) {
  "use server";
  await requireCurrentUser();
  const admin = createSupabaseAdminClient();
  const { data: accounts } = await admin
    .from("mercadolivre_accounts")
    .select("seller_id")
    .eq("is_active", true)
    .limit(1);
  const sellerId = accounts?.[0]?.seller_id;
  if (!sellerId) return;

  const raw = String(formData.get("linhas") ?? "");
  const rows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(MLB\d+)\s+(\d+)/i);
      return match ? { mlb_id: match[1].toUpperCase(), qty: Number(match[2]) } : null;
    })
    .filter((row): row is { mlb_id: string; qty: number } => Boolean(row && row.qty >= 0));

  await admin.from("mercadolivre_transit").delete().eq("seller_id", sellerId);
  if (rows.length > 0) {
    await admin.from("mercadolivre_transit").insert(
      rows.map((row) => ({
        seller_id: sellerId,
        mlb_id: row.mlb_id,
        qty: row.qty,
        updated_at: new Date().toISOString()
      }))
    );
  }
  revalidatePath("/mercado-livre");
  revalidatePath("/mercado-livre/envio");
}

const curveBadge: Record<Exclude<Curve, null>, string> = {
  A: "status-pill signal-good",
  B: "status-pill signal-warning",
  C: "status-pill signal-muted"
};

function curveCell(curve: Curve): SortableCell {
  return curve ? { text: `Curva ${curve}`, sort: curve, badge: curveBadge[curve] } : { text: "—", sort: null };
}

function origemCell(item: MlItem): SortableCell {
  return isFull(item)
    ? { text: "Full", sort: "Full", badge: "status-pill signal-good" }
    : { text: "Local", sort: "Local", badge: "status-pill signal-muted" };
}

function itemCell(item: {
  title?: string | null;
  mlb_id: string;
  sku?: string | null;
  permalink?: string | null;
}): SortableCell {
  return {
    text: item.title ?? item.mlb_id,
    sort: item.title ?? item.mlb_id,
    href: item.permalink ?? undefined,
    subtitle: [item.mlb_id, item.sku ? `SKU ${item.sku}` : null].filter(Boolean).join(" · ")
  };
}

function marginCell(price: number, cost: number | undefined): SortableCell {
  if (!cost || cost <= 0 || price <= 0) return { text: "—", sort: null };
  const margin = price - cost;
  return {
    text: `${brl(margin)} (${pct(margin / price)})`,
    sort: margin,
    badge: margin <= 0 ? "status-pill signal-danger" : undefined
  };
}

export default async function MercadoLivrePage() {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const data = await loadMlData();

  if (!data) {
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
              Nenhum anúncio sincronizado ainda. Verifique a função <code>mercadolivre-sync</code> e o{" "}
              <code>/status</code>.
            </p>
          </div>
        </section>
      </AppShell>
    );
  }

  const { items, sales, variations, transit, costs, lastRun } = data;
  const curves = computeCurves(items);
  const trends = computeTrends(sales);
  const transitByMlb = new Map(transit.map((row) => [row.mlb_id, row.qty]));
  const itemByMlb = new Map(items.map((item) => [item.mlb_id, item]));
  const costBySku = buildCostIndex(costs);
  const costOfItem = costOfItemFactory(costBySku, variations);

  const skuUniverse = new Set<string>();
  for (const item of items) if (item.sku) skuUniverse.add(item.sku);
  for (const variation of variations) if (variation.sku) skuUniverse.add(variation.sku);
  const skuMatched = [...skuUniverse].filter((sku) => costBySku.has(sku)).length;

  const ruptura = items
    .filter((item) => stockOf(item) <= 0 && item.sold_qty_60d > 0)
    .map((item) => {
      const velocity = dailyVelocity(item);
      return {
        item,
        velocity,
        lossPerDay: velocity * n(item.price),
        transitQty: transitByMlb.get(item.mlb_id) ?? 0
      };
    })
    .sort((a, b) => b.lossPerDay - a.lossPerDay);

  const rupturaVariacoes = variations
    .filter((variation) => {
      const parent = itemByMlb.get(variation.mlb_id);
      if (!parent || parent.status === "closed") return false;
      const stock = parent.logistic_type === "fulfillment" ? variation.full_stock : variation.available_qty;
      return stock <= 0 && variation.sold_qty_60d > 0 && stockOf(parent) > 0;
    })
    .map((variation) => {
      const parent = itemByMlb.get(variation.mlb_id)!;
      const velocity = variationVelocity(variation);
      const price = n(variation.price ?? parent.price);
      return { variation, parent, velocity, lossPerDay: velocity * price, price };
    })
    .sort((a, b) => b.lossPerDay - a.lossPerDay);

  const cobertura = items
    .filter((item) => isFull(item) && item.full_stock > 0 && item.sold_qty_30d > 0 && item.status === "active")
    .map((item) => {
      const velocity = dailyVelocity(item);
      const transitQty = transitByMlb.get(item.mlb_id) ?? 0;
      return { item, velocity, transitQty, coverageDays: (item.full_stock + transitQty) / velocity };
    })
    .sort((a, b) => a.coverageDays - b.coverageDays);

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
      const acao =
        idle === null || idle > 120 ? "Avaliar retirada" : curve === "A" ? "Investigar (Curva A)" : "Ativar promoção";
      return { item, curve, acao, capital: stockOf(item) * n(item.price) };
    })
    .sort((a, b) => b.capital - a.capital);

  const lossPerDay =
    ruptura.reduce((sum, r) => sum + r.lossPerDay, 0) + rupturaVariacoes.reduce((sum, r) => sum + r.lossPerDay, 0);
  const criticalCoverage = cobertura.filter((c) => c.coverageDays < 7);
  const capitalParado = parado.reduce((sum, p) => sum + p.capital, 0);

  const curveAItems = items.filter((item) => curves.get(item.mlb_id) === "A");
  const curveAAtRisk =
    ruptura.filter((r) => curves.get(r.item.mlb_id) === "A").length +
    criticalCoverage.filter((c) => curves.get(c.item.mlb_id) === "A").length;
  const curveAHealth = curveAItems.length > 0 ? 1 - curveAAtRisk / curveAItems.length : 1;

  const transitTotal = transit.reduce((sum, row) => sum + row.qty, 0);
  const transitText = transit.map((row) => `${row.mlb_id} ${row.qty}`).join("\n");

  const rupturaRows: SortableCell[][] = ruptura.map(({ item, velocity, lossPerDay: loss, transitQty }) => [
    itemCell(item),
    origemCell(item),
    curveCell(curves.get(item.mlb_id) ?? null),
    { text: `${count(item.sold_qty_30d)} / ${count(item.sold_qty_60d)}`, sort: item.sold_qty_60d },
    { text: trendText(trends.get(item.mlb_id)), sort: trendSlope(trends.get(item.mlb_id)) },
    { text: velocity.toFixed(1), sort: velocity },
    transitQty > 0
      ? { text: `${count(transitQty)} 🚚`, sort: transitQty, badge: "status-pill signal-warning" }
      : { text: "—", sort: 0 },
    { text: brl(loss), sort: loss, badge: "status-pill signal-danger" },
    marginCell(n(item.price), costOfItem(item))
  ]);

  const rupturaVarRows: SortableCell[][] = rupturaVariacoes.map(
    ({ variation, parent, velocity, lossPerDay: loss, price }) => [
      itemCell({ title: parent.title, mlb_id: variation.mlb_id, sku: variation.sku, permalink: parent.permalink }),
      { text: variation.attrs ?? variation.variation_id, sort: variation.attrs ?? variation.variation_id },
      curveCell(curves.get(variation.mlb_id) ?? null),
      { text: `${count(variation.sold_qty_30d)} / ${count(variation.sold_qty_60d)}`, sort: variation.sold_qty_60d },
      { text: velocity.toFixed(1), sort: velocity },
      { text: brl(loss), sort: loss, badge: "status-pill signal-danger" },
      marginCell(price, variation.sku ? costBySku.get(variation.sku) : undefined)
    ]
  );

  const coberturaRows: SortableCell[][] = cobertura.map(({ item, velocity, transitQty, coverageDays }) => [
    itemCell(item),
    curveCell(curves.get(item.mlb_id) ?? null),
    { text: count(item.full_stock), sort: item.full_stock },
    transitQty > 0 ? { text: `${count(transitQty)} 🚚`, sort: transitQty } : { text: "—", sort: 0 },
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
    },
    marginCell(n(item.price), costOfItem(item))
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
            Ruptura, cobertura, variações e capital parado ·{" "}
            {lastRun?.finished_at
              ? `último sync ${new Date(lastRun.finished_at).toLocaleString("pt-BR")}`
              : "aguardando primeira sincronização"}
          </p>
        </div>
      </header>

      <MlTabs active="visao" />

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-red">
          <span className="label">Perda estimada / dia</span>
          <strong>{brl(lossPerDay)}</strong>
          <small>
            {count(ruptura.length)} anúncios + {count(rupturaVariacoes.length)} variações em ruptura
          </small>
        </article>
        <article className={`metric ${curveAHealth < 0.8 ? "accent-red" : "accent-emerald"}`}>
          <span className="label">Saúde da Curva A</span>
          <strong>{pct(curveAHealth)}</strong>
          <small>
            {count(curveAAtRisk)} de {count(curveAItems.length)} itens A em risco
          </small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Cobertura crítica</span>
          <strong>{count(criticalCoverage.length)}</strong>
          <small>Full com menos de 7 dias (já conta trânsito)</small>
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
            <p className="eyebrow">Dinheiro sendo perdido agora · velocidade sobre dias com estoque</p>
            <h2>Ruptura de estoque — anúncios</h2>
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
            { label: "Trânsito", numeric: true },
            { label: "Perda/dia", numeric: true },
            { label: "Margem unit.", numeric: true }
          ]}
          rows={rupturaRows}
          initialSort={7}
          initialDir="desc"
        />
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">O anúncio parece saudável, mas a variação rompeu (cor/tamanho)</p>
            <h2>Ruptura de estoque — variações</h2>
          </div>
          <span className="pill">{count(rupturaVariacoes.length)} variações</span>
        </div>
        <SortableTable
          columns={[
            { label: "Anúncio" },
            { label: "Variação" },
            { label: "Curva" },
            { label: "Vendas 30/60d", numeric: true },
            { label: "Média/dia", numeric: true },
            { label: "Perda/dia", numeric: true },
            { label: "Margem unit.", numeric: true }
          ]}
          rows={rupturaVarRows}
          initialSort={5}
          initialDir="desc"
        />
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Reponha antes do vermelho · estoque + trânsito</p>
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
            { label: "Trânsito", numeric: true },
            { label: "Tendência 120→0", numeric: true },
            { label: "Média/dia", numeric: true },
            { label: "Cobertura", numeric: true },
            { label: "Status" },
            { label: "Margem unit.", numeric: true }
          ]}
          rows={coberturaRows}
          initialSort={6}
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
            Exibindo os {PARADO_MAX_ROWS} itens de maior capital parado —{" "}
            {count(parado.length - PARADO_MAX_ROWS)} itens menores não exibidos.
          </p>
        )}
      </section>

      <section className="control-grid">
        <article className="panel">
          <div className="section-head">
            <p className="eyebrow">Some ao Full o que já está a caminho (estudo Magiic)</p>
            <h2>Estoque em trânsito</h2>
          </div>
          <p className="table-note">
            Uma linha por anúncio: <code>MLB1234567890 12</code>. A lista abaixo substitui a anterior; a
            cobertura, a ruptura e a sugestão de envio passam a considerar essas unidades. Total atual:{" "}
            {count(transitTotal)} unidades em {count(transit.length)} anúncios.
          </p>
          <form action={saveTransit} className="upload-form manual-form">
            <textarea
              name="linhas"
              rows={6}
              defaultValue={transitText}
              placeholder={"MLB1234567890 12\nMLB0987654321 30"}
            />
            <button type="submit">Salvar trânsito</button>
          </form>
        </article>
        <article className="panel">
          <div className="section-head">
            <p className="eyebrow">Cruzamento SKU Mercado Livre ↔ custo Olist</p>
            <h2>Cobertura de custo</h2>
          </div>
          <p className="table-note">
            {count(skuMatched)} de {count(skuUniverse.size)} SKUs do Mercado Livre têm custo casado no
            Olist — as colunas “Margem unit.” aparecem para esses. Margem bruta (preço − custo efetivo),
            sem taxas de marketplace/frete. Para ampliar a cobertura, padronize os SKUs dos
            anúncios/variações com os do ERP.
          </p>
        </article>
      </section>
    </AppShell>
  );
}
