import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { requireCurrentUser } from "../../../lib/auth/session";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { SortableTable, type SortableCell } from "../../components/sortable-table";
import { LojaPills, ShopeeTabs } from "../tabs";
import {
  type Curve,
  brl,
  buildCostIndex,
  computeCurves,
  computeTrends,
  count,
  daysSince,
  loadShopeeData,
  n,
  priceOf,
  productKey,
  skuOf,
  stockOf,
  trendLabel,
  trendSlope,
  trendText,
  velocityOf
} from "../data";

export const dynamic = "force-dynamic";

// Regra de produto (2026-07-16): máx. 15 sugestões por loja (ajustável)
const SUGESTOES_POR_LOJA = 15;

// Cadastro de custos em massa, ancorado no SKU do marketplace (decisão
// 2026-07-16: os custos do ERP estão zerados para a maioria dos SKUs; o
// livro de custos passa a ser mantido aqui, com prioridade sobre o Olist).
async function saveCustos(formData: FormData) {
  "use server";
  await requireCurrentUser();
  const raw = String(formData.get("linhas") ?? "");
  const rows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+([\d.,]+)$/);
      if (!match) return null;
      const cost = Number(match[2].replace(/\./g, "").replace(",", "."));
      const costDot = Number(match[2].replace(",", "."));
      // aceita "12,34", "12.34" e "1.234,56"
      const unit = Number.isFinite(costDot) && match[2].includes(".") && !match[2].includes(",") ? costDot : cost;
      return Number.isFinite(unit) && unit > 0 ? { sku: match[1], unit } : null;
    })
    .filter((row): row is { sku: string; unit: number } => row !== null);
  if (rows.length === 0) return;

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("oraculo_margin_sku_params").upsert(
    rows.map((row) => ({
      source: "shopee",
      sku: row.sku,
      unit_cost_override: row.unit,
      active: true,
      notes: "cadastro em massa (reposição Shopee)",
      updated_at: now
    })),
    { onConflict: "source,sku" }
  );
  if (error) throw error;
  revalidatePath("/shopee/reposicao");
  revalidatePath("/shopee/estoque");
  revalidatePath("/shopee");
  revalidatePath("/mercado-livre");
  revalidatePath("/mercado-livre/envio");
}

type Situacao = "ruptura_fbs" | "critico_fbs" | "ruptura_local" | "abaixo_alvo";

const situacaoMeta: Record<Situacao, { label: string; badge: string; rank: number }> = {
  ruptura_fbs: { label: "Ruptura FBS", badge: "status-pill signal-danger", rank: 0 },
  critico_fbs: { label: "Crítico FBS (<7d)", badge: "status-pill signal-danger", rank: 1 },
  ruptura_local: { label: "Ruptura local", badge: "status-pill signal-danger", rank: 2 },
  abaixo_alvo: { label: "Abaixo do alvo", badge: "status-pill signal-warning", rank: 3 }
};

const curveBadge: Record<Exclude<Curve, null>, string> = {
  A: "status-pill signal-good",
  B: "status-pill signal-warning",
  C: "status-pill signal-muted"
};

function clampInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

// Kits ficam FORA da sugestão (decisão 2026-07-16): kits são compostos de
// produtos simples — repõe-se o componente, não o bundle. Detecção pelo nome
// do anúncio ("Kit ..."), o padrão do catálogo das lojas.
function isKit(name: string | null | undefined) {
  return /\bkit\b/i.test(name ?? "");
}

export default async function ShopeeReposicaoPage({
  searchParams
}: {
  searchParams?: Promise<{ alvo?: string; prazo?: string; loja?: string; limite?: string }>;
}) {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const params = await searchParams;
  const alvo = clampInt(params?.alvo, 30, 7, 90);
  const prazo = clampInt(params?.prazo, 7, 0, 30);
  const limite = clampInt(params?.limite, SUGESTOES_POR_LOJA, 1, 100);
  const lojaFiltro = Number(params?.loja) || null;
  const horizonte = alvo + prazo;

  const data = await loadShopeeData();
  if (!data) {
    return (
      <AppShell alertCount={alertCount}>
        <header className="topbar">
          <div>
            <h1>Sugestão de reposição Shopee</h1>
            <p>Aguardando primeira sincronização de produtos.</p>
          </div>
        </header>
        <ShopeeTabs active="reposicao" />
      </AppShell>
    );
  }

  const { shops, products, sbs, sales, costs } = data;
  const shopName = new Map(shops.map((s) => [s.shop_id, s.shop_name ?? String(s.shop_id)]));
  const curves = computeCurves(products);
  const trends = computeTrends(sales);
  const costBySku = buildCostIndex(costs);

  const priceByKey = new Map<string, number>();
  const stockByKey = new Map<string, number>();
  for (const product of products) {
    const key = productKey(product.shop_id, product.item_id, product.model_id);
    priceByKey.set(key, priceOf(product));
    stockByKey.set(key, stockOf(product));
  }

  type Sugestao = {
    shopId: number;
    titulo: string;
    sku: string | null;
    curve: Curve;
    situacao: Situacao;
    velocity: number;
    cobertura: number;
    enviar: number;
    lossPerDay: number;
    gmv: number;
    custo: number | null;
    porque: string;
    trendKey: string;
    vendas: string;
  };

  const sugestoes: Sugestao[] = [];

  // ---- FBS: repor armazém (velocidade e trânsito da própria Shopee) ----
  // Agrega por SKU (soma armazéns) para sugerir UM envio por produto.
  const fbsBySku = new Map<string, typeof sbs>();
  for (const row of sbs) {
    const key = productKey(row.shop_id, row.shop_item_id ?? row.item_id, row.shop_model_id ?? row.model_id);
    const list = fbsBySku.get(key) ?? [];
    list.push(row);
    fbsBySku.set(key, list);
  }
  let kitsExcluidos = 0;
  for (const [key, rows] of fbsBySku) {
    if (isKit(rows[0].item_name)) { kitsExcluidos++; continue; }
    const speed = rows.reduce((sum, r) => sum + r.selling_speed, 0);
    if (speed <= 0) continue;
    const sellable = rows.reduce((sum, r) => sum + r.sellable_qty, 0);
    const transit = rows.reduce((sum, r) => sum + r.in_transit_qty, 0);
    const have = sellable + transit;
    const alvoUn = Math.ceil(speed * horizonte);
    let enviar = alvoUn - have;
    const localStock = stockByKey.get(key) ?? 0;
    enviar = Math.min(enviar, Math.max(localStock, 0));
    if (enviar <= 0) continue;

    const shopId = rows[0].shop_id;
    const price = priceByKey.get(key) ?? 0;
    const cobertura = speed > 0 ? have / speed : 0;
    const situacao: Situacao = have <= 0 ? "ruptura_fbs" : cobertura < 7 ? "critico_fbs" : "abaixo_alvo";
    const lossPerDay = situacao === "ruptura_fbs" ? speed * price : 0;
    const curve = curves.get(key) ?? null;
    const titulo = [rows[0].item_name ?? rows[0].item_id, rows[0].model_name].filter(Boolean).join(" — ");
    const whsDetail = rows
      .map((r) => `${r.whs_id}: ${count(r.sellable_qty)}${r.in_transit_qty > 0 ? ` (+${count(r.in_transit_qty)} 🚚)` : ""}`)
      .join(", ");

    const porque: string[] = [];
    if (!lojaFiltro) porque.push(`Loja ${shopName.get(shopId) ?? shopId}`);
    porque.push(curve ? `Curva ${curve}` : "Sem curva");
    porque.push(`FBS vende ${speed.toFixed(1)}/dia (dado da Shopee)`);
    if (situacao === "ruptura_fbs") porque.push(`armazéns zerados, perdendo ${brl(lossPerDay)}/dia`);
    else if (situacao === "critico_fbs") porque.push(`cobertura de ${Math.floor(cobertura)}d — rompe antes da reposição chegar`);
    else porque.push(`cobertura de ${Math.floor(cobertura)}d < alvo de ${horizonte}d`);
    porque.push(`armazéns: ${whsDetail}`);
    porque.push(`alvo ${horizonte}d ⇒ ${count(alvoUn)} un · enviar ${count(enviar)} (limite: ${count(localStock)} no estoque local)`);

    const sku = null; // sku exibido via produto local quando casar
    const cost = null;
    sugestoes.push({
      shopId, titulo, sku, curve, situacao, velocity: speed, cobertura,
      enviar, lossPerDay, gmv: enviar * price, custo: cost,
      porque: porque.join(" — "), trendKey: key,
      vendas: `${count(rows.reduce((s, r) => s + r.last_30_sold, 0))} / ${count(rows.reduce((s, r) => s + r.last_60_sold, 0))}`
    });
  }

  // ---- Local: repor estoque do anúncio (compra/produção) ----
  for (const product of products) {
    if (product.sold_qty_60d <= 0) continue;
    if (isKit(product.item_name) || isKit(product.model_name)) { kitsExcluidos++; continue; }
    const key = productKey(product.shop_id, product.item_id, product.model_id);
    if (fbsBySku.has(key)) continue; // já tratado como FBS
    const stock = stockOf(product);
    const velocity = velocityOf(product);
    if (velocity <= 0) continue;
    const alvoUn = Math.ceil(velocity * horizonte);
    const enviar = alvoUn - stock;
    if (enviar <= 0) continue;

    const price = priceOf(product);
    const cobertura = velocity > 0 ? stock / velocity : 0;
    const situacao: Situacao = stock <= 0 ? "ruptura_local" : "abaixo_alvo";
    const lossPerDay = situacao === "ruptura_local" ? velocity * price : 0;
    const curve = curves.get(key) ?? null;
    const sku = skuOf(product);
    const cost = sku ? costBySku.get(sku) ?? null : null;
    const idle = daysSince(product.last_sale_at);

    const porque: string[] = [];
    if (!lojaFiltro) porque.push(`Loja ${shopName.get(product.shop_id) ?? product.shop_id}`);
    porque.push(curve ? `Curva ${curve}` : "Sem curva");
    porque.push(`vende ${velocity.toFixed(1)}/dia (${trendLabel(trends.get(key))})`);
    if (situacao === "ruptura_local") porque.push(`anúncio zerado${idle != null ? ` há ${idle}d` : ""}, perdendo ${brl(lossPerDay)}/dia`);
    else porque.push(`cobertura de ${Math.floor(cobertura)}d < alvo de ${horizonte}d`);
    porque.push(`alvo ${horizonte}d ⇒ ${count(alvoUn)} un · estoque ${count(stock)} · repor ${count(enviar)}`);

    sugestoes.push({
      shopId: product.shop_id,
      titulo: [product.item_name ?? product.item_id, product.model_name].filter(Boolean).join(" — "),
      sku, curve, situacao, velocity, cobertura, enviar, lossPerDay,
      gmv: enviar * price, custo: cost, porque: porque.join(" — "),
      trendKey: key,
      vendas: `${count(product.sold_qty_30d)} / ${count(product.sold_qty_60d)}`
    });
  }

  const ordenadas = sugestoes
    .filter((s) => (lojaFiltro ? s.shopId === lojaFiltro : true))
    .sort((a, b) => {
      const rank = situacaoMeta[a.situacao].rank - situacaoMeta[b.situacao].rank;
      if (rank !== 0) return rank;
      if (a.curve !== b.curve) return String(a.curve ?? "Z").localeCompare(String(b.curve ?? "Z"));
      return b.lossPerDay - a.lossPerDay || b.gmv - a.gmv;
    });

  // Máx. N por loja (regra de produto)
  const porLoja = new Map<number, number>();
  const visiveis = ordenadas.filter((s) => {
    const usados = porLoja.get(s.shopId) ?? 0;
    if (usados >= limite) return false;
    porLoja.set(s.shopId, usados + 1);
    return true;
  });
  const omitidos = ordenadas.length - visiveis.length;

  const totalUnidades = visiveis.reduce((sum, s) => sum + s.enviar, 0);
  const totalGmv = visiveis.reduce((sum, s) => sum + s.gmv, 0);
  const perdaEstancada = visiveis.reduce((sum, s) => sum + s.lossPerDay, 0);

  const rows: SortableCell[][] = visiveis.map((s) => [
    { text: s.titulo, sort: s.titulo, subtitle: s.porque },
    { text: situacaoMeta[s.situacao].label, sort: situacaoMeta[s.situacao].rank, badge: situacaoMeta[s.situacao].badge },
    s.curve ? { text: `Curva ${s.curve}`, sort: s.curve, badge: curveBadge[s.curve] } : { text: "—", sort: null },
    { text: s.vendas, sort: s.vendas },
    { text: trendText(trends.get(s.trendKey)), sort: trendSlope(trends.get(s.trendKey)) },
    { text: s.velocity.toFixed(1), sort: s.velocity },
    { text: `${Math.floor(s.cobertura)}d`, sort: s.cobertura },
    s.lossPerDay > 0
      ? { text: brl(s.lossPerDay), sort: s.lossPerDay, badge: "status-pill signal-danger" }
      : { text: "—", sort: 0 },
    { text: count(s.enviar), sort: s.enviar, badge: "status-pill signal-good" },
    { text: brl(s.gmv), sort: s.gmv },
    s.custo && s.custo > 0 ? { text: brl(s.custo * s.enviar), sort: s.custo * s.enviar } : { text: "—", sort: null }
  ]);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Sugestão de reposição Shopee</h1>
          <p>
            Regra: repor = média/dia × (alvo {alvo}d + prazo {prazo}d) − estoque − trânsito · FBS usa a
            velocidade da própria Shopee
          </p>
        </div>
        <form className="filter-row filter-form" method="get">
          <label>
            <span>Dias de estoque alvo</span>
            <input type="number" name="alvo" min={7} max={90} defaultValue={alvo} />
          </label>
          <label>
            <span>Prazo de reposição</span>
            <input type="number" name="prazo" min={0} max={30} defaultValue={prazo} />
          </label>
          {lojaFiltro ? <input type="hidden" name="loja" value={lojaFiltro} /> : null}
          <label>
            <span>Itens por loja</span>
            <input type="number" name="limite" min={1} max={100} defaultValue={limite} />
          </label>
          <button type="submit">Recalcular</button>
        </form>
      </header>

      <ShopeeTabs active="reposicao" />
      <LojaPills
        shops={shops}
        active={lojaFiltro}
        basePath="/shopee/reposicao"
        extraParams={{ alvo, prazo, limite }}
      />

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-blue">
          <span className="label">Itens sugeridos</span>
          <strong>{count(visiveis.length)}</strong>
          <small>máx. {limite} por loja</small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Unidades a repor</span>
          <strong>{count(totalUnidades)}</strong>
          <small>Para {horizonte} dias de cobertura</small>
        </article>
        <article className="metric accent-emerald">
          <span className="label">Venda protegida</span>
          <strong>{brl(totalGmv)}</strong>
          <small>GMV da reposição a preço de anúncio</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Perda estancada / dia</span>
          <strong>{brl(perdaEstancada)}</strong>
          <small>Se as rupturas forem repostas</small>
        </article>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">
              Priorizado por situação → curva → perda. O “porquê” de cada item está sob o título.
            </p>
            <h2>Itens para repor</h2>
          </div>
          <span className="pill">
            alvo {alvo}d + prazo {prazo}d
          </span>
        </div>
        <SortableTable
          columns={[
            { label: "Produto e justificativa" },
            { label: "Situação" },
            { label: "Curva" },
            { label: "Vendas 30/60d", numeric: true },
            { label: "Tendência 120→0", numeric: true },
            { label: "Média/dia", numeric: true },
            { label: "Cobertura", numeric: true },
            { label: "Perda/dia", numeric: true },
            { label: "Repor", numeric: true },
            { label: "Venda protegida", numeric: true },
            { label: "Custo (Olist)", numeric: true }
          ]}
          rows={rows}
          initialSort={1}
          initialDir="asc"
          showRank
        />
        {omitidos > 0 && (
          <p className="table-note">
            Exibindo até {limite} itens por loja — {count(omitidos)} candidatos de menor prioridade ficaram
            fora. Ajuste “Itens por loja” para ver mais.
          </p>
        )}
        {kitsExcluidos > 0 && (
          <p className="table-note">
            {count(kitsExcluidos)} kits ficaram fora da sugestão — kits são compostos de produtos simples;
            reponha os componentes.
          </p>
        )}
        <p className="table-note">
          Sugestões FBS usam a velocidade calculada pela própria Shopee e são limitadas ao estoque local
          disponível para envio; sugestões locais indicam reposição de compra/produção. Custo vem do livro
          de custos por SKU (cadastro abaixo &gt; Olist &gt; kits).
        </p>
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">
            Livro de custos ancorado no SKU do marketplace — tem prioridade sobre o custo do ERP
          </p>
          <h2>Cadastrar custos por SKU</h2>
        </div>
        <p className="table-note">
          Uma linha por SKU: <code>0770 12,50</code>. Os custos aparecem imediatamente nas colunas de
          margem/custo da Shopee e do Mercado Livre (mesmo livro). Dica: comece pelos SKUs listados na
          sugestão acima — são só {count(visiveis.length)}.
        </p>
        <form action={saveCustos} className="upload-form manual-form">
          <textarea name="linhas" rows={6} placeholder={"0770 12,50\n0771-100un 8,90\nSTRONDAL-PLUS 21,00"} />
          <button type="submit">Salvar custos</button>
        </form>
      </section>
    </AppShell>
  );
}
