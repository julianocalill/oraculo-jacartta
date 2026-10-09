const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require(require.resolve('typescript', { paths: [__dirname + '/../apps/web'] }));
const source = fs.readFileSync(__dirname + '/../apps/web/app/calculadora/calculator.tsx', 'utf8')
  .replace('import { useMemo, useState } from "react";', '').split('const DEFAULT_RATE_STRINGS')[0];
const ctx = vm.createContext({ Intl });
vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
  + '\nObject.assign(globalThis, { calculate, resolveDifalPercent, resolveIcmsPercent, CALCULATOR_OPERATIONS, MARKETPLACE_PRESETS });', ctx);

function ratesFor(operation, interstateSale, nominal, internal = 18) {
  return {
    icmsMg: ctx.resolveIcmsPercent(operation, interstateSale, internal, nominal, 1.3) / 100,
    icmsLabel: ctx.CALCULATOR_OPERATIONS[operation].icmsLabel,
    difal: ctx.resolveDifalPercent(interstateSale, 'rates', internal, nominal, 6) / 100,
    pisCofins: .0925, ads: .03, fixedOperational: .03, averageRefund: 1
  };
}

function tiersFor(preset) {
  return preset.tiers.map(t => ({ max: t.max, rate: t.rate / 100, fixed: t.fixed, fixedShare: (t.fixedPct ?? 0) / 100 }));
}

test('Jacartta preserva RET 1,3% e não recebe ICMS nominal da Giracasa', () => {
  for (const interstate of [true, false]) {
    for (const nominal of [4, 7, 12]) {
      assert.equal(ctx.resolveIcmsPercent('uberlandia', interstate, 18, nominal, 1.3), 1.3);
    }
  }
  assert.equal(ctx.resolveIcmsPercent('uberlandia', true, 18, 12, 2), 2);
});

test('Giracasa usa ICMS da saída: 12%, 7%, 4% fora e 18% dentro; ignora RET', () => {
  for (const nominal of [4, 7, 12]) {
    assert.equal(ctx.resolveIcmsPercent('giracasa', true, 18, nominal, 99), nominal);
    assert.equal(ctx.resolveIcmsPercent('giracasa', false, 18, nominal, 99), 18);
  }
  assert.equal(ctx.resolveIcmsPercent('giracasa', false, 12, 4, 1.3), 12);
});

for (const [key, preset] of Object.entries(ctx.MARKETPLACE_PRESETS)) {
  const tiers = tiersFor(preset);
  test(`${key}: Giracasa soma saída + DIFAL sem acrescentar RET de MG`, () => {
    for (const [interstate, nominal, expectedIcms, expectedDifal] of [[true, 12, 12, 6], [true, 7, 7, 11], [true, 4, 4, 14], [false, 4, 18, 0]]) {
      const result = ctx.calculate(40, 1, 'price', 0, 100, 0, ratesFor('giracasa', interstate, nominal), tiers, preset.shipping);
      assert.ok(Math.abs(result.costs.find(c => c.name === 'ICMS de saída Giracasa').value - expectedIcms) < 1e-9);
      assert.ok(Math.abs(result.costs.find(c => c.name === 'DIFAL').value - expectedDifal) < 1e-9);
      assert.equal(result.costs.some(c => c.name.includes('Jacartta')), false);
    }
  });

  for (const operation of ['uberlandia', 'giracasa']) {
    test(`${key}/${operation}: menor preço por margem respeita o ICMS da operação`, () => {
      const rates = ratesFor(operation, true, 12);
      const result = ctx.calculate(20, 1, 'netMargin', 0, 0, .2, rates, tiers, preset.shipping);
      assert.equal(result.targetReachable, true);
      assert.ok(result.netMargin >= .2 - 1e-9);
      for (let cents = 1; cents < Math.round(result.salePrice * 100); cents++) {
        const candidate = ctx.calculate(20, 1, 'price', 0, cents / 100, 0, rates, tiers, preset.shipping);
        assert.ok(candidate.netMargin < .2 - 1e-9);
      }
    });
  }
}
