const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require(require.resolve('typescript', { paths: [__dirname + '/../apps/web'] }));
const source = fs.readFileSync(__dirname + '/../apps/web/app/calculadora/calculator.tsx', 'utf8')
  .replace('import { useMemo, useState } from "react";', '').split('const DEFAULT_RATE_STRINGS')[0];
const ctx = vm.createContext({ Intl });
vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
  + '\nObject.assign(globalThis, { calculate, resolveDifalPercent, MARKETPLACE_PRESETS });', ctx);
const baseRates = { icmsMg: .013, pisCofins: .0925, ads: .03, fixedOperational: .03, averageRefund: 1 };

test('destino a 18%: nacional a 12%/7% dá DIFAL 6%/11%; importado a 4% dá 14%', () => {
  for (const [interstate, expected] of [[12, 6], [7, 11], [4, 14]]) {
    assert.equal(ctx.resolveDifalPercent(true, 'rates', 18, interstate, 99), expected);
  }
  // Não existe uma taxa universal para importados: destino a 20% dá 16%.
  assert.equal(ctx.resolveDifalPercent(true, 'rates', 20, 4, 99), 16);
  assert.equal(ctx.resolveDifalPercent(true, 'rates', 10, 12, 99), 0);
});

test('venda no mesmo estado zera DIFAL inclusive com taxa manual preenchida', () => {
  for (const mode of ['rates', 'manual']) {
    for (const interstate of [4, 7, 12]) {
      assert.equal(ctx.resolveDifalPercent(false, mode, 18, interstate, 14), 0);
    }
  }
});

test('taxa manual preserva a estimativa independentemente da alíquota nominal', () => {
  for (const interstate of [4, 7, 12]) {
    assert.equal(ctx.resolveDifalPercent(true, 'manual', 18, interstate, 8.5), 8.5);
  }
  assert.equal(ctx.resolveDifalPercent(true, 'manual', 18, 4, -1), 0);
});

for (const [key, preset] of Object.entries(ctx.MARKETPLACE_PRESETS)) {
  const tiers = preset.tiers.map(t => ({ max: t.max, rate: t.rate / 100, fixed: t.fixed, fixedShare: (t.fixedPct ?? 0) / 100 }));
  const ratesFor = interstate => ({ ...baseRates, difal: ctx.resolveDifalPercent(true, 'rates', 18, interstate, 6) / 100 });

  test(`${key}: a R$ 100, importado acrescenta R$ 8 de DIFAL e reduz lucro em R$ 8`, () => {
    for (const mode of ['price', 'markup']) {
      const national = ctx.calculate(40, 1, mode, 2.5, 100, 0, ratesFor(12), tiers, preset.shipping);
      const imported = ctx.calculate(40, 1, mode, 2.5, 100, 0, ratesFor(4), tiers, preset.shipping);
      assert.ok(Math.abs(imported.costs.find(c => c.name === 'DIFAL').value - 14) < 1e-9);
      assert.ok(Math.abs(national.netProfit - imported.netProfit - 8) < 1e-9);
      assert.equal(imported.costs.find(c => c.name === 'ICMS MG').value, 1.3);
    }
  });

  test(`${key}: preço reverso com importado atinge 20% e nenhum preço menor atinge`, () => {
    const rates = ratesFor(4);
    const result = ctx.calculate(40, 1, 'netMargin', 0, 0, .2, rates, tiers, preset.shipping);
    assert.equal(result.targetReachable, true);
    assert.ok(result.netMargin >= .2 - 1e-9);
    for (let cents = 1; cents < Math.round(result.salePrice * 100); cents++) {
      const candidate = ctx.calculate(40, 1, 'price', 0, cents / 100, 0, rates, tiers, preset.shipping);
      assert.ok(candidate.netMargin < .2 - 1e-9);
    }
  });
}
