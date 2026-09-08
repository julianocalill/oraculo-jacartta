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
  const productByKey = new Map<string, ShopeeProduct>();
  for (const product of allProducts) {
    const key = productKey(product.shop_id, product.item_id, product.model_id);
    priceByKey.set(key, priceOf(product));
    productByKey.set(key, product);
  }
  const sbsKey = (row: SbsRow) =>
    productKey(row.shop_id, row.shop_item_id ?? row.item_id, row.shop_model_id ?? row.model_id);
  const sbsPrice = (row: SbsRow) =>
    priceByKey.get(sbsKey(row)) ??
    priceByKey.get(productKey(row.shop_id, row.shop_item_id ?? row.item_id, "0")) ??
    0;

  // Posição completa do FBS. As tabelas abaixo são diagnósticos e filtram por
  // giro/situação; esta lista preserva todos os registros devolvidos pela Shopee.
  const fbsPosition = sbs
    .map((row) => {
      const product = productByKey.get(sbsKey(row));
      return {
        row,
        sku: product ? skuOf(product) : null,
        totalAvailable: product ? stockOf(product) : null
      };
    })
    .sort((a, b) => b.row.sellable_qty - a.row.sellable_qty);

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

  // ---- Vendável total do anúncio: ruptura e parado ----
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
    fbsPosition,
    fbsRuptura,
    fbsCobertura,
    fbsParado,
    localRuptura,
    localParado,
    fbsLoss: fbsRuptura.reduce((sum, r) => sum + r.lossPerDay, 0),
    localLoss: localRuptura.reduce((sum, r) => sum + r.lossPerDay, 0),
    capitalParado: localParado.reduce((sum, r) => sum + r.capital, 0),
    fbsSellableTotal: sbs.reduce((sum, row) => sum + row.sellable_qty, 0),
    fbsReservedTotal: sbs.reduce((sum, row) => sum + row.reserved_qty, 0),
    fbsCriticos: fbsCobertura.filter((c) => n(c.row.coverage_days) < 7).length
  };
}
