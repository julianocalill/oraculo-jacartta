// Regras fiscais e de margem do Oráculo, como funções puras.
//
// A fonte de verdade em produção é o SQL (trigger `calculate_oraculo_state_tax_difal`
// e a view `oraculo_sku_margin_30d`). Este módulo replica essas regras em JS para:
//   1. servir de especificação executável e documentada;
//   2. travar as fórmulas contra regressão via testes (`fiscal.test.js`);
//   3. ser um oráculo de referência para validar o SQL.
//
// Ao mudar a regra no SQL, atualize aqui e nos testes.

/** Status fiscais que representam NF autorizada/emitida (venda oficial). */
export const VALID_FISCAL_STATUS = ["6", "7"];

/**
 * DIFAL = diferença positiva entre a alíquota interna do UF de destino e a
 * alíquota interestadual da operação. Nunca negativo.
 * SQL: `difal_rate := max(icms_rate - interstate_icms_rate, 0)`
 */
export function calcDifalRate(internalIcmsRate, interstateIcmsRate) {
  const internal = toRate(internalIcmsRate);
  const interstate = toRate(interstateIcmsRate);
  return Math.max(internal - interstate, 0);
}

/**
 * Carga tributária efetiva por UF.
 * SQL: `effective_tax_rate := interstate_icms_rate + difal_rate + fcp_rate`
 */
export function calcEffectiveTaxRate({ interstateIcmsRate, difalRate, fcpRate }) {
  return toRate(interstateIcmsRate) + toRate(difalRate) + toRate(fcpRate);
}

/**
 * Conveniência: calcula DIFAL e carga efetiva a partir das alíquotas cruas,
 * exatamente como o trigger faz antes de gravar em `oraculo_state_tax_params`.
 */
export function deriveStateTax({ internalIcmsRate, interstateIcmsRate, fcpRate = 0 }) {
  const difalRate = calcDifalRate(internalIcmsRate, interstateIcmsRate);
  const effectiveTaxRate = calcEffectiveTaxRate({ interstateIcmsRate, difalRate, fcpRate });
  return { difalRate, effectiveTaxRate };
}

/**
 * Contrato de NF válida (venda/receita oficial).
 * SQL: `status in ('6','7') AND fiscal_invoice_type <> 'E' AND fiscal_origin_type <> 'devolucao'`
 */
export function isValidFiscalInvoice({ status, invoiceType, originType }) {
  const statusOk = VALID_FISCAL_STATUS.includes(String(status ?? "").trim());
  const notEntry = String(invoiceType ?? "").trim().toUpperCase() !== "E";
  const notReturn = String(originType ?? "").trim().toLowerCase() !== "devolucao";
  return statusOk && notEntry && notReturn;
}

/** NF cancelada é `status = '8'` (contada à parte, não é venda válida). */
export function isCanceledInvoice({ status }) {
  return String(status ?? "").trim() === "8";
}

/**
 * Margem e ROI operacionais 30d, alinhados à view `oraculo_sku_margin_30d`.
 * - productCost  = unitCost * units
 * - feeCost      = revenue * (taxRate + marketplaceFeeRate + paymentFeeRate)
 * - operational  = (freightSubsidyPerUnit + packagingCostPerUnit) * units
 * - marginAmount = revenue - productCost - feeCost - operational
 * - marginRate   = marginAmount / revenue   (null se revenue <= 0)
 * - roi          = marginAmount / productCost (null se productCost <= 0)
 */
export function calcSkuMargin({
  revenue,
  units,
  unitCost,
  taxRate = 0,
  marketplaceFeeRate = 0,
  paymentFeeRate = 0,
  freightSubsidyPerUnit = 0,
  packagingCostPerUnit = 0
}) {
  const rev = toNumber(revenue);
  const qty = toNumber(units);
  const cost = toNumber(unitCost);

  const productCost = cost * qty;
  const feeCost = rev * (toRate(taxRate) + toRate(marketplaceFeeRate) + toRate(paymentFeeRate));
  const operationalCost = (toNumber(freightSubsidyPerUnit) + toNumber(packagingCostPerUnit)) * qty;
  const marginAmount = rev - productCost - feeCost - operationalCost;

  return {
    productCost,
    feeCost,
    operationalCost,
    marginAmount,
    marginRate: rev > 0 ? marginAmount / rev : null,
    roi: productCost > 0 ? marginAmount / productCost : null
  };
}

/**
 * Sinal de margem exibido em /skus.
 * Ordem de precedência espelha a view: sem_venda > configurar_parametros >
 * sem_custo > critico > atencao > saudavel.
 */
export function marginSignal({
  units,
  unitCost,
  paramsConfigured,
  marginRate,
  targetMarginRate,
  minimumMarginRate
}) {
  if (toNumber(units) <= 0) return "sem_venda";
  if (!paramsConfigured) return "configurar_parametros";
  if (unitCost == null || !Number.isFinite(Number(unitCost)) || Number(unitCost) <= 0) return "sem_custo";
  const rate = Number(marginRate);
  if (!Number.isFinite(rate)) return "configurar_parametros";
  if (rate < toRate(minimumMarginRate)) return "critico";
  if (rate < toRate(targetMarginRate)) return "atencao";
  return "saudavel";
}

// ---------------------------------------------------------------------------
// Regras portadas do app Financeiro (shopee-balance-local/index.html).
// Fonte de verdade original em JS; replicadas aqui fielmente, com os mesmos
// valores e precedências, para servir de especificação testável e alimentar a
// camada fiscal SQL do Oráculo. Ver docs/fiscal-financeiro-port.md.
// ---------------------------------------------------------------------------

/** Fator de crédito na transferência de importados: 4% ICMS + 11,75% PIS/COFINS. */
export const IMPORTED_TRANSFER_CREDIT_RATE = 0.1575;

/** Faixas de taxa da Shopee (marketplace fee por faixa de preço de venda). */
export const SHOPEE_MARKETPLACE_TIERS = [
  { max: 79.99, rate: 20, fixed: 4 },
  { max: 99.99, rate: 14, fixed: 16 },
  { max: 199.99, rate: 14, fixed: 20 },
  { max: 499.99, rate: 14, fixed: 26 },
  { max: Infinity, rate: 14, fixed: 28 }
];

/** Alíquota interna de ICMS por UF de destino (para o cálculo de DIFAL). */
export const INTERNAL_ICMS_RATES = {
  AC: 19, AL: 20, AP: 18, AM: 20, BA: 20.5, CE: 20, DF: 20, ES: 17, GO: 19,
  MA: 22, MT: 17, MS: 17, MG: 18, PA: 19, PB: 20, PR: 19.5, PE: 20.5, PI: 21,
  RJ: 22, RN: 20, RS: 17, RO: 19.5, RR: 20, SC: 17, SP: 18, SE: 19, TO: 20
};

/** Sul/Sudeste exceto ES — usado na alíquota interestadual nacional (12% vs 7%). */
export const SOUTH_SOUTHEAST_WITHOUT_ES = new Set(["MG", "PR", "RJ", "RS", "SC", "SP"]);

/**
 * Matrizes de ICMS de saída (venda) por perfil e origem, retornando a alíquota
 * (%) para a UF de destino. Espelha DEFAULT_TAX_MATRICES do Financeiro.
 */
export const TAX_MATRICES = {
  jacarta: {
    nacional: (uf) => (uf === "MG" ? 6 : 1.3),
    importado: (uf) => (uf === "MG" ? 14 : 1.3)
  },
  "gira-casa": {
    nacional: (uf) => (uf === "SP" ? 18 : (["MG", "PR", "RJ", "RS", "SC"].includes(uf) ? 12 : 7)),
    importado: (uf) => (uf === "SP" ? 18 : 4)
  }
};

/** Normaliza origem textual para 'nacional' | 'importado' | ''. */
export function normalizeFiscalOrigin(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text.includes("import")) return "importado";
  if (text.startsWith("nacion") || text === "nac") return "nacional";
  return "";
}

/** Alíquota de ICMS de saída (%) por perfil/origem/UF. Null se não resolvível. */
export function icmsRateForUf({ profile = "jacarta", origin = "nacional", uf } = {}) {
  const matrix = TAX_MATRICES[profile];
  if (!matrix) return null;
  const fn = matrix[origin];
  if (!fn || !uf) return null;
  const rate = fn(String(uf).toUpperCase());
  return Number.isFinite(rate) ? rate : null;
}

/**
 * Alíquota interestadual (%) da operação (para DIFAL).
 * Intraestadual → 0; importado → 4; nacional → 12 se origem e destino ambos em
 * Sul/Sudeste (sem ES), senão 7.
 */
export function interstateIcmsRate(sourceState, destState, origin) {
  const src = String(sourceState ?? "").toUpperCase();
  const dest = String(destState ?? "").toUpperCase();
  if (!dest || dest === src) return 0;
  if (origin === "importado") return 4;
  return SOUTH_SOUTHEAST_WITHOUT_ES.has(src) && SOUTH_SOUTHEAST_WITHOUT_ES.has(dest) ? 12 : 7;
}

/**
 * DIFAL do Financeiro: base × max(0, ICMS interno destino − interestadual).
 * Aceita override por valor ou por alíquota explícita.
 */
export function calcDifal({ base, destState, sourceState = "MG", origin = "nacional", explicitAmount, explicitRate } = {}) {
  const baseValue = toNumber(base);
  const internalRate = INTERNAL_ICMS_RATES[String(destState ?? "").toUpperCase()] ?? null;
  const interstate = interstateIcmsRate(sourceState, destState, origin);
  const calculatedRate = internalRate == null ? 0 : Math.max(0, internalRate - interstate);
  const rate = toNumber(explicitRate) > 0 ? toNumber(explicitRate) : calculatedRate;
  const amount = toNumber(explicitAmount) > 0
    ? toNumber(explicitAmount)
    : (rate > 0 ? baseValue * (rate / 100) : 0);
  return { rate, amount, internalRate, interstateRate: interstate };
}

/**
 * Custo líquido do produto (Financeiro `calculateCost`), na ordem de precedência:
 *  - netCost explícito;
 *  - importado por transferência → gross × (1 − 0,1575);
 *  - gross − créditos recuperáveis explícitos;
 *  - gross puro (fallback).
 * Retorna { total, rule } ou { total: null } quando não há custo bruto.
 */
export function calcNetCost({
  grossTotal,
  netTotal,
  recoverableTaxes,
  isImportedTransfer = false
} = {}) {
  if (netTotal != null && Number.isFinite(Number(netTotal))) {
    return { total: Math.max(0, toNumber(netTotal)), rule: "explicit_net_cost" };
  }
  if (grossTotal == null || !Number.isFinite(Number(grossTotal))) {
    return { total: null, rule: "missing_cost" };
  }
  const base = toNumber(grossTotal);
  if (isImportedTransfer) {
    const recoverable = base * IMPORTED_TRANSFER_CREDIT_RATE;
    return { total: Math.max(0, base - recoverable), rule: "imported_transfer_4_icms_1175_pis_cofins" };
  }
  if (recoverableTaxes != null && toNumber(recoverableTaxes) > 0) {
    return { total: Math.max(0, base - toNumber(recoverableTaxes)), rule: "gross_minus_recoverable_taxes" };
  }
  return { total: base, rule: "gross_cost" };
}

/** Taxa da Shopee por faixa de preço de venda. */
export function calcShopeeMarketplaceFee(salePrice) {
  const price = toNumber(salePrice);
  const tier = SHOPEE_MARKETPLACE_TIERS.find((t) => price <= t.max) ?? SHOPEE_MARKETPLACE_TIERS.at(-1);
  const variable = price * (tier.rate / 100);
  return { total: variable + tier.fixed, rate: tier.rate, fixed: tier.fixed };
}

/**
 * PIS/COFINS líquido (Lucro Real, não-cumulativo): débito sobre a base fiscal
 * menos crédito sobre o custo líquido. Nunca negativo.
 */
export function calcPisCofins({ base, netCost, rate = 9.25, creditEnabled = true } = {}) {
  const output = toNumber(base) * (toRate(rate) / 100);
  const credit = creditEnabled ? toNumber(netCost) * (toRate(rate) / 100) : 0;
  return Math.max(0, output - credit);
}

/** Base fiscal: valor da NF de saída se > 0, senão o valor bruto da venda. */
export function fiscalBase({ invoiceValue, gross } = {}) {
  return toNumber(invoiceValue) > 0 ? toNumber(invoiceValue) : toNumber(gross);
}

/**
 * Cálculo fiscal completo por pedido/NF, portando `calculateTaxes` + `calculateProfit`
 * do Financeiro. Retorna todos os componentes + lucro/margem/ROI, ou pendências.
 */
export function calcFiscalOrder({
  gross,
  invoiceValue,
  quantity = 1,
  netCost,
  grossCost,
  recoverableTaxes,
  isImportedTransfer = false,
  profile = "jacarta",
  origin = "nacional",
  destState,
  sourceState = "MG",
  pisCofinsRate = 9.25,
  pisCofinsCreditEnabled = true,
  marketplaceFee,
  expenses = 0,
  difalOverrideAmount,
  difalOverrideRate
} = {}) {
  const grossValue = toNumber(gross);
  const base = fiscalBase({ invoiceValue, gross: grossValue });
  const cost = calcNetCost({
    grossTotal: grossCost,
    netTotal: netCost,
    recoverableTaxes,
    isImportedTransfer
  });

  const icmsRate = icmsRateForUf({ profile, origin, uf: destState });
  const fiscalPending = icmsRate == null;

  const icms = fiscalPending ? 0 : base * (icmsRate / 100);
  const pisCofins = calcPisCofins({ base, netCost: cost.total ?? 0, rate: pisCofinsRate, creditEnabled: pisCofinsCreditEnabled });
  const difal = calcDifal({ base, destState, sourceState, origin, explicitAmount: difalOverrideAmount, explicitRate: difalOverrideRate });
  const taxesTotal = icms + pisCofins + difal.amount;

  const feeTotal = marketplaceFee != null ? toNumber(marketplaceFee) : 0;
  const expensesTotal = toNumber(expenses);

  const costMissing = cost.total == null;
  const pending = costMissing || fiscalPending;
  const profit = pending ? null : grossValue - feeTotal - (cost.total ?? 0) - taxesTotal - expensesTotal;

  return {
    base,
    cost: cost.total,
    costRule: cost.rule,
    icmsRate,
    icms,
    pisCofins,
    difal,
    taxesTotal,
    feeTotal,
    expensesTotal,
    fiscalPending,
    costMissing,
    profit,
    margin: pending || grossValue <= 0 ? null : profit / grossValue,
    roi: pending || (cost.total ?? 0) <= 0 ? null : profit / cost.total
  };
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toRate(value) {
  return toNumber(value);
}
