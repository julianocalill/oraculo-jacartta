// Export .xlsx do Preço × Custo Shopee — mesmo conteúdo da aba, com os mesmos
// filtros da URL (loja, f). Substitui a planilha manual de agosto/2026
// (analises/preco-produto-shopee-2026-08/).
import { NextRequest } from "next/server";
import { getCurrentUser } from "../../../../lib/auth/session";
import { canAccess } from "../../../../lib/auth/access";
import { buildXlsx, fileStamp, xlsxResponse, type XlsxColumn } from "../../../../lib/xlsx";
import {
  agrupaPorSku,
  aplicaBusca,
  aplicaFiltro,
  chaveVenda,
  loadPrecoProduto,
  loadVendasPeriodo,
  normalizaPeriodo,
  type PrecoFiltro
} from "../data";

export const dynamic = "force-dynamic";

const SKU_COLUMNS: XlsxColumn[] = [
  { header: "SKU Olist", key: "skuOlist", width: 20 },
  { header: "Produto Olist", key: "produtoOlist", width: 44 },
  { header: "Anúncios", key: "anuncios", width: 10, type: "number" },
  { header: "Lojas", key: "lojas", width: 34 },
  { header: "Preço mín.", key: "precoMin", width: 11, type: "money" },
  { header: "Preço máx.", key: "precoMax", width: 11, type: "money" },
  { header: "Custo unit.", key: "unitCost", width: 12, type: "money" },
  { header: "Pior lucro/venda", key: "piorLucro", width: 15, type: "money" },
  { header: "Melhor lucro/venda", key: "melhorLucro", width: 17, type: "money" },
  { header: "Anúncios em prejuízo", key: "emPrejuizo", width: 19, type: "number" },
  { header: "Vendas período (un. Olist)", key: "vendasPeriodo", width: 22, type: "number" },
  { header: "Lucro período", key: "lucroPeriodo", width: 13, type: "money" },
  { header: "Alertas ⚠", key: "alertas", width: 10, type: "number" }
];

const COLUMNS: XlsxColumn[] = [
  { header: "Loja", key: "loja", width: 18 },
  { header: "Anúncio", key: "anuncio", width: 52 },
  { header: "Variação", key: "variacao", width: 24 },
  { header: "SKU anúncio", key: "skuAnuncio", width: 22 },
  { header: "Item ID", key: "itemId", width: 14 },
  { header: "ID variação", key: "modelId", width: 14 },
  { header: "Preço", key: "preco", width: 11, type: "money" },
  { header: "SKU Olist", key: "skuOlist", width: 18 },
  { header: "Produto Olist", key: "produtoOlist", width: 44 },
  { header: "QTD", key: "qtd", width: 7, type: "number" },
  { header: "Custo unit.", key: "unitCost", width: 12, type: "money" },
  { header: "Custo total", key: "custoTotal", width: 12, type: "money" },
  { header: "Lucro/venda", key: "lucro", width: 12, type: "money" },
  { header: "Vendas período", key: "vendasPeriodo", width: 14, type: "number" },
  { header: "Lucro período", key: "lucroPeriodo", width: 13, type: "money" },
  { header: "Pedidos", key: "pedidos", width: 9, type: "number" },
  { header: "Origem do custo", key: "origem", width: 56 },
  { header: "Checagem", key: "checagem", width: 44 }
];

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Não autorizado", { status: 401 });
  if (!canAccess(user, "shopee")) return new Response("Sem acesso a esta aba", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const loja = Number(sp.get("loja")) || null;
  const filtro = (sp.get("f") ?? "todos") as PrecoFiltro;
  const busca = (sp.get("q") ?? "").trim();
  const periodo = normalizaPeriodo(sp.get("de") ?? undefined, sp.get("ate") ?? undefined);

  const [todos, vendas] = await Promise.all([
    loadPrecoProduto(),
    periodo ? loadVendasPeriodo(periodo.de, periodo.ate) : Promise.resolve(null)
  ]);
  if (todos.length === 0) return new Response("Cache vazio", { status: 404 });

  let base = aplicaBusca(loja ? todos.filter((r) => r.shop_id === loja) : todos, busca);
  if (vendas) base = base.filter((r) => vendas.has(chaveVenda(r)));
  const porSku = sp.get("v") === "sku";

  const refreshedAt0 = new Date(todos[0].refreshed_at).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
  const geradoEm0 = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  if (porSku) {
    const grupos = agrupaPorSku(aplicaFiltro(base, filtro), vendas)
      .sort((a, b) =>
        vendas
          ? (a.lucro_periodo ?? Infinity) - (b.lucro_periodo ?? Infinity)
          : (a.profit_min ?? Infinity) - (b.profit_min ?? Infinity)
      )
      .map((g) => ({
        skuOlist: g.sku_olist,
        produtoOlist: g.olist_product_name ?? "",
        anuncios: g.anuncios,
        lojas: g.lojas.join(" · "),
        precoMin: g.price_min,
        precoMax: g.price_max,
        unitCost: g.unit_cost,
        piorLucro: g.profit_min,
        melhorLucro: g.profit_max,
        emPrejuizo: g.em_prejuizo,
        vendasPeriodo: g.vendas_unidades_olist,
        lucroPeriodo: g.lucro_periodo,
        alertas: g.alertas
      }));
    const buffer = await buildXlsx({
      sheetName: "Por SKU Olist",
      columns: SKU_COLUMNS,
      rows: grupos,
      meta: [
        `Oráculo · Preço × Custo Shopee AGRUPADO POR SKU · gerado em ${geradoEm0} · dados recalculados em ${refreshedAt0}`,
        "Um SKU agrega todos os anúncios que o baixam. Vendas período em UNIDADES OLIST (unidades do anúncio × QTD). " +
          "Lucro período = soma de vendas × lucro AO PREÇO ATUAL.",
        `${grupos.length} SKUs · filtro: ${filtro}${loja ? ` · loja ${loja}` : ""}${busca ? ` · busca: "${busca}"` : ""}` +
          (periodo ? ` · vendas de ${periodo.de} a ${periodo.ate}` : "")
      ]
    });
    return xlsxResponse(buffer, `oraculo-preco-custo-shopee-por-sku_${fileStamp()}.xlsx`);
  }

  const rows = aplicaFiltro(base, filtro)
    .slice()
    .sort((a, b) => (a.profit_unit ?? Infinity) - (b.profit_unit ?? Infinity))
    .map((r) => ({
      vendasPeriodo: vendas ? vendas.get(chaveVenda(r))?.units ?? 0 : null,
      lucroPeriodo:
        vendas && r.profit_unit !== null
          ? Number(((vendas.get(chaveVenda(r))?.units ?? 0) * r.profit_unit).toFixed(2))
          : null,
      loja: r.shop_name ?? String(r.shop_id),
      anuncio: r.item_name ?? r.item_id,
      variacao: r.model_name ?? "",
      skuAnuncio: r.channel_sku ?? "",
      itemId: r.item_id,
      modelId: r.model_id === "0" ? "" : r.model_id,
      preco: r.price,
      skuOlist: r.sku_olist ?? "",
      produtoOlist: r.olist_product_name ?? "",
      qtd: r.qtd,
      unitCost: r.unit_cost,
      custoTotal: r.cost_total,
      lucro: r.profit_unit,
      pedidos: r.pedidos,
      origem: r.origem ?? "",
      checagem: r.checagem ?? ""
    }));

  const refreshedAt = new Date(todos[0].refreshed_at).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo"
  });
  const geradoEm = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const buffer = await buildXlsx({
    sheetName: "Preço × Custo Shopee",
    columns: COLUMNS,
    rows,
    meta: [
      `Oráculo · Preço × Custo Shopee · gerado em ${geradoEm} · dados recalculados em ${refreshedAt} (cron de hora em hora)`,
      "Custo: anúncio de KIT usa o valor da aba de kits da Olist; produto unitário usa o preço de custo do cadastro. " +
        "Lucro = preço − custo − comissão Shopee − taxa fixa − 1,3% − 6% − 9,25%×(preço−custo) − 3% − 3% − R$1.",
      `${rows.length} anúncios · filtro: ${filtro}${loja ? ` · loja ${loja}` : ""}${busca ? ` · busca: "${busca}"` : ""}` +
        (periodo ? ` · vendas de ${periodo.de} a ${periodo.ate} (lucro período = vendas × lucro ao preço ATUAL)` : "")
    ]
  });

  return xlsxResponse(buffer, `oraculo-preco-custo-shopee_${fileStamp()}.xlsx`);
}
