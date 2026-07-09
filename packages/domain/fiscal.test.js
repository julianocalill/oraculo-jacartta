import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcDifalRate,
  calcEffectiveTaxRate,
  deriveStateTax,
  isValidFiscalInvoice,
  isCanceledInvoice,
  calcSkuMargin,
  marginSignal,
  icmsRateForUf,
  interstateIcmsRate,
  calcDifal,
  calcNetCost,
  calcShopeeMarketplaceFee,
  calcPisCofins,
  calcFiscalOrder,
  normalizeFiscalOrigin
} from "./fiscal.js";

const closeTo = (actual, expected, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected} (tol ${tol})`);

test("DIFAL: MG destino com alíquota interna maior que a interestadual", () => {
  // MG importado 14% interno vs 4% interestadual => DIFAL 10%
  closeTo(calcDifalRate(0.14, 0.04), 0.10);
});

test("DIFAL: nunca é negativo (interna <= interestadual)", () => {
  closeTo(calcDifalRate(0.04, 0.12), 0);
  closeTo(calcDifalRate(0.013, 0.013), 0);
});

test("Carga efetiva = interestadual + DIFAL + FCP", () => {
  closeTo(
    calcEffectiveTaxRate({ interstateIcmsRate: 0.04, difalRate: 0.10, fcpRate: 0.02 }),
    0.16
  );
});

test("deriveStateTax combina DIFAL e carga efetiva como o trigger do SQL", () => {
  const { difalRate, effectiveTaxRate } = deriveStateTax({
    internalIcmsRate: 0.18,
    interstateIcmsRate: 0.07,
    fcpRate: 0.02
  });
  closeTo(difalRate, 0.11);
  closeTo(effectiveTaxRate, 0.20); // 0.07 + 0.11 + 0.02
});

test("NF válida: status 6 e 7, sem devolução e sem entrada", () => {
  assert.equal(isValidFiscalInvoice({ status: "6", invoiceType: "S", originType: "venda" }), true);
  assert.equal(isValidFiscalInvoice({ status: "7", invoiceType: null, originType: null }), true);
});

test("NF inválida: cancelada, entrada (E) ou devolução são excluídas", () => {
  assert.equal(isValidFiscalInvoice({ status: "8" }), false); // cancelada
  assert.equal(isValidFiscalInvoice({ status: "6", invoiceType: "E" }), false); // entrada
  assert.equal(isValidFiscalInvoice({ status: "6", originType: "devolucao" }), false); // devolução
  assert.equal(isValidFiscalInvoice({ status: "6", invoiceType: "e" }), false); // case-insensitive
  assert.equal(isValidFiscalInvoice({ status: "6", originType: "DEVOLUCAO" }), false);
});

test("Cancelada é status 8", () => {
  assert.equal(isCanceledInvoice({ status: "8" }), true);
  assert.equal(isCanceledInvoice({ status: "6" }), false);
});

test("Margem/ROI: caso do manguito do metric-contract", () => {
  // Venda 49.90, custo Olist 30.82, ICMS 1.3% + PIS/COFINS ~9.25% aplicados como taxa
  const r = calcSkuMargin({
    revenue: 49.9,
    units: 1,
    unitCost: 30.82,
    taxRate: 0.013 + 0.0925,
    marketplaceFeeRate: 0,
    paymentFeeRate: 0
  });
  closeTo(r.productCost, 30.82, 1e-6);
  // fee = 49.9 * 0.1055 = 5.26445
  closeTo(r.feeCost, 5.26445, 1e-6);
  // margem = 49.9 - 30.82 - 5.26445 = 13.81555
  closeTo(r.marginAmount, 13.81555, 1e-6);
  closeTo(r.marginRate, 13.81555 / 49.9, 1e-9);
  closeTo(r.roi, 13.81555 / 30.82, 1e-9);
});

test("Margem: ROI é null quando não há custo (evita divisão por zero)", () => {
  const r = calcSkuMargin({ revenue: 100, units: 2, unitCost: 0 });
  assert.equal(r.roi, null);
  assert.equal(r.marginRate, 1); // sem custo nem taxa, margem = receita inteira
});

test("Margem: marginRate é null quando não há receita", () => {
  const r = calcSkuMargin({ revenue: 0, units: 0, unitCost: 10 });
  assert.equal(r.marginRate, null);
});

test("Sinal de margem segue a precedência da view", () => {
  assert.equal(marginSignal({ units: 0 }), "sem_venda");
  assert.equal(marginSignal({ units: 5, paramsConfigured: false }), "configurar_parametros");
  assert.equal(marginSignal({ units: 5, paramsConfigured: true, unitCost: 0 }), "sem_custo");
  assert.equal(
    marginSignal({ units: 5, paramsConfigured: true, unitCost: 10, marginRate: 0.05, minimumMarginRate: 0.12, targetMarginRate: 0.25 }),
    "critico"
  );
  assert.equal(
    marginSignal({ units: 5, paramsConfigured: true, unitCost: 10, marginRate: 0.18, minimumMarginRate: 0.12, targetMarginRate: 0.25 }),
    "atencao"
  );
  assert.equal(
    marginSignal({ units: 5, paramsConfigured: true, unitCost: 10, marginRate: 0.30, minimumMarginRate: 0.12, targetMarginRate: 0.25 }),
    "saudavel"
  );
});

// --- Regras portadas do Financeiro ---

test("Custo líquido: importado por transferência = valor NF × 0,8425 (exemplo real R$393.300)", () => {
  const r = calcNetCost({ grossTotal: 393300, isImportedTransfer: true });
  closeTo(r.total, 331355.25, 1e-6); // 393300 × (1 - 0.1575)
  assert.equal(r.rule, "imported_transfer_4_icms_1175_pis_cofins");
});

test("Custo líquido: precedência (net explícito, gross-créditos, gross puro, missing)", () => {
  assert.deepEqual(calcNetCost({ netTotal: 100, grossTotal: 200 }), { total: 100, rule: "explicit_net_cost" });
  assert.deepEqual(calcNetCost({ grossTotal: 200, recoverableTaxes: 30 }), { total: 170, rule: "gross_minus_recoverable_taxes" });
  assert.deepEqual(calcNetCost({ grossTotal: 200 }), { total: 200, rule: "gross_cost" });
  assert.equal(calcNetCost({}).total, null);
});

test("Matriz ICMS Jacarta: MG 6% nacional / 14% importado; demais UFs 1,3%", () => {
  assert.equal(icmsRateForUf({ profile: "jacarta", origin: "nacional", uf: "MG" }), 6);
  assert.equal(icmsRateForUf({ profile: "jacarta", origin: "importado", uf: "MG" }), 14);
  assert.equal(icmsRateForUf({ profile: "jacarta", origin: "nacional", uf: "SP" }), 1.3);
  assert.equal(icmsRateForUf({ profile: "jacarta", origin: "importado", uf: "CE" }), 1.3);
});

test("Matriz ICMS Gira Casa: SP 18%; Sul/Sudeste 12%; demais 7% (nacional); importado 4%", () => {
  assert.equal(icmsRateForUf({ profile: "gira-casa", origin: "nacional", uf: "SP" }), 18);
  assert.equal(icmsRateForUf({ profile: "gira-casa", origin: "nacional", uf: "RJ" }), 12);
  assert.equal(icmsRateForUf({ profile: "gira-casa", origin: "nacional", uf: "BA" }), 7);
  assert.equal(icmsRateForUf({ profile: "gira-casa", origin: "importado", uf: "BA" }), 4);
});

test("Alíquota interestadual: intraestadual 0, importado 4, nacional 12 (Sul/Sudeste) vs 7", () => {
  assert.equal(interstateIcmsRate("MG", "MG", "nacional"), 0);
  assert.equal(interstateIcmsRate("MG", "CE", "importado"), 4);
  assert.equal(interstateIcmsRate("MG", "SP", "nacional"), 12); // ambos Sul/Sudeste
  assert.equal(interstateIcmsRate("MG", "CE", "nacional"), 7);  // destino fora
});

test("DIFAL = base × max(0, interna_destino − interestadual)", () => {
  // CE interna 20, MG→CE nacional interestadual 7 → DIFAL 13%
  const r = calcDifal({ base: 1000, destState: "CE", sourceState: "MG", origin: "nacional" });
  closeTo(r.rate, 13);
  closeTo(r.amount, 130);
  // override por valor explícito
  closeTo(calcDifal({ base: 1000, destState: "CE", explicitAmount: 50 }).amount, 50);
});

test("Taxa Shopee por faixa", () => {
  const a = calcShopeeMarketplaceFee(49.9); // faixa 20% + 4
  closeTo(a.total, 49.9 * 0.2 + 4, 1e-6);
  const b = calcShopeeMarketplaceFee(150); // faixa 14% + 20
  closeTo(b.total, 150 * 0.14 + 20, 1e-6);
  const c = calcShopeeMarketplaceFee(800); // faixa 14% + 28
  closeTo(c.total, 800 * 0.14 + 28, 1e-6);
});

test("PIS/COFINS líquido = débito(base) − crédito(custo), nunca negativo", () => {
  closeTo(calcPisCofins({ base: 100, netCost: 50, rate: 9.25 }), (100 - 50) * 0.0925, 1e-9);
  closeTo(calcPisCofins({ base: 100, netCost: 200, rate: 9.25 }), 0); // crédito > débito → 0
  closeTo(calcPisCofins({ base: 100, netCost: 50, rate: 9.25, creditEnabled: false }), 9.25);
});

test("normalizeFiscalOrigin", () => {
  assert.equal(normalizeFiscalOrigin("Importado"), "importado");
  assert.equal(normalizeFiscalOrigin("NACIONAL"), "nacional");
  assert.equal(normalizeFiscalOrigin("1"), "");
});

test("calcFiscalOrder: pedido nacional Jacarta destino SP (fim a fim)", () => {
  const r = calcFiscalOrder({
    gross: 100,
    invoiceValue: 100,
    grossCost: 40,
    profile: "jacarta",
    origin: "nacional",
    destState: "SP",
    sourceState: "MG",
    marketplaceFee: 18
  });
  closeTo(r.icmsRate, 1.3);
  closeTo(r.icms, 1.3);               // 100 × 1,3%
  closeTo(r.pisCofins, (100 - 40) * 0.0925, 1e-9); // débito 9,25 − crédito 3,70
  // DIFAL MG→SP nacional: interna SP 18, interestadual 12 → 6% → 6
  closeTo(r.difal.amount, 6);
  closeTo(r.taxesTotal, 1.3 + (100 - 40) * 0.0925 + 6, 1e-9);
  // lucro = 100 − 18(fee) − 40(custo) − impostos
  closeTo(r.profit, 100 - 18 - 40 - r.taxesTotal, 1e-9);
  closeTo(r.margin, r.profit / 100, 1e-9);
  closeTo(r.roi, r.profit / 40, 1e-9);
});

test("calcFiscalOrder: fica pendente quando falta custo ou UF/origem não resolve", () => {
  const semCusto = calcFiscalOrder({ gross: 100, destState: "SP", profile: "jacarta", origin: "nacional" });
  assert.equal(semCusto.costMissing, true);
  assert.equal(semCusto.profit, null);
  const semUf = calcFiscalOrder({ gross: 100, grossCost: 40, profile: "jacarta", origin: "nacional", destState: null });
  assert.equal(semUf.fiscalPending, true);
  assert.equal(semUf.profit, null);
});
