// Export .xlsx da aba Visão geral do Mercado Livre. Cada relatório da tela
// vira uma aba: Ruptura · Ruptura variações · Cobertura Full · Estoque parado.
import { getCurrentUser } from "../../../lib/auth/session";
import { buildXlsxWorkbook, fileStamp, xlsxResponse, type XlsxColumn } from "../../../lib/xlsx";
import {
  buildCostIndex,
  computeCurves,
  computeTrends,
  costOfItemFactory,
  dailyVelocity,
  daysSince,
  isFull,
  loadMlData,
  n,
  stockOf,
  trendText,
  variationVelocity
} from "../data";

export const dynamic = "force-dynamic";

const RUPTURA: XlsxColumn[] = [
  { header: "Anúncio", key: "titulo", width: 52 },
  { header: "MLB", key: "mlb", width: 15 },
  { header: "SKU", key: "sku", width: 16 },
  { header: "Origem", key: "origem", width: 9 },
  { header: "Curva", key: "curva", width: 7 },
  { header: "Vendas 30d", key: "v30", width: 11, type: "number" },
  { header: "Vendas 60d", key: "v60", width: 11, type: "number" },
  { header: "Tendência 120→0", key: "tendencia", width: 18 },
  { header: "Média/dia", key: "media", width: 10, type: "decimal" },
  { header: "Trânsito", key: "transito", width: 10, type: "number" },
  { header: "Preço", key: "preco", width: 12, type: "money" },
  { header: "Perda/dia", key: "perda", width: 12, type: "money" },
  { header: "Última venda (dias)", key: "idle", width: 17, type: "number" },
  { header: "Custo unit.", key: "custo", width: 12, type: "money" },
  { header: "Margem unit.", key: "margem", width: 12, type: "money" }
];

const RUPTURA_VAR: XlsxColumn[] = [
  { header: "Anúncio", key: "titulo", width: 52 },
  { header: "MLB", key: "mlb", width: 15 },
  { header: "Variação", key: "variacao", width: 26 },
  { header: "SKU", key: "sku", width: 16 },
  { header: "Curva", key: "curva", width: 7 },
  { header: "Vendas 30d", key: "v30", width: 11, type: "number" },
  { header: "Vendas 60d", key: "v60", width: 11, type: "number" },
  { header: "Média/dia", key: "media", width: 10, type: "decimal" },
  { header: "Preço", key: "preco", width: 12, type: "money" },
  { header: "Perda/dia", key: "perda", width: 12, type: "money" }
];

const COBERTURA: XlsxColumn[] = [
  { header: "Anúncio", key: "titulo", width: 52 },
  { header: "MLB", key: "mlb", width: 15 },
  { header: "SKU", key: "sku", width: 16 },
  { header: "Curva", key: "curva", width: 7 },
  { header: "Estoque Full", key: "full", width: 12, type: "number" },
  { header: "Trânsito", key: "transito", width: 10, type: "number" },
  { header: "Tendência 120→0", key: "tendencia", width: 18 },
  { header: "Média/dia", key: "media", width: 10, type: "decimal" },
  { header: "Cobertura (dias)", key: "cobertura", width: 15, type: "number" },
  { header: "Status", key: "status", width: 10 },
  { header: "Preço", key: "preco", width: 12, type: "money" },
  { header: "Custo unit.", key: "custo", width: 12, type: "money" },
  { header: "Margem unit.", key: "margem", width: 12, type: "money" }
];

const PARADO: XlsxColumn[] = [
  { header: "Anúncio", key: "titulo", width: 52 },
  { header: "MLB", key: "mlb", width: 15 },
  { header: "SKU", key: "sku", width: 16 },
  { header: "Origem", key: "origem", width: 9 },
  { header: "Curva", key: "curva", width: 7 },
  { header: "Status ML", key: "statusMl", width: 10 },
  { header: "Preço", key: "preco", width: 12, type: "money" },
  { header: "Estoque", key: "estoque", width: 10, type: "number" },
  { header: "Capital parado", key: "capital", width: 15, type: "money" },
  { header: "Última venda (dias)", key: "idle", width: 17, type: "number" },
  { header: "Ação sugerida", key: "acao", width: 20 }
];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Não autorizado", { status: 401 });

  const data = await loadMlData();
  if (!data) return new Response("Sem dados sincronizados", { status: 404 });

  const { items, sales, variations, transit, costs } = data;
  const curves = computeCurves(items);
  const trends = computeTrends(sales);
  const transitByMlb = new Map(transit.map((row) => [row.mlb_id, row.qty]));
  const itemByMlb = new Map(items.map((item) => [item.mlb_id, item]));
  const costBySku = buildCostIndex(costs);
  const costOfItem = costOfItemFactory(costBySku, variations);

  const curvaTxt = (mlb: string) => (curves.get(mlb) ? `Curva ${curves.get(mlb)}` : "");
  const margem = (preco: number, custo: number | undefined | null) =>
    custo && custo > 0 && preco > 0 ? preco - custo : null;

  // Mesmos filtros da tela (app/mercado-livre/page.tsx)
  const ruptura = items
    .filter((item) => stockOf(item) <= 0 && item.sold_qty_60d > 0)
    .map((item) => ({ item, velocity: dailyVelocity(item) }))
    .map((r) => ({ ...r, lossPerDay: r.velocity * n(r.item.price) }))
    .sort((a, b) => b.lossPerDay - a.lossPerDay);

  const rupturaVar = variations
    .filter((v) => {
      const parent = itemByMlb.get(v.mlb_id);
      if (!parent || parent.status === "closed") return false;
      const stock = parent.logistic_type === "fulfillment" ? v.full_stock : v.available_qty;
      return stock <= 0 && v.sold_qty_60d > 0 && stockOf(parent) > 0;
    })
    .map((v) => {
      const parent = itemByMlb.get(v.mlb_id)!;
      const velocity = variationVelocity(v);
      const price = n(v.price ?? parent.price);
      return { v, parent, velocity, price, lossPerDay: velocity * price };
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
      return {
        item,
        idle,
        acao: idle === null || idle > 120 ? "Avaliar retirada" : curve === "A" ? "Investigar (Curva A)" : "Ativar promoção",
        capital: stockOf(item) * n(item.price)
      };
    })
    .sort((a, b) => b.capital - a.capital);

  const lossTotal = ruptura.reduce((s, r) => s + r.lossPerDay, 0) + rupturaVar.reduce((s, r) => s + r.lossPerDay, 0);
  const capitalTotal = parado.reduce((s, p) => s + p.capital, 0);
  const geradoEm = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const head = (titulo: string, extra: string) => [`Oráculo · ${titulo} · Mercado Livre · gerado em ${geradoEm}`, extra];

  const buffer = await buildXlsxWorkbook([
    {
      sheetName: "Ruptura",
      columns: RUPTURA,
      meta: head(
        "Ruptura de estoque",
        `Anúncios Full e locais zerados com venda nos últimos 60 dias · perda/dia total R$ ${lossTotal.toFixed(2)}`
      ),
      rows: ruptura.map(({ item, velocity, lossPerDay }) => {
        const custo = costOfItem(item);
        return {
          titulo: item.title ?? item.mlb_id,
          mlb: item.mlb_id,
          sku: item.sku ?? "",
          origem: isFull(item) ? "Full" : "Local",
          curva: curvaTxt(item.mlb_id),
          v30: item.sold_qty_30d,
          v60: item.sold_qty_60d,
          tendencia: trendText(trends.get(item.mlb_id)),
          media: Number(velocity.toFixed(1)),
          transito: transitByMlb.get(item.mlb_id) ?? 0,
          preco: n(item.price) || null,
          perda: lossPerDay || null,
          idle: daysSince(item.last_sale_at),
          custo: custo ?? null,
          margem: margem(n(item.price), custo)
        };
      })
    },
    {
      sheetName: "Ruptura variações",
      columns: RUPTURA_VAR,
      meta: head("Ruptura por variação", "Variação (cor/tamanho) zerada dentro de anúncio com estoque"),
      rows: rupturaVar.map(({ v, parent, velocity, price, lossPerDay }) => ({
        titulo: parent.title ?? v.mlb_id,
        mlb: v.mlb_id,
        variacao: v.attrs ?? v.variation_id,
        sku: v.sku ?? "",
        curva: curvaTxt(v.mlb_id),
        v30: v.sold_qty_30d,
        v60: v.sold_qty_60d,
        media: Number(velocity.toFixed(1)),
        preco: price || null,
        perda: lossPerDay || null
      }))
    },
    {
      sheetName: "Cobertura Full",
      columns: COBERTURA,
      meta: head("Cobertura de estoque Full", "Dias que o estoque dura no ritmo atual (estoque + trânsito ÷ média/dia)"),
      rows: cobertura.map(({ item, velocity, transitQty, coverageDays }) => {
        const custo = costOfItem(item);
        return {
          titulo: item.title ?? item.mlb_id,
          mlb: item.mlb_id,
          sku: item.sku ?? "",
          curva: curvaTxt(item.mlb_id),
          full: item.full_stock,
          transito: transitQty,
          tendencia: trendText(trends.get(item.mlb_id)),
          media: Number(velocity.toFixed(1)),
          cobertura: Math.floor(coverageDays),
          status: coverageDays < 7 ? "Crítico" : coverageDays < 15 ? "Atenção" : "OK",
          preco: n(item.price) || null,
          custo: custo ?? null,
          margem: margem(n(item.price), custo)
        };
      })
    },
    {
      sheetName: "Estoque parado",
      columns: PARADO,
      meta: head("Estoque parado", `Capital imobilizado total R$ ${capitalTotal.toFixed(2)}`),
      rows: parado.map(({ item, idle, acao, capital }) => ({
        titulo: item.title ?? item.mlb_id,
        mlb: item.mlb_id,
        sku: item.sku ?? "",
        origem: isFull(item) ? "Full" : "Local",
        curva: curvaTxt(item.mlb_id),
        statusMl: item.status ?? "",
        preco: n(item.price) || null,
        estoque: stockOf(item),
        capital: capital || null,
        idle,
        acao
      }))
    }
  ]);

  return xlsxResponse(buffer, `oraculo-estoque-mercado-livre_${fileStamp()}.xlsx`);
}
