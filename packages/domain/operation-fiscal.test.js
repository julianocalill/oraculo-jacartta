import test from "node:test";
import assert from "node:assert/strict";
import { calcOperationFiscalOrder } from "./operation-fiscal.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const giracasa = (overrides = {}) => calcOperationFiscalOrder({ operationId: "giracasa", invoiceValue: 100,
  grossCost: 40, origin: "nacional", destState: "SP", marketplaceFee: 10, ...overrides });

test("gira-casa-v2: custo líquido de ICMS da compra e PIS/COFINS, sobre o custo cheio", () => {
  const value = giracasa({ purchaseIcmsRate: 12 });
  near(value.cost, 31.5); // 40 × (1 − 12% − 9,25%)
  assert.equal(value.costRule, "gross_minus_purchase_icms_and_pis_cofins");
  assert.equal(value.ruleVersion, "gira-casa-v2");
});

test("gira-casa-v2: sem nota de compra usa 12% nacional e 4% importado", () => {
  near(giracasa().cost, 31.5);
  near(giracasa({ origin: "importado" }).cost, 34.7); // 40 × (1 − 4% − 9,25%)
  assert.equal(giracasa().costRule, "gross_minus_origin_icms_and_pis_cofins");
});

test("gira-casa-v2: nota de compra com ICMS medido prevalece sobre a origem", () => {
  near(giracasa({ origin: "importado", purchaseIcmsRate: 18 }).cost, 29.1); // 40 × (1 − 18% − 9,25%)
});

test("gira-casa-v2: PIS/COFINS da venda é o débito cheio, sem crédito", () => {
  const value = giracasa({ purchaseIcmsRate: 12 });
  near(value.pisCofins, 9.25);
  near(value.icms, 18);
  assert.equal(value.difal, 0);
  near(value.profit, 100 - 31.5 - 18 - 9.25 - 10);
});

test("gira-casa-v2: DIFAL usa as alíquotas internas da tabela do contador", () => {
  const mg = giracasa({ destState: "MG" });
  near(mg.icms, 12);
  near(mg.difal, 6);   // MG 18 − 12
  const ba = giracasa({ origin: "importado", destState: "BA" });
  near(ba.icms, 4);
  near(ba.difal, 14);  // BA 18 − 4 (a tabela de 2026 daria 16,5)
  near(giracasa({ destState: "RJ" }).difal, 8); // RJ 20 − 12
  near(giracasa({ destState: "RO", origin: "importado" }).difal, 13.5); // RO 17,5 − 4
});

test("gira-casa-v2: custo explícito e créditos medidos por SKU mantêm precedência", () => {
  const explicitNet = giracasa({ netCost: 31, recoverableTaxes: 6, purchaseIcmsRate: 12 });
  assert.equal(explicitNet.cost, 31);
  assert.equal(explicitNet.costRule, "explicit_net_cost");
  const measuredCredits = giracasa({ recoverableTaxes: 6, purchaseIcmsRate: 12 });
  assert.equal(measuredCredits.cost, 34);
  assert.equal(measuredCredits.costRule, "gross_minus_recoverable_taxes");
});

test("Uberlândia não muda: DIFAL continua com a tabela interna de 2026", () => {
  const value = calcOperationFiscalOrder({ operationId: "uberlandia", invoiceValue: 100,
    grossCost: 40, origin: "importado", destState: "BA", marketplaceFee: 10 });
  near(value.difal, 16.5); // BA 20,5 − 4
  assert.equal(value.ruleVersion, "jacarta-v1");
  assert.equal(value.costRule, "jacarta_origin_credit");
});

test("Giracasa never replaces a missing invoice with artificial revenue", () => {
  const value = giracasa({ invoiceValue: null });
  assert.equal(value.base, null);
  assert.equal(value.pending, true);
  assert.equal(value.profit, null);
});

test("financial result stays pending instead of inventing missing inputs", () => {
  assert.equal(giracasa({ grossCost: null }).profit, null);
  assert.equal(giracasa({ marketplaceFee: undefined }).profit, null);
});

test("operation is mandatory", () => {
  assert.throws(() => calcOperationFiscalOrder({ invoiceValue: 100 }), /Operação financeira/);
});
