// Relatórios de estoque Shopee (FBS + local), compartilhados pela aba e pelo
// export .xlsx — a planilha precisa ser exatamente o que está na tela.
import {
  type Curve,
  type SbsRow,
  type ShopeeData,
  type ShopeeProduct,
  buildCostIndex,
  computeCurves,
  computeTrends,
  n,
  priceOf,
  productKey,
  skuOf,
  stockOf,
  velocityOf
} from "../data";

export type EstoqueParams = { loja: number | null };

export function buildEstoqueReports(data: ShopeeData, { loja: lojaFiltro }: EstoqueParams) {
  const { shops, products: allProducts, sbs: allSbs, sales, costs } = data;
  const shopName = new Map(shops.map((s) => [s.shop_id, s.shop_name ?? String(s.shop_id)]));
  const products = lojaFiltro ? allProducts.filter((p) => p.shop_id === lojaFiltro) : allProducts;
  const sbs = lojaFiltro ? allSbs.filter((r) => r.shop_id === lojaFiltro) : allSbs;
  const curves = computeCurves(allProducts);
  const trends = computeTrends(sales);
  const costBySku = buildCostIndex(costs);

  // preço dos SKUs FBS via produtos (shop_item_id/shop_model_id → catálogo)
  const priceByKey = new Map<string, number>();
  for (const product of allProducts) {
    priceByKey.set(productKey(product.shop_id, product.item_id, product.model_id), priceOf(product));
  }
  const sbsPrice = (row: SbsRow) =>
    priceByKey.get(productKey(row.shop_id, row.shop_item_id ?? row.item_id, row.shop_model_id ?? row.model_id)) ??
    priceByKey.get(productKey(row.shop_id, row.shop_item_id ?? row.item_id, "0")) ??
    0;

  // ---- FBS: ruptura (vendável zero com giro), cobertura e parado ----
  const fbsRuptura = sbs
    .filter((row) => row.sellable_qty <= 0 && (row.selling_speed > 0 || row.last_30_sold > 0))
    .map((row) => ({ row, preco: sbsPrice(row), lossPerDay: row.selling_speed * sbsPrice(row) }))
    .sort((a, b) => b.lossPerDay - a.lossPerDay);

  const fbsCobertura = sbs
    .filter((row) => row.sellable_qty > 0 && row.selling_speed > 0)
    .map((row) => ({ row, preco: sbsPrice(row) }))
    .sort((a, b) => n(a.row.coverage_days) - n(b.row.coverage_days));

  const fbsParado = sbs
    .filter((row) => row.sellable_qty > 0 && row.not_moving_tag === 1)
    .map((row) => ({ row, preco: sbsPrice(row), capital: row.sellable_qty * sbsPrice(row) }))
    .sort((a, b) => b.capital - a.capital);

  // ---- Local: ruptura e parado ----
  const localRuptura = products
    .filter((p) => stockOf(p) <= 0 && p.sold_qty_60d > 0)
    .map((p) => {
      const velocity = velocityOf(p);
      return { p, velocity, lossPerDay: velocity * priceOf(p) };
    })
    .sort((a, b) => b.lossPerDay - a.lossPerDay);

  const localParado = products
    .filter((p) => stockOf(p) > 0 && p.sold_qty_60d <= 0)
    .map((p) => ({ p, capital: stockOf(p) * priceOf(p) }))
    .sort((a, b) => b.capital - a.capital);

  const curveOf = (p: ShopeeProduct): Curve => curves.get(productKey(p.shop_id, p.item_id, p.model_id)) ?? null;
  const trendOf = (p: ShopeeProduct) => trends.get(productKey(p.shop_id, p.item_id, p.model_id));
  const costOf = (p: ShopeeProduct) => {
    const sku = skuOf(p);
    return sku ? costBySku.get(sku) ?? null : null;
  };

  return {
    shopName,
    curves,
    trends,
    costBySku,
    curveOf,
    trendOf,
    costOf,
    fbsRuptura,
    fbsCobertura,
    fbsParado,
    localRuptura,
    localParado,
    fbsLoss: fbsRuptura.reduce((sum, r) => sum + r.lossPerDay, 0),
    localLoss: localRuptura.reduce((sum, r) => sum + r.lossPerDay, 0),
    capitalParado: localParado.reduce((sum, r) => sum + r.capital, 0),
    fbsCriticos: fbsCobertura.filter((c) => n(c.row.coverage_days) < 7).length
  };
}
