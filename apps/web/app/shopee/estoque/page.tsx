import Link from "next/link";
import { requireCurrentUser } from "../../../lib/auth/session";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { SortableTable, type SortableCell } from "../../components/sortable-table";
import { LojaPills, ShopeeTabs } from "../tabs";
import { buildEstoqueReports } from "./build-estoque";
import { HINTS } from "../../../lib/column-hints";
import {
  type Curve,
  type ShopeeProduct,
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
  trendSlope,
  trendText,
  velocityOf
} from "../data";

export const dynamic = "force-dynamic";

const MAX_ROWS = 150;

const curveBadge: Record<Exclude<Curve, null>, string> = {
  A: "status-pill signal-good",
  B: "status-pill signal-warning",
  C: "status-pill signal-muted"
};

function curveCell(curve: Curve): SortableCell {
  return curve ? { text: `Curva ${curve}`, sort: curve, badge: curveBadge[curve] } : { text: "—", sort: null };
}

function productCell(product: { item_name?: string | null; model_name?: string | null; item_id: string; sku?: string | null; loja?: string }): SortableCell {
  const title = [product.item_name ?? product.item_id, product.model_name].filter(Boolean).join(" — ");
  return {
    text: title,
    sort: title,
    subtitle: [product.loja, product.sku ? `SKU ${product.sku}` : null].filter(Boolean).join(" · ")
  };
}

export default async function ShopeeEstoquePage({
  searchParams
}: {
  searchParams?: Promise<{ loja?: string }>;
}) {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const params = await searchParams;
  const lojaFiltro = Number(params?.loja) || null;

  const data = await loadShopeeData();
  if (!data) {
    return (
      <AppShell alertCount={alertCount}>
        <header className="topbar">
          <div>
            <h1>Estoque Shopee</h1>
            <p>Aguardando primeira sincronização de produtos.</p>
          </div>
        </header>
        <ShopeeTabs active="estoque" />
        <section className="panel">
          <div className="empty-state">
            <p>Nenhum produto sincronizado — verifique <code>shopee-sync-products</code> no <code>/status</code>.</p>
          </div>
        </section>
      </AppShell>
    );
  }

  const { shops } = data;
  const {
    shopName,
    curveOf,
    trendOf,
    fbsRuptura,
    fbsCobertura,
    fbsParado,
    localRuptura,
    localParado,
    fbsLoss,
    localLoss,
    capitalParado,
    fbsCriticos
  } = buildEstoqueReports(data, { loja: lojaFiltro });

  const exportQs = lojaFiltro ? `?loja=${lojaFiltro}` : "";

  const fbsRupturaRows: SortableCell[][] = fbsRuptura.map(({ row, lossPerDay }) => [
    productCell({ item_name: row.item_name, model_name: row.model_name, item_id: row.item_id, loja: shopName.get(row.shop_id) }),
    { text: row.whs_id, sort: row.whs_id, badge: "status-pill signal-muted" },
    { text: `${count(row.last_30_sold)} / ${count(row.last_60_sold)}`, sort: row.last_60_sold },
    { text: row.selling_speed.toFixed(1), sort: row.selling_speed },
    row.in_transit_qty > 0
      ? { text: `${count(row.in_transit_qty)} 🚚`, sort: row.in_transit_qty, badge: "status-pill signal-warning" }
      : { text: "—", sort: 0 },
    { text: brl(lossPerDay), sort: lossPerDay, badge: "status-pill signal-danger" }
  ]);

  const fbsCoberturaRows: SortableCell[][] = fbsCobertura.slice(0, MAX_ROWS).map(({ row }) => [
    productCell({ item_name: row.item_name, model_name: row.model_name, item_id: row.item_id, loja: shopName.get(row.shop_id) }),
    { text: row.whs_id, sort: row.whs_id, badge: "status-pill signal-muted" },
    { text: count(row.sellable_qty), sort: row.sellable_qty },
    row.in_transit_qty > 0 ? { text: `${count(row.in_transit_qty)} 🚚`, sort: row.in_transit_qty } : { text: "—", sort: 0 },
    { text: row.selling_speed.toFixed(1), sort: row.selling_speed },
    { text: `${Math.floor(n(row.coverage_days))} dias`, sort: n(row.coverage_days) },
    {
      text: n(row.coverage_days) < 7 ? "Crítico" : n(row.coverage_days) < 15 ? "Atenção" : "OK",
      sort: n(row.coverage_days) < 7 ? 0 : n(row.coverage_days) < 15 ? 1 : 2,
      badge:
        n(row.coverage_days) < 7
          ? "status-pill signal-danger"
          : n(row.coverage_days) < 15
            ? "status-pill signal-warning"
            : "status-pill signal-good"
    }
  ]);

  const localRupturaRows: SortableCell[][] = localRuptura.slice(0, MAX_ROWS).map(({ p, velocity, lossPerDay }) => [
    productCell({ item_name: p.item_name, model_name: p.model_name, item_id: p.item_id, sku: skuOf(p), loja: shopName.get(p.shop_id) }),
    curveCell(curveOf(p)),
    { text: `${count(p.sold_qty_30d)} / ${count(p.sold_qty_60d)}`, sort: p.sold_qty_60d },
    { text: trendText(trendOf(p)), sort: trendSlope(trendOf(p)) },
    { text: velocity.toFixed(1), sort: velocity },
    { text: brl(lossPerDay), sort: lossPerDay, badge: "status-pill signal-danger" },
    {
      text: daysSince(p.last_sale_at) != null ? `há ${daysSince(p.last_sale_at)}d` : "—",
      sort: daysSince(p.last_sale_at)
    }
  ]);

  const localParadoRows: SortableCell[][] = localParado.slice(0, MAX_ROWS).map(({ p, capital }) => [
    productCell({ item_name: p.item_name, model_name: p.model_name, item_id: p.item_id, sku: skuOf(p), loja: shopName.get(p.shop_id) }),
    curveCell(curveOf(p)),
    { text: brl(priceOf(p)), sort: priceOf(p) },
    { text: count(stockOf(p)), sort: stockOf(p) },
    { text: brl(capital), sort: capital, badge: "status-pill signal-warning" },
    {
      text: daysSince(p.last_sale_at) != null ? `há ${daysSince(p.last_sale_at)}d` : "nunca",
      sort: daysSince(p.last_sale_at)
    }
  ]);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Estoque Shopee</h1>
          <p>Estoque local dos anúncios + inventário FBS por armazém (dados da própria Shopee)</p>
        </div>
        <div className="filter-row">
          <Link className="button-link" href={`/shopee/estoque/export${exportQs}`}>
            Exportar .xlsx
          </Link>
        </div>
      </header>

      <ShopeeTabs active="estoque" />
      <LojaPills shops={shops} active={lojaFiltro} basePath="/shopee/estoque" />

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-red">
          <span className="label">Perda / dia — FBS</span>
          <strong>{brl(fbsLoss)}</strong>
          <small>{count(fbsRuptura.length)} SKUs zerados em armazém</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Perda / dia — local</span>
          <strong>{brl(localLoss)}</strong>
          <small>{count(localRuptura.length)} anúncios zerados com giro</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">FBS crítico</span>
          <strong>{count(fbsCriticos)}</strong>
          <small>Cobertura &lt; 7 dias (cálculo da Shopee)</small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Capital parado local</span>
          <strong>{brl(capitalParado)}</strong>
          <small>{count(localParado.length)} produtos sem venda 60d · {count(fbsParado.length)} parados no FBS</small>
        </article>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Armazéns da Shopee · velocidade e perda calculadas pela própria plataforma</p>
            <h2>Ruptura no FBS</h2>
          </div>
          <span className="pill">{count(fbsRuptura.length)} SKUs</span>
        </div>
        <SortableTable
          columns={[
            { label: "Produto" },
            { label: "Armazém", hint: HINTS.armazem },
            { label: "Vendas 30/60d", numeric: true, hint: HINTS.vendasFbs },
            { label: "Média/dia", numeric: true, hint: HINTS.mediaDiaFbs },
            { label: "Trânsito", numeric: true, hint: HINTS.transito },
            { label: "Perda/dia", numeric: true, hint: HINTS.perdaDia }
          ]}
          rows={fbsRupturaRows}
          initialSort={5}
          initialDir="desc"
        />
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Cobertura calculada pela Shopee (estoque + trânsito)</p>
            <h2>Cobertura no FBS</h2>
          </div>
          <span className="pill">{count(fbsCobertura.length)} SKUs com giro</span>
        </div>
        <SortableTable
          columns={[
            { label: "Produto" },
            { label: "Armazém", hint: HINTS.armazem },
            { label: "Vendável", numeric: true, hint: "Unidades disponíveis para venda no armazém da Shopee (não conta reservado nem avariado)." },
            { label: "Trânsito", numeric: true, hint: HINTS.transito },
            { label: "Média/dia", numeric: true, hint: HINTS.mediaDiaFbs },
            { label: "Cobertura", numeric: true, hint: HINTS.coberturaFbs },
            { label: "Status" }
          ]}
          rows={fbsCoberturaRows}
          initialSort={5}
          initialDir="asc"
        />
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Anúncios com estoque local zerado e histórico de venda em 60d</p>
            <h2>Ruptura — estoque local</h2>
          </div>
          <span className="pill">{count(localRuptura.length)} produtos</span>
        </div>
        <SortableTable
          columns={[
            { label: "Produto" },
            { label: "Curva", hint: HINTS.curva },
            { label: "Vendas 30/60d", numeric: true, hint: HINTS.vendas3060 },
            { label: "Tendência 120→0", numeric: true, hint: HINTS.tendencia },
            { label: "Média/dia", numeric: true, hint: HINTS.mediaDia },
            { label: "Perda/dia", numeric: true, hint: HINTS.perdaDia },
            { label: "Última venda", numeric: true, hint: HINTS.ultimaVenda }
          ]}
          rows={localRupturaRows}
          initialSort={5}
          initialDir="desc"
        />
        {localRuptura.length > MAX_ROWS && (
          <p className="table-note">Exibindo os {MAX_ROWS} de maior perda — {count(localRuptura.length - MAX_ROWS)} menores ocultos.</p>
        )}
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Estoque local sem venda em 60 dias</p>
            <h2>Estoque parado — local</h2>
          </div>
          <span className="pill">{brl(capitalParado)}</span>
        </div>
        <SortableTable
          columns={[
            { label: "Produto" },
            { label: "Curva", hint: HINTS.curva },
            { label: "Preço", numeric: true },
            { label: "Estoque", numeric: true, hint: "Unidades no estoque local do anúncio (fora dos armazéns da Shopee)." },
            { label: "Capital parado", numeric: true, hint: HINTS.capitalParado },
            { label: "Última venda", numeric: true, hint: HINTS.ultimaVenda }
          ]}
          rows={localParadoRows}
          initialSort={4}
          initialDir="desc"
        />
        {localParado.length > MAX_ROWS && (
          <p className="table-note">Exibindo os {MAX_ROWS} de maior capital — {count(localParado.length - MAX_ROWS)} menores ocultos.</p>
        )}
      </section>
    </AppShell>
  );
}
