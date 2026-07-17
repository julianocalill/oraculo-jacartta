// Export .xlsx da aba Estoque & FBS da Shopee. Usa o MESMO builder da tela,
// com o mesmo filtro de loja. Cada relatório da página vira uma aba:
// Ruptura FBS · Cobertura FBS · Parado FBS · Ruptura local · Parado local.
import { NextRequest } from "next/server";
import { getCurrentUser } from "../../../../lib/auth/session";
import { buildXlsxWorkbook, fileStamp, xlsxResponse, type XlsxColumn } from "../../../../lib/xlsx";
import { loadShopeeData, n, priceOf, skuOf, stockOf, daysSince, trendText } from "../../data";
import { buildEstoqueReports } from "../build-estoque";

export const dynamic = "force-dynamic";

const FBS_RUPTURA: XlsxColumn[] = [
  { header: "Loja", key: "loja", width: 18 },
  { header: "Produto", key: "produto", width: 52 },
  { header: "Variação", key: "variacao", width: 22 },
  { header: "Item ID", key: "itemId", width: 14 },
  { header: "Armazém", key: "whs", width: 10 },
  { header: "Vendas 30d", key: "v30", width: 11, type: "number" },
  { header: "Vendas 60d", key: "v60", width: 11, type: "number" },
  { header: "Média/dia", key: "media", width: 10, type: "decimal" },
  { header: "Trânsito", key: "transito", width: 10, type: "number" },
  { header: "Preço", key: "preco", width: 12, type: "money" },
  { header: "Perda/dia", key: "perda", width: 12, type: "money" }
];

const FBS_COBERTURA: XlsxColumn[] = [
  { header: "Loja", key: "loja", width: 18 },
  { header: "Produto", key: "produto", width: 52 },
  { header: "Variação", key: "variacao", width: 22 },
  { header: "Armazém", key: "whs", width: 10 },
  { header: "Vendável", key: "vendavel", width: 10, type: "number" },
  { header: "Reservado", key: "reservado", width: 10, type: "number" },
  { header: "Trânsito", key: "transito", width: 10, type: "number" },
  { header: "Média/dia", key: "media", width: 10, type: "decimal" },
  { header: "Cobertura (dias)", key: "cobertura", width: 15, type: "number" },
  { header: "Status", key: "status", width: 10 },
  { header: "Preço", key: "preco", width: 12, type: "money" }
];

const FBS_PARADO: XlsxColumn[] = [
  { header: "Loja", key: "loja", width: 18 },
  { header: "Produto", key: "produto", width: 52 },
  { header: "Variação", key: "variacao", width: 22 },
  { header: "Armazém", key: "whs", width: 10 },
  { header: "Vendável", key: "vendavel", width: 10, type: "number" },
  { header: "Vendas 90d", key: "v90", width: 11, type: "number" },
  { header: "Preço", key: "preco", width: 12, type: "money" },
  { header: "Capital parado", key: "capital", width: 15, type: "money" }
];

const LOCAL_RUPTURA: XlsxColumn[] = [
  { header: "Loja", key: "loja", width: 18 },
  { header: "Produto", key: "produto", width: 52 },
  { header: "SKU", key: "sku", width: 16 },
  { header: "Curva", key: "curva", width: 7 },
  { header: "Vendas 30d", key: "v30", width: 11, type: "number" },
  { header: "Vendas 60d", key: "v60", width: 11, type: "number" },
  { header: "Tendência 120→0", key: "tendencia", width: 18 },
  { header: "Média/dia", key: "media", width: 10, type: "decimal" },
  { header: "Preço", key: "preco", width: 12, type: "money" },
  { header: "Perda/dia", key: "perda", width: 12, type: "money" },
  { header: "Última venda (dias)", key: "idle", width: 17, type: "number" },
  { header: "Custo unit.", key: "custo", width: 12, type: "money" }
];

const LOCAL_PARADO: XlsxColumn[] = [
  { header: "Loja", key: "loja", width: 18 },
  { header: "Produto", key: "produto", width: 52 },
  { header: "SKU", key: "sku", width: 16 },
  { header: "Curva", key: "curva", width: 7 },
  { header: "Preço", key: "preco", width: 12, type: "money" },
  { header: "Estoque", key: "estoque", width: 10, type: "number" },
  { header: "Capital parado", key: "capital", width: 15, type: "money" },
  { header: "Última venda (dias)", key: "idle", width: 17, type: "number" },
  { header: "Custo unit.", key: "custo", width: 12, type: "money" }
];

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Não autorizado", { status: 401 });

  const loja = Number(req.nextUrl.searchParams.get("loja")) || null;
  const data = await loadShopeeData();
  if (!data) return new Response("Sem dados sincronizados", { status: 404 });

  const r = buildEstoqueReports(data, { loja });
  const nomeLoja = loja ? r.shopName.get(loja) ?? String(loja) : "Todas as lojas";
  const geradoEm = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const head = (titulo: string, extra: string) => [
    `Oráculo · ${titulo} · Shopee · ${nomeLoja} · gerado em ${geradoEm}`,
    extra
  ];

  const buffer = await buildXlsxWorkbook([
    {
      sheetName: "Ruptura FBS",
      columns: FBS_RUPTURA,
      meta: head(
        "Ruptura no FBS",
        `SKU zerado no armazém com giro · velocidade e trânsito informados pela Shopee · perda/dia total R$ ${r.fbsLoss.toFixed(2)}`
      ),
      rows: r.fbsRuptura.map(({ row, preco, lossPerDay }) => ({
        loja: r.shopName.get(row.shop_id) ?? String(row.shop_id),
        produto: row.item_name ?? row.item_id,
        variacao: row.model_name ?? "",
        itemId: String(row.shop_item_id ?? row.item_id),
        whs: row.whs_id,
        v30: row.last_30_sold,
        v60: row.last_60_sold,
        media: Number(row.selling_speed.toFixed(1)),
        transito: row.in_transit_qty,
        preco: preco || null,
        perda: lossPerDay || null
      }))
    },
    {
      sheetName: "Cobertura FBS",
      columns: FBS_COBERTURA,
      meta: head(
        "Cobertura no FBS",
        `Cobertura em dias calculada pela Shopee (vendável + entrada pendente) · ${r.fbsCriticos} SKUs abaixo de 7 dias`
      ),
      rows: r.fbsCobertura.map(({ row, preco }) => ({
        loja: r.shopName.get(row.shop_id) ?? String(row.shop_id),
        produto: row.item_name ?? row.item_id,
        variacao: row.model_name ?? "",
        whs: row.whs_id,
        vendavel: row.sellable_qty,
        reservado: row.reserved_qty,
        transito: row.in_transit_qty,
        media: Number(row.selling_speed.toFixed(1)),
        cobertura: Math.floor(n(row.coverage_days)),
        status: n(row.coverage_days) < 7 ? "Crítico" : n(row.coverage_days) < 15 ? "Atenção" : "OK",
        preco: preco || null
      }))
    },
    {
      sheetName: "Parado FBS",
      columns: FBS_PARADO,
      meta: head("Estoque parado no FBS", "SKUs marcados como sem movimento (not_moving_tag) pela Shopee"),
      rows: r.fbsParado.map(({ row, preco, capital }) => ({
        loja: r.shopName.get(row.shop_id) ?? String(row.shop_id),
        produto: row.item_name ?? row.item_id,
        variacao: row.model_name ?? "",
        whs: row.whs_id,
        vendavel: row.sellable_qty,
        v90: row.last_90_sold,
        preco: preco || null,
        capital: capital || null
      }))
    },
    {
      sheetName: "Ruptura local",
      columns: LOCAL_RUPTURA,
      meta: head(
        "Ruptura no estoque local",
        `Anúncio zerado com venda nos últimos 60 dias · perda/dia total R$ ${r.localLoss.toFixed(2)}`
      ),
      rows: r.localRuptura.map(({ p, velocity, lossPerDay }) => ({
        loja: r.shopName.get(p.shop_id) ?? String(p.shop_id),
        produto: [p.item_name ?? p.item_id, p.model_name].filter(Boolean).join(" — "),
        sku: skuOf(p) ?? "",
        curva: r.curveOf(p) ? `Curva ${r.curveOf(p)}` : "",
        v30: p.sold_qty_30d,
        v60: p.sold_qty_60d,
        tendencia: trendText(r.trendOf(p)),
        media: Number(velocity.toFixed(1)),
        preco: priceOf(p) || null,
        perda: lossPerDay || null,
        idle: daysSince(p.last_sale_at),
        custo: r.costOf(p)
      }))
    },
    {
      sheetName: "Parado local",
      columns: LOCAL_PARADO,
      meta: head(
        "Estoque parado local",
        `Sem venda em 60 dias · capital parado total R$ ${r.capitalParado.toFixed(2)}`
      ),
      rows: r.localParado.map(({ p, capital }) => ({
        loja: r.shopName.get(p.shop_id) ?? String(p.shop_id),
        produto: [p.item_name ?? p.item_id, p.model_name].filter(Boolean).join(" — "),
        sku: skuOf(p) ?? "",
        curva: r.curveOf(p) ? `Curva ${r.curveOf(p)}` : "",
        preco: priceOf(p) || null,
        estoque: stockOf(p),
        capital: capital || null,
        idle: daysSince(p.last_sale_at),
        custo: r.costOf(p)
      }))
    }
  ]);

  const slug = loja ? nomeLoja.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "todas";
  return xlsxResponse(buffer, `oraculo-estoque-shopee_${slug}_${fileStamp()}.xlsx`);
}
