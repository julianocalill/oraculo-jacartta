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

/**
 * Créditos recuperáveis descontados do custo de aquisição (regra de 14/08/2026):
 *   nacional  → 9,25%  (PIS/COFINS não cumulativo sobre a entrada)
 *   importado → 11,75% (PIS/COFINS-Importação: 2,1% + 9,65%)
 * Espelha a função SQL `oraculo_net_cost_rate`, usada pelas três views que
 * resolvem custo. Ver docs/adr/ADR-005-custo-liquido-creditos.md.
 */
export const NET_COST_CREDIT_RATES = { nacional: 0.0925, importado: 0.1175 };

/**
 * Fator de crédito na transferência de importados no app Financeiro:
 * 4% ICMS + 11,75% PIS/COFINS. **Especificação histórica** — o motor usa só os
 * 11,75% (`NET_COST_CREDIT_RATES.importado`), porque a base não tem a flag que
 * identifica entrada por transferência.
 */
export const IMPORTED_TRANSFER_CREDIT_RATE = 0.1575;

/** Alíquota de crédito recuperável por origem. Espelha `oraculo_net_cost_rate`. */
export function netCostCreditRate(origin) {
  return String(origin ?? "").trim().toLowerCase().startsWith("import")
    ? NET_COST_CREDIT_RATES.importado
    : NET_COST_CREDIT_RATES.nacional;
}

/**
 * Custo líquido de créditos recuperáveis — o custo que o motor usa em toda a
 * plataforma. Espelha a função SQL `oraculo_net_cost`: null entra, null sai, e
 * o resultado nunca é negativo.
 *
 * Em kit, a regra vale por componente: cada um desconta o crédito da SUA origem,
 * porque um kit pode misturar nacional e importado.
 */
export function calcNetCostByOrigin(grossCost, origin) {
  if (grossCost == null || !Number.isFinite(Number(grossCost))) return null;
  return Math.max(0, toNumber(grossCost) * (1 - netCostCreditRate(origin)));
}

/** Faixas de taxa da Shopee (marketplace fee por faixa de preço de venda). */
export const SHOPEE_MARKETPLACE_TIERS = [
  { max: 79.99, rate: 20, fixed: 4 },
  { max: 99.99, rate: 14, fixed: 16 },
  { max: 199.99, rate: 14, fixed: 20 },
  { max: 499.99, rate: 14, fixed: 26 },
  { max: Infinity, rate: 14, fixed: 28 }
];

/**
 * Faixas de comissão por marketplace usadas na **margem fiscal** (tabela
 * `oraculo_marketplace_fee_params`). Decisão de negócio de 04/08/2026: frete,
 * ads, embalagem e despesa operacional são tratados como já embutidos no
 * desconto do marketplace, em vez de virarem linhas próprias.
 * `null` em `max` = faixa aberta (último degrau).
 */
export const MARKETPLACE_FEE_TIERS = {
  shopee: SHOPEE_MARKETPLACE_TIERS,
  mercado_livre: [
    { max: 28.99, rate: 13, fixed: 6.25 },
    { max: 49.99, rate: 13, fixed: 6.5 },
    { max: 78.99, rate: 13, fixed: 6.75 },
    { max: Infinity, rate: 13, fixed: 0 }
  ],
  tiktok: [
    { max: 78.99, rate: 6, fixed: 4 },
    { max: Infinity, rate: 6, fixed: 0 }
  ],
  // Comissão única, sem degrau de preço (fontes em 04/08/2026 — ver
  // docs/fiscal-financeiro-port.md e as notas de oraculo_marketplace_fee_params).
  amazon: [{ max: Infinity, rate: 15, fixed: 0 }],
  shein: [{ max: Infinity, rate: 18, fixed: 0 }],
  kwai: [{ max: Infinity, rate: 20, fixed: 4 }]
};

/**
 * Casa o rótulo de canal da NF (`olist_invoices.fiscal_channel_label`) com a
 * chave de marketplace. Espelha o `ilike match_pattern` do SQL, na mesma ordem
 * de prioridade. Retorna null quando não há faixa cadastrada (venda sem canal
 * identificado, canal novo) — aí a comissão é 0 e a linha fica `feeMissing`.
 */
export function marketplaceKeyForChannel(channelLabel) {
  const label = String(channelLabel ?? "").trim().toLowerCase();
  if (label.startsWith("shopee")) return "shopee";
  if (label.startsWith("mercado livre")) return "mercado_livre";
  if (label.startsWith("tiktok")) return "tiktok";
  if (label.startsWith("amazon")) return "amazon";
  if (label.startsWith("shein")) return "shein";
  if (label.startsWith("kwai")) return "kwai";
  return null;
}

/**
 * Comissão do marketplace de uma linha de item, como o SQL calcula:
 *   faixa    = primeira cujo `max` cobre o PREÇO UNITÁRIO (max null/Infinity = aberta)
 *   comissão = receita × rate/100 + fixed × quantidade
 *
 * A faixa é escolhida pelo preço unitário — e não pelo total da linha — porque
 * os degraus (R$ 28,99 / 49,99 / 78,99 no ML) são limites por unidade, e o fixo
 * é cobrado por unidade vendida.
 */
export function calcMarketplaceFeeForLine({ tiers, revenue, quantity = 1 } = {}) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { total: 0, rate: 0, fixed: 0, feeMissing: true };
  }
  const rev = toNumber(revenue);
  const qty = toNumber(quantity);
  const unitPrice = qty > 0 ? rev / qty : rev;
  const tier =
    tiers.find((t) => t.max == null || !Number.isFinite(t.max) || unitPrice <= t.max) ?? tiers.at(-1);
  return {
    total: rev * (toRate(tier.rate) / 100) + toNumber(tier.fixed) * qty,
    rate: toNumber(tier.rate),
    fixed: toNumber(tier.fixed),
    feeMissing: false
  };
}

/**
 * Comissão da linha a partir do rótulo de canal da NF — o caminho que a camada
 * fiscal usa em produção. Canal sem faixa cadastrada devolve 0 + feeMissing.
 */
export function calcMarketplaceFeeForChannel({ channelLabel, revenue, quantity = 1 } = {}) {
  const key = marketplaceKeyForChannel(channelLabel);
  const tiers = key ? MARKETPLACE_FEE_TIERS[key] : null;
  if (!tiers) return { total: 0, rate: 0, fixed: 0, feeMissing: true, marketplaceKey: null };
  return { ...calcMarketplaceFeeForLine({ tiers, revenue, quantity }), marketplaceKey: key };
}

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
 * DIFAL do Oráculo (regra em produção desde 14/08/2026, por orientação do
 * contador): diferença simples entre a alíquota interna do destino e a
 * interestadual nominal, aplicada sobre a base — sem gross-up.
 *
 *   difal = base × max(0, interna − interestadual)
 *
 * Continua existindo só em operação INTERESTADUAL: venda MG→MG retorna 0.
 *
 * Divergência conhecida e deliberada: a NF 533740 (vNF 44,51 · RJ interna 22% ·
 * interestadual 12%) imprime vICMSUFDest 7,21, calculado por dentro; esta regra
 * devolve 4,45 para a mesma nota. É o mesmo tratamento que o ICMS já recebe —
 * o motor mede a premissa do contador, não o campo da NF.
 * Ver docs/adr/ADR-004-difal-diferenca-aliquotas.md.
 */
export function calcDifalDiferencaAliquotas({ base, internalRate, interstateRate, intrastate = false } = {}) {
  const b = toNumber(base);
  if (intrastate || b <= 0) return 0;
  return b * (Math.max(0, toRate(internalRate) - toRate(interstateRate)) / 100);
}

/**
 * DIFAL com base única "por dentro" da LC 190/2022 — regra do motor entre
 * 04/08 e 14/08/2026, mantida como especificação do que a NF traz impressa:
 *       base_destino = base / (1 − interna)
 *       difal        = base_destino × interna − base × interestadual_destacada
 * NF de referência: vNF 44,51 · RJ interna 22% · interestadual 12% →
 * vBCUFDest 57,06 e vICMSUFDest 7,21. O motor NÃO usa mais esta regra —
 * ver calcDifalDiferencaAliquotas.
 */
export function calcDifalPorDentro({ base, internalRate, interstateRate, intrastate = false } = {}) {
  const b = toNumber(base);
  const internal = toRate(internalRate) / 100;
  const interstate = toRate(interstateRate) / 100;
  if (intrastate || b <= 0 || internal <= 0 || internal >= 1) return 0;
  return Math.max(0, (b / (1 - internal)) * internal - b * interstate);
}

/**
 * DIFAL do Financeiro (porte histórico): base × max(0, interno − interestadual),
 * sem gross-up e cobrando intraestadual. O motor do Oráculo NÃO usa mais esta
 * regra — ver calcDifalPorDentro. Mantida como especificação do app original.
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
 *
 * Decisão de 04/08/2026: o motor fiscal do Oráculo usa `creditEnabled: false` —
 * o custo do produto é gestão interna e NÃO entra em cálculo de imposto. O
 * débito é bruto (base × 9,25%), como a NF destaca (CST 01). O crédito das
 * entradas continua existindo na apuração da empresa, só não é simulado aqui.
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
