import test from "node:test";
import assert from "node:assert/strict";
import { calcOperationFiscalOrder } from "./operation-fiscal.js";

test("Giracasa SP→SP uses gross cost, 18% ICMS, PIS/COFINS credit and no DIFAL", () => {
  const value = calcOperationFiscalOrder({ operationId: "giracasa", invoiceValue: 100,
    grossCost: 40, origin: "nacional", destState: "SP", marketplaceFee: 10 });
  assert.equal(value.cost, 40);
  assert.equal(value.icms, 18);
  assert.equal(value.pisCofins, 5.55);
  assert.equal(value.difal, 0);
  assert.ok(Math.abs(value.profit - 26.45) < 1e-9);
});

test("Giracasa applies interstate matrix and DIFAL from SP", () => {
  const value = calcOperationFiscalOrder({ operationId: "giracasa", invoiceValue: 100,
    grossCost: 40, origin: "nacional", destState: "MG", marketplaceFee: 10 });
  assert.equal(value.icms, 12);
  assert.equal(value.difal, 6);
});

test("Giracasa imported transfer only receives 15.75% credit when explicitly marked", () => {
  const ordinary = calcOperationFiscalOrder({ operationId: "giracasa", invoiceValue: 100,
    grossCost: 40, origin: "importado", destState: "SP", marketplaceFee: 10 });
  const transfer = calcOperationFiscalOrder({ operationId: "giracasa", invoiceValue: 100,
    grossCost: 40, origin: "importado", isImportedTransfer: true, destState: "SP", marketplaceFee: 10 });
  assert.equal(ordinary.cost, 40);
  assert.equal(transfer.cost, 33.7);
});

test("Giracasa preserves explicit cost precedence and records the engine version", () => {
  const explicitNet = calcOperationFiscalOrder({ operationId: "giracasa", invoiceValue: 100,
    grossCost: 40, netCost: 31, recoverableTaxes: 6, isImportedTransfer: true,
    origin: "importado", destState: "SP", marketplaceFee: 10 });
  const measuredCredits = calcOperationFiscalOrder({ operationId: "giracasa", invoiceValue: 100,
    grossCost: 40, recoverableTaxes: 6, isImportedTransfer: true,
    origin: "importado", destState: "SP", marketplaceFee: 10 });
  assert.equal(explicitNet.cost, 31);
  assert.equal(explicitNet.costRule, "explicit_net_cost");
  assert.equal(explicitNet.ruleVersion, "gira-casa-v1");
  assert.equal(measuredCredits.cost, 34);
  assert.equal(measuredCredits.costRule, "gross_minus_recoverable_taxes");
});

test("Giracasa imported SP→SP keeps 18% ICMS and zero DIFAL", () => {
  const value = calcOperationFiscalOrder({ operationId: "giracasa", invoiceValue: 100,
    grossCost: 40, origin: "importado", destState: "SP", marketplaceFee: 10 });
  assert.equal(value.icms, 18);
  assert.equal(value.difal, 0);
});

test("financial result stays pending instead of inventing missing inputs", () => {
  assert.equal(calcOperationFiscalOrder({ operationId: "giracasa", invoiceValue: 100,
    grossCost: null, origin: "nacional", destState: "SP", marketplaceFee: 10 }).profit, null);
  assert.equal(calcOperationFiscalOrder({ operationId: "giracasa", invoiceValue: 100,
    grossCost: 40, origin: "nacional", destState: "SP" }).profit, null);
});

test("operation is mandatory", () => {
  assert.throws(() => calcOperationFiscalOrder({ invoiceValue: 100 }), /Operação financeira/);
});
