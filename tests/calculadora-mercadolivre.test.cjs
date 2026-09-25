const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require(require.resolve('typescript', { paths: [__dirname + '/../apps/web'] }));
const source = fs.readFileSync(__dirname + '/../apps/web/app/calculadora/calculator.tsx', 'utf8')
  .replace('import { useMemo, useState } from "react";', '').split('const DEFAULT_RATE_STRINGS')[0];
const ctx = vm.createContext({ Intl });
vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText + '\nObject.assign(globalThis, { calculate, findSalePriceForNetMargin, MARKETPLACE_PRESETS });', ctx);
const rates = { icmsMg: .013, difal: .06, pisCofins: .0925, ads: .03, fixedOperational: .03, averageRefund: 1 };

function presetFor(key) {
  const preset = ctx.MARKETPLACE_PRESETS[key];
  return {
    shipping: preset.shipping,
    tiers: preset.tiers.map(t => ({
      max: t.max,
      rate: t.rate / 100,
      fixed: t.fixed,
      fixedShare: (t.fixedPct ?? 0) / 100
    }))
  };
}

for (const key of ['meliClassico', 'meliPremium']) {
  test(`${key}: cobra R$ 12 de envio somente abaixo de R$ 79,99`, () => {
    const { tiers, shipping } = presetFor(key);

    for (const [price, expected] of [[50, 12], [78.99, 12], [79, 12], [79.98, 12], [79.99, 0], [80, 0]]) {
      const result = ctx.calculate(20, 1, 'price', 0, price, 0, rates, tiers, shipping);
      assert.equal(result.costs.find(c => c.name === 'Envio Mercado Livre').value, expected);
    }
  });
}

test('meta líquida do ML considera a descontinuidade da taxa de envio', () => {
  const { tiers, shipping } = presetFor('meliClassico');
  const target = .2;
  const cost = 35;
  const price = ctx.findSalePriceForNetMargin(target, cost, rates, tiers, shipping);

  assert.ok(price !== null);
  const result = ctx.calculate(cost, 1, 'price', 0, price, 0, rates, tiers, shipping);
  assert.ok(result.netMargin >= target - 1e-9);

  for (let cent = 1; cent < Math.round(price * 100); cent++) {
    const candidate = cent / 100;
    const candidateResult = ctx.calculate(cost, 1, 'price', 0, candidate, 0, rates, tiers, shipping);
    assert.ok(candidateResult.netMargin < target - 1e-9);
  }
});

test('envio do ML continua parametrizável sem alterar as demais tarifas', () => {
  const { tiers, shipping } = presetFor('meliClassico');
  const customizedShipping = { ...shipping, fixed: 15 };
  const result = ctx.calculate(20, 1, 'price', 0, 50, 0, rates, tiers, customizedShipping);

  assert.equal(result.costs.find(c => c.name === 'Envio Mercado Livre').value, 15);
  assert.equal(result.costs.find(c => c.name === 'Marketplace fixo').value, 6.75);
});
