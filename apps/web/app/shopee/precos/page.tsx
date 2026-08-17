import Link from "next/link";
import { requireTabAccess } from "../../../lib/auth/access";
import { NoAccess } from "../../components/no-access";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { SortableTable, type SortableCell } from "../../components/sortable-table";
import { LojaPills, ShopeeTabs } from "../tabs";
import { brl } from "../data";
import {
  agrupaPorSku,
  aplicaBusca,
  aplicaFiltro,
  chaveVenda,
  loadPrecoProduto,
  loadVendasPeriodo,
  normalizaPeriodo,
  type PrecoFiltro,
  type VendasPeriodo
} from "./data";

export const dynamic = "force-dynamic";

const MAX_ROWS = 200;

const FILTROS: { key: PrecoFiltro; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "prejuizo", label: "Em prejuízo" },
  { key: "lucro", label: "Com lucro" },
  { key: "sem-custo", label: "Sem custo" },
  { key: "atencao", label: "⚠ Checagem" }
];

export default async function ShopeePrecosPage({
  searchParams
}: {
  searchParams?: Promise<{ loja?: string; f?: string; q?: string; de?: string; ate?: string; v?: string }>;
}) {
  const params = await searchParams;
  const lojaFiltro = Number(params?.loja) || null;
  const filtro = (FILTROS.some((f) => f.key === params?.f) ? params?.f : "todos") as PrecoFiltro;
  const busca = (params?.q ?? "").trim();
  const periodo = normalizaPeriodo(params?.de, params?.ate);
  const porSku = params?.v === "sku";

  const [{ allowed }, alertCount, todos, vendas] = await Promise.all([
    requireTabAccess("shopee"),
    loadActionableAlertCount(),
    loadPrecoProduto(),
    periodo ? loadVendasPeriodo(periodo.de, periodo.ate) : Promise.resolve(null as VendasPeriodo | null)
  ]);
  if (!allowed) return <NoAccess tab="shopee" />;

  if (todos.length === 0) {
    return (
      <AppShell alertCount={alertCount}>
        <header className="topbar">
          <div>
            <h1>Preço × Custo Shopee</h1>
            <p>Aguardando o primeiro cálculo (cron de hora em hora, minuto 57).</p>
          </div>
        </header>
        <ShopeeTabs active="precos" />
      </AppShell>
    );
  }

  const shops = [...new Map(todos.map((r) => [r.shop_id, r.shop_name])).entries()]
    .map(([shop_id, shop_name]) => ({ shop_id, shop_name }))
    .sort((a, b) => (a.shop_name ?? "").localeCompare(b.shop_name ?? ""));

  let daLoja = aplicaBusca(lojaFiltro ? todos.filter((r) => r.shop_id === lojaFiltro) : todos, busca);
  // Com período ativo, só quem vendeu no intervalo entra na análise.
  if (vendas) daLoja = daLoja.filter((r) => vendas.has(chaveVenda(r)));
  const comCusto = daLoja.filter((r) => r.profit_unit !== null);
  const prejuizo = comCusto.filter((r) => r.profit_unit! < 0);
  const atencao = daLoja.filter((r) => (r.checagem ?? "").startsWith("⚠"));
  const visiveis = aplicaFiltro(daLoja, filtro);

  const refreshedAt = new Date(todos[0].refreshed_at).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
  const exportQs = new URLSearchParams();
  if (lojaFiltro) exportQs.set("loja", String(lojaFiltro));
  if (filtro !== "todos") exportQs.set("f", filtro);
  if (busca) exportQs.set("q", busca);
  if (periodo) {
    exportQs.set("de", periodo.de);
    exportQs.set("ate", periodo.ate);
  }
  if (porSku) exportQs.set("v", "sku");
  const urlCom = (mut: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams();
    if (lojaFiltro) p.set("loja", String(lojaFiltro));
    if (filtro !== "todos") p.set("f", filtro);
    if (busca) p.set("q", busca);
    if (periodo) {
      p.set("de", periodo.de);
      p.set("ate", periodo.ate);
    }
    if (porSku) p.set("v", "sku");
    mut(p);
    const qs = p.toString();
    return qs ? `/shopee/precos?${qs}` : "/shopee/precos";
  };
  const filtroQs = (f: PrecoFiltro) => urlCom((p) => (f === "todos" ? p.delete("f") : p.set("f", f)));
  const visaoQs = (v: "anuncio" | "sku") => urlCom((p) => (v === "sku" ? p.set("v", "sku") : p.delete("v")));
  const hoje = new Date().toISOString().slice(0, 10);
  const minData = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);

  const rows: SortableCell[][] = visiveis
    .slice()
    .sort((a, b) => (a.profit_unit ?? Infinity) - (b.profit_unit ?? Infinity))
    .slice(0, MAX_ROWS)
    .map((r) => {
      const venda = vendas?.get(chaveVenda(r));
      const lucroPeriodo =
        venda && r.profit_unit !== null ? Number((venda.units * r.profit_unit).toFixed(2)) : null;
      const extras: SortableCell[] = vendas
        ? [
            { text: venda ? String(venda.units) : "0", sort: venda?.units ?? 0 },
            lucroPeriodo !== null
              ? {
                  text: brl(lucroPeriodo),
                  sort: lucroPeriodo,
                  badge: lucroPeriodo < 0 ? "status-pill signal-danger" : "status-pill signal-good"
                }
              : { text: "—", sort: null }
          ]
        : [];
      return [
      {
        text: [r.item_name ?? r.item_id, r.model_name].filter(Boolean).join(" — "),
        sort: r.item_name ?? r.item_id,
        subtitle: [r.shop_name, r.channel_sku ? `SKU ${r.channel_sku}` : `Item ${r.item_id}`]
          .filter(Boolean)
          .join(" · ")
      },
      { text: r.price !== null ? brl(r.price) : "—", sort: r.price },
      {
        text: r.sku_olist ?? "—",
        sort: r.sku_olist,
        subtitle: r.olist_product_name ?? undefined
      },
      { text: r.qtd !== null ? String(r.qtd) : "—", sort: r.qtd },
      { text: r.unit_cost !== null ? brl(r.unit_cost) : "—", sort: r.unit_cost },
      { text: r.cost_total !== null ? brl(r.cost_total) : "—", sort: r.cost_total },
      r.profit_unit !== null
        ? {
            text: brl(r.profit_unit),
            sort: r.profit_unit,
            badge: r.profit_unit < 0 ? "status-pill signal-danger" : "status-pill signal-good"
          }
        : { text: "—", sort: null },
      ...extras,
      { text: r.pedidos ? String(r.pedidos) : "—", sort: r.pedidos },
      (r.checagem ?? "").startsWith("⚠")
        ? { text: r.checagem!, sort: 0, badge: "status-pill signal-warning" }
        : { text: r.checagem || "—", sort: r.checagem === "ok" ? 1 : null }
      ];
    });

  const grupos = porSku ? agrupaPorSku(visiveis, vendas) : null;
  const gruposOrdenados = (grupos ?? [])
    .slice()
    .sort((a, b) =>
      vendas
        ? (a.lucro_periodo ?? Infinity) - (b.lucro_periodo ?? Infinity)
        : (a.profit_min ?? Infinity) - (b.profit_min ?? Infinity)
    )
    .slice(0, MAX_ROWS);

  const linhasGrupo: SortableCell[][] = gruposOrdenados.map((g) => [
    { text: g.sku_olist, sort: g.sku_olist, subtitle: g.olist_product_name ?? undefined },
    { text: String(g.anuncios), sort: g.anuncios, subtitle: g.lojas.join(" · ") },
    {
      text:
        g.price_min === null
          ? "—"
          : g.price_min === g.price_max
            ? brl(g.price_min)
            : `${brl(g.price_min)} – ${brl(g.price_max!)}`,
      sort: g.price_min
    },
    { text: g.unit_cost !== null ? brl(g.unit_cost) : "—", sort: g.unit_cost },
    g.profit_min !== null
      ? {
          text: brl(g.profit_min),
          sort: g.profit_min,
          badge: g.profit_min < 0 ? "status-pill signal-danger" : "status-pill signal-good"
        }
      : { text: "—", sort: null },
    g.profit_max !== null
      ? {
          text: brl(g.profit_max),
          sort: g.profit_max,
          badge: g.profit_max < 0 ? "status-pill signal-danger" : "status-pill signal-good"
        }
      : { text: "—", sort: null },
    { text: g.em_prejuizo ? String(g.em_prejuizo) : "—", sort: g.em_prejuizo },
    ...(vendas
      ? [
          {
            text: g.vendas_unidades_olist !== null ? String(g.vendas_unidades_olist) : "0",
            sort: g.vendas_unidades_olist ?? 0
          },
          g.lucro_periodo !== null
            ? {
                text: brl(g.lucro_periodo),
                sort: g.lucro_periodo,
                badge: g.lucro_periodo < 0 ? "status-pill signal-danger" : "status-pill signal-good"
              }
            : ({ text: "—", sort: null } as SortableCell)
        ]
      : []),
    g.alertas > 0
      ? { text: `⚠ ${g.alertas}`, sort: g.alertas, badge: "status-pill signal-warning" }
      : { text: "—", sort: 0 }
  ]);

  const semSku = visiveis.filter((r) => !r.sku_olist).length;

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Preço × Custo Shopee</h1>
          <p>
            Lucro/prejuízo por anúncio ao preço atual · custo Olist pela regra kit/unitário ·
            recalculado às {refreshedAt}
          </p>
        </div>
        <form className="filter-row filter-form" method="get" action="/shopee/precos">
          {lojaFiltro ? <input type="hidden" name="loja" value={lojaFiltro} /> : null}
          {filtro !== "todos" ? <input type="hidden" name="f" value={filtro} /> : null}
          {porSku ? <input type="hidden" name="v" value="sku" /> : null}
          <label>
            <span>Buscar</span>
            <input
              type="search"
              name="q"
              defaultValue={busca}
              placeholder="SKU ou nome do produto"
              style={{ minWidth: 220 }}
            />
          </label>
          <label>
            <span>Vendas de</span>
            <input type="date" name="de" defaultValue={periodo?.de ?? ""} min={minData} max={hoje} />
          </label>
          <label>
            <span>até</span>
            <input type="date" name="ate" defaultValue={periodo?.ate ?? ""} min={minData} max={hoje} />
          </label>
          <button type="submit">Aplicar</button>
          <Link className="button-link" href={`/shopee/precos/export${exportQs.toString() ? `?${exportQs}` : ""}`}>
            Exportar (.xlsx)
          </Link>
        </form>
      </header>
      <ShopeeTabs active="precos" />
      <LojaPills
        shops={shops}
        active={lojaFiltro}
        basePath="/shopee/precos"
        extraParams={{
          ...(filtro !== "todos" ? { f: filtro } : {}),
          ...(busca ? { q: busca } : {}),
          ...(periodo ? { de: periodo.de, ate: periodo.ate } : {}),
          ...(porSku ? { v: "sku" } : {})
        }}
      />

      <section className="panel coverage-panel" style={{ marginBottom: 16 }}>
        <div className="coverage-grid">
          <article>
            <span>Anúncios ativos</span>
            <strong>{daLoja.length}</strong>
            <small>{comCusto.length} com custo resolvido</small>
          </article>
          <article>
            <span>Em prejuízo</span>
            <strong>{prejuizo.length}</strong>
            <small>
              pior: {prejuizo.length ? `${brl(Math.min(...prejuizo.map((r) => r.profit_unit!)))} por venda` : "—"}
            </small>
          </article>
          <article>
            <span>Sem custo</span>
            <strong>{daLoja.length - comCusto.length}</strong>
            <small>sem venda casada ou custo zerado no ERP</small>
          </article>
          <article>
            <span>⚠ Checagem</span>
            <strong>{atencao.length}</strong>
            <small>conflito de modelo ou evidência fraca</small>
          </article>
        </div>
      </section>

      <div className="pill-row" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {FILTROS.map((f) => (
          <Link key={f.key} href={filtroQs(f.key)} className={filtro === f.key ? "pill pill-gold" : "pill"}>
            {f.label}
          </Link>
        ))}
        <span style={{ width: 16 }} />
        <Link href={visaoQs("anuncio")} className={!porSku ? "pill pill-gold" : "pill"}>
          Por anúncio
        </Link>
        <Link href={visaoQs("sku")} className={porSku ? "pill pill-gold" : "pill"}>
          Por SKU
        </Link>
      </div>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">
            {porSku
              ? `${grupos!.length} SKUs · ${visiveis.length - semSku} anúncios mapeados${semSku ? ` · ${semSku} anúncios sem SKU (ver visão por anúncio)` : ""}`
              : `${visiveis.length} anúncios`}
            {periodo ? ` · com venda entre ${periodo.de.split("-").reverse().join("/")} e ${periodo.ate.split("-").reverse().join("/")}` : ""}
            {(porSku ? grupos!.length : visiveis.length) > MAX_ROWS ? ` · exibindo os ${MAX_ROWS} piores` : ""}
          </p>
        </div>
        {porSku ? (
          <SortableTable
            columns={[
              { label: "SKU Olist", hint: "Produto do ERP; agrega todos os anúncios que baixam este SKU" },
              { label: "Anúncios", numeric: true, hint: "Quantos anúncios/variações apontam para este SKU" },
              { label: "Preço", numeric: true, hint: "Faixa de preço atual entre os anúncios do SKU" },
              { label: "Custo unit.", numeric: true, hint: "Kit → valor da aba de kits da Olist · unitário → preço de custo do cadastro" },
              { label: "Pior lucro/venda", numeric: true, hint: "Menor lucro por venda entre os anúncios do SKU" },
              { label: "Melhor lucro/venda", numeric: true },
              { label: "Anúncios em prejuízo", numeric: true },
              ...(vendas
                ? [
                    { label: "Vendas período (un. Olist)", numeric: true, hint: "Unidades OLIST vendidas no intervalo (unidades do anúncio × QTD)" },
                    { label: "Lucro período", numeric: true, hint: "Soma dos anúncios: vendas × lucro AO PREÇO ATUAL (não é o lucro histórico)" }
                  ]
                : []),
              { label: "⚠", numeric: true, hint: "Anúncios do SKU com alerta de checagem de modelo/evidência" }
            ]}
            rows={linhasGrupo}
            initialSort={vendas ? 8 : 4}
            initialDir="asc"
            showRank
          />
        ) : (
          <SortableTable
            columns={[
              { label: "Anúncio" },
              { label: "Preço", numeric: true, hint: "Preço atual na Shopee (promoção inclusa), sync de hora em hora" },
              { label: "SKU Olist", hint: "Produto do ERP que a venda baixa (de-para por pedidos casados)" },
              { label: "QTD", numeric: true, hint: "Unidades Olist por unidade do anúncio" },
              { label: "Custo unit.", numeric: true, hint: "Kit → valor da aba de kits da Olist · unitário → preço de custo do cadastro" },
              { label: "Custo total", numeric: true },
              { label: "Lucro/venda", numeric: true, hint: "Fórmula: preço − custo − comissão − taxa fixa − 1,3% − 6% − 9,25%×(preço−custo) − 3% − 3% − R$1" },
              ...(vendas
                ? [
                    { label: "Vendas período", numeric: true, hint: "Unidades vendidas no intervalo escolhido (cancelados e não pagos fora)" },
                    { label: "Lucro período", numeric: true, hint: "Vendas do período × lucro por venda AO PREÇO ATUAL (não é o lucro histórico)" }
                  ]
                : []),
              { label: "Pedidos", numeric: true, hint: "Pedidos casados que sustentam o vínculo" },
              { label: "Checagem", hint: "⚠ = dimensão/volume/peso do anúncio conflita com o produto Olist, ou evidência de 1 pedido" }
            ]}
            rows={rows}
            initialSort={vendas ? 8 : 6}
            initialDir="asc"
            showRank
          />
        )}
      </section>
    </AppShell>
  );
}
