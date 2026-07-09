import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calcDifalRate,
  calcEffectiveTaxRate,
  deriveStateTax,
  isValidFiscalInvoice,
  isCanceledInvoice,
  calcSkuMargin,
  marginSignal
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
