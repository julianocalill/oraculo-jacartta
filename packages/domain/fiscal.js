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

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toRate(value) {
  return toNumber(value);
}
