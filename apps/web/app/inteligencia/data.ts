import {
  fetchAllPages,
  productKey,
  trendLabel
} from "../shopee/data";
import { loadPrecoProduto, type PrecoRow } from "../shopee/precos/data";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

export type MarketAction = "repor" | "reprecificar" | "acelerar" | "liquidar" | "investigar";

export type IntelligenceProduct = {
  id: string;
  sku: string;
  name: string;
  variation: string | null;
  shop: string;
  price: number;
  registeredUnitCost: number | null;
  registeredTotalCost: number | null;
  unitsPerSale: number;
  unitCost: number;
  totalCost: number;
  profitUnit: number;
  marginPct: number;
  sold30: number;
  revenue30: number;
  stock: number;
  coverageDays: number | null;
  trend: [number, number, number, number];
  trendText: string;
  action: MarketAction;
  actionLabel: string;
  reason: string;
  priority: number;
  opportunityValue: number;
};

export type IntelligencePayload = {
  products: IntelligenceProduct[];
  internalSource: "real" | "demo";
  generatedAt: string;
};

function actionFor(product: Omit<IntelligenceProduct, "action" | "actionLabel" | "reason" | "priority" | "opportunityValue">) {
  const growth = product.trend[2] > 0 ? (product.trend[3] - product.trend[2]) / product.trend[2] : 0;

  if (product.profitUnit < 0) {
    return {
      action: "reprecificar" as const,
      actionLabel: "Reprecificar",
      reason: `Cada venda perde ${brl(Math.abs(product.profitUnit))} ao preço atual.`,
      priority: 100,
      opportunityValue: Math.abs(product.profitUnit) * Math.max(product.sold30, 1)
    };
  }
  if (product.coverageDays !== null && product.coverageDays < 12 && product.sold30 >= 8) {
    return {
      action: "repor" as const,
      actionLabel: "Repor",
      reason: `Só ${Math.round(product.coverageDays)} dias de cobertura para ${product.sold30} unidades/mês.`,
      priority: 90,
      opportunityValue: product.profitUnit * product.sold30
    };
  }
  if (product.sold30 === 0 && product.stock >= 20) {
    return {
      action: "liquidar" as const,
      actionLabel: "Liquidar",
      reason: `${product.stock} unidades em estoque e nenhuma venda nos últimos 30 dias.`,
      priority: 80,
      opportunityValue: product.unitCost * product.stock
    };
  }
  if (product.marginPct < 12) {
    return {
      action: "investigar" as const,
      actionLabel: "Rever margem",
      reason: `Margem estimada de ${pct(product.marginPct)}, abaixo da faixa saudável.`,
      priority: 70,
      opportunityValue: product.profitUnit * product.sold30
    };
  }
  if ((growth > 0.15 || product.sold30 >= 20) && product.marginPct >= 18) {
    return {
      action: "acelerar" as const,
      actionLabel: "Acelerar",
      reason: `${product.trendText}; margem de ${pct(product.marginPct)} e ${product.sold30} vendas em 30 dias.`,
      priority: 60 + Math.min(20, Math.round(growth * 20)),
      opportunityValue: product.profitUnit * product.sold30
    };
  }
  return {
    action: "investigar" as const,
    actionLabel: "Investigar",
    reason: `Desempenho estável; valide anúncio, preço e posicionamento antes de agir.`,
    priority: 40,
    opportunityValue: product.profitUnit * product.sold30
  };
}

function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function pct(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function rowKey(row: PrecoRow) {
  return productKey(row.shop_id, row.item_id, row.model_id);
}

type IntelligenceProductRow = {
  shop_id: number;
  item_id: string;
  model_id: string | null;
  sold_qty_30d: number | null;
  sold_qty_60d: number | null;
  revenue_30d: number | null;
  model_stock: number | null;
  stock_total: number | null;
};

type CanonicalCostRow = {
  sku: string;
  unit_cost: number | null;
  cost_source: string | null;
};

type RegisteredCostRow = {
  sku: string | null;
  preco_custo: number | null;
};

async function loadLeanShopeeProducts() {
  const admin = createSupabaseAdminClient();
  return fetchAllPages<IntelligenceProductRow>((from, to) =>
    admin
      .from("shopee_products")
      .select("shop_id,item_id,model_id,sold_qty_30d,sold_qty_60d,revenue_30d,model_stock,stock_total")
      .order("id")
      .range(from, to)
  );
}

async function loadCanonicalCosts() {
  const admin = createSupabaseAdminClient();
  return fetchAllPages<CanonicalCostRow>((from, to) =>
    admin
      .from("oraculo_sku_unit_cost")
      .select("sku,unit_cost,cost_source")
      .order("sku")
      .range(from, to)
  );
}

async function loadRegisteredCosts() {
  const admin = createSupabaseAdminClient();
  return fetchAllPages<RegisteredCostRow>((from, to) =>
    admin
      .from("olist_products")
      .select("sku,preco_custo")
      .not("sku", "is", null)
      .order("sku")
      .range(from, to)
  );
}

// O custo já vem líquido do livro canônico (override > ERP > kit). Por isso o
// PIS/COFINS abaixo é o débito cheio sobre a venda: o crédito da entrada já foi
// reconhecido uma única vez ao transformar o bruto em líquido.
function shopeeProfit(price: number, netCostTotal: number) {
  const commission = price * (price <= 79.99 ? 0.20 : 0.14);
  const fixedFee = price <= 79.99 ? 4 : price <= 99.99 ? 16 : price <= 199.99 ? 20 : price <= 499.99 ? 26 : 28;
  return Number((
    price
    - netCostTotal
    - (commission + fixedFee)
    - price * 0.013
    - price * 0.06
    - price * 0.0925
    - price * 0.03
    - price * 0.03
    - 1
  ).toFixed(2));
}

function demoProducts(): IntelligenceProduct[] {
  const seeds = [
    ["CABIDE-50-PRETO", "Kit 50 Cabides de Veludo Preto", "Jacartta", 89.9, 44.2, 19.8, 118, 36, [18, 24, 31, 45]],
    ["POTE-370-10", "Kit 10 Potes de Vidro 370 ml", "Oliverhome", 74.9, 39.6, 16.1, 82, 14, [24, 23, 20, 15]],
    ["ORGANIZADOR-4", "Kit 4 Organizadores Transparentes", "DonaCor", 49.9, 27.4, -2.8, 31, 74, [9, 10, 8, 7]],
    ["PET-TAPETE-M", "Tapete Higiênico Lavável M", "Espaço de Bicho", 59.9, 31.8, 13.6, 44, 8, [8, 9, 12, 15]],
    ["POTE-500-6", "Kit 6 Potes Herméticos 500 ml", "Oliverhome", 64.9, 34.1, 14.2, 0, 96, [0, 0, 0, 0]],
    ["CABIDE-INF-30", "Kit 30 Cabides Infantis", "Jacartta", 54.9, 29.7, 8.1, 17, 52, [5, 4, 4, 4]]
  ] as const;

  return seeds.map((seed, index) => {
    const [sku, name, shop, price, cost, profit, sold, stock, trend] = seed;
    const coverage = sold > 0 ? stock / (sold / 30) : null;
    const base = {
      id: `demo-${index}`,
      sku,
      name,
      variation: null,
      shop,
      price,
      registeredUnitCost: cost,
      registeredTotalCost: cost,
      unitsPerSale: 1,
      unitCost: cost,
      totalCost: cost,
      profitUnit: profit,
      marginPct: price > 0 ? (profit / price) * 100 : 0,
      sold30: sold,
      revenue30: sold * price,
      stock,
      coverageDays: coverage,
      trend: [...trend] as [number, number, number, number],
      trendText: trend[2] > 0 && trend[3] > trend[2] ? `crescendo ${pct(((trend[3] - trend[2]) / trend[2]) * 100)}` : sold === 0 ? "sem venda recente" : "estável"
    };
    return { ...base, ...actionFor(base) };
  });
}

export async function loadIntelligencePayload(): Promise<IntelligencePayload> {
  try {
    const [priceRows, shopeeProducts, canonicalCosts, registeredCosts] = await Promise.all([
      loadPrecoProduto(),
      loadLeanShopeeProducts(),
      loadCanonicalCosts(),
      loadRegisteredCosts()
    ]);
    if (shopeeProducts.length === 0 || priceRows.length === 0) throw new Error("Dados internos indisponíveis");

    const productIndex = new Map(shopeeProducts.map((product) => [productKey(product.shop_id, product.item_id, product.model_id), product]));
    const costIndex = new Map(canonicalCosts.map((cost) => [cost.sku.trim().toUpperCase(), cost]));
    const registeredCostIndex = new Map<string, number>();
    for (const cost of registeredCosts) {
      const sku = cost.sku?.trim().toUpperCase();
      const value = Number(cost.preco_custo ?? 0);
      if (!sku || value <= 0) continue;
      registeredCostIndex.set(sku, Math.max(value, registeredCostIndex.get(sku) ?? 0));
    }
    const products: IntelligenceProduct[] = [];

    for (const row of priceRows) {
      if (row.price === null || row.price <= 0) continue;
      const internal = productIndex.get(rowKey(row));
      const normalizedSku = row.sku_olist?.trim().toUpperCase();
      const canonicalCost = normalizedSku ? costIndex.get(normalizedSku) : null;
      const registeredUnitCost = normalizedSku ? registeredCostIndex.get(normalizedSku) ?? null : null;
      const netUnitCost = canonicalCost?.unit_cost ?? row.unit_cost;
      if (netUnitCost === null || netUnitCost <= 0) continue;
      const sold30 = Number(internal?.sold_qty_30d ?? 0);
      const soldPrevious30 = Math.max(0, Number(internal?.sold_qty_60d ?? 0) - sold30);
      const stock = Number(internal?.model_stock ?? internal?.stock_total ?? 0);
      const trend = [0, 0, soldPrevious30, sold30] as [number, number, number, number];
      const coverageDays = sold30 > 0 ? stock / (sold30 / 30) : null;
      const unitsPerSale = row.qtd ?? 1;
      const totalCost = netUnitCost * unitsPerSale;
      const registeredTotalCost = registeredUnitCost === null ? null : registeredUnitCost * unitsPerSale;
      const profitUnit = shopeeProfit(row.price, totalCost);
      const base = {
        id: rowKey(row),
        sku: row.sku_olist ?? row.channel_sku ?? row.item_id,
        name: row.item_name ?? row.olist_product_name ?? `Produto ${row.item_id}`,
        variation: row.model_name,
        shop: row.shop_name ?? String(row.shop_id),
        price: row.price,
        registeredUnitCost,
        registeredTotalCost,
        unitsPerSale,
        unitCost: netUnitCost,
        totalCost,
        profitUnit,
        marginPct: (profitUnit / row.price) * 100,
        sold30,
        revenue30: internal?.revenue_30d ?? sold30 * row.price,
        stock,
        coverageDays,
        trend,
        trendText: trendLabel(trend)
      };
      products.push({ ...base, ...actionFor(base) });
    }

    const allUnique = [...new Map(products.map((product) => [product.id, product])).values()];
    const take = (action: MarketAction, limit: number) => allUnique
      .filter((product) => product.action === action)
      .sort((a, b) => b.priority - a.priority || b.opportunityValue - a.opportunityValue)
      .slice(0, limit);
    const unique = [
      ...take("reprecificar", 24),
      ...take("repor", 18),
      ...take("acelerar", 18),
      ...take("liquidar", 10),
      ...take("investigar", 10)
    ].sort((a, b) => b.priority - a.priority || b.opportunityValue - a.opportunityValue);
    if (unique.length === 0) throw new Error("Nenhum produto elegível");

    return { products: unique, internalSource: "real", generatedAt: new Date().toISOString() };
  } catch {
    return { products: demoProducts(), internalSource: "demo", generatedAt: new Date().toISOString() };
  }
}
