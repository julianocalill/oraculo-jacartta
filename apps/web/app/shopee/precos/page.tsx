import Link from "next/link";
import { requireTabAccess } from "../../../lib/auth/access";
import { NoAccess } from "../../components/no-access";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { SortableTable, type SortableCell } from "../../components/sortable-table";
import { LojaPills, ShopeeTabs } from "../tabs";
import { brl } from "../data";
import { aplicaFiltro, loadPrecoProduto, type PrecoFiltro } from "./data";

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
  searchParams?: Promise<{ loja?: string; f?: string }>;
}) {
  const params = await searchParams;
  const lojaFiltro = Number(params?.loja) || null;
  const filtro = (FILTROS.some((f) => f.key === params?.f) ? params?.f : "todos") as PrecoFiltro;

  const [{ allowed }, alertCount, todos] = await Promise.all([
    requireTabAccess("shopee"),
    loadActionableAlertCount(),
    loadPrecoProduto()
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

  const daLoja = lojaFiltro ? todos.filter((r) => r.shop_id === lojaFiltro) : todos;
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
  const filtroQs = (f: PrecoFiltro) => {
    const p = new URLSearchParams();
    if (lojaFiltro) p.set("loja", String(lojaFiltro));
    if (f !== "todos") p.set("f", f);
    const qs = p.toString();
    return qs ? `/shopee/precos?${qs}` : "/shopee/precos";
  };

  const rows: SortableCell[][] = visiveis
    .slice()
    .sort((a, b) => (a.profit_unit ?? Infinity) - (b.profit_unit ?? Infinity))
    .slice(0, MAX_ROWS)
    .map((r) => [
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
      { text: r.pedidos ? String(r.pedidos) : "—", sort: r.pedidos },
      (r.checagem ?? "").startsWith("⚠")
        ? { text: r.checagem!, sort: 0, badge: "status-pill signal-warning" }
        : { text: r.checagem || "—", sort: r.checagem === "ok" ? 1 : null }
    ]);

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
        <Link className="button-link" href={`/shopee/precos/export${exportQs.toString() ? `?${exportQs}` : ""}`}>
          Exportar (.xlsx)
        </Link>
      </header>
      <ShopeeTabs active="precos" />
      <LojaPills shops={shops} active={lojaFiltro} basePath="/shopee/precos" extraParams={filtro !== "todos" ? { f: filtro } : {}} />

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

      <div className="pill-row" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {FILTROS.map((f) => (
          <Link key={f.key} href={filtroQs(f.key)} className={filtro === f.key ? "pill pill-gold" : "pill"}>
            {f.label}
          </Link>
        ))}
      </div>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">
            {visiveis.length} anúncios{visiveis.length > MAX_ROWS ? ` · exibindo os ${MAX_ROWS} piores` : ""}
          </p>
        </div>
        <SortableTable
          columns={[
            { label: "Anúncio" },
            { label: "Preço", numeric: true, hint: "Preço atual na Shopee (promoção inclusa), sync de hora em hora" },
            { label: "SKU Olist", hint: "Produto do ERP que a venda baixa (de-para por pedidos casados)" },
            { label: "QTD", numeric: true, hint: "Unidades Olist por unidade do anúncio" },
            { label: "Custo unit.", numeric: true, hint: "Kit → valor da aba de kits da Olist · unitário → preço de custo do cadastro" },
            { label: "Custo total", numeric: true },
            { label: "Lucro/venda", numeric: true, hint: "Fórmula: preço − custo − comissão − taxa fixa − 1,3% − 6% − 9,25%×(preço−custo) − 3% − 3% − R$1" },
            { label: "Pedidos", numeric: true, hint: "Pedidos casados que sustentam o vínculo" },
            { label: "Checagem", hint: "⚠ = dimensão/volume/peso do anúncio conflita com o produto Olist, ou evidência de 1 pedido" }
          ]}
          rows={rows}
          initialSort={6}
          initialDir="asc"
          showRank
        />
      </section>
    </AppShell>
  );
}
