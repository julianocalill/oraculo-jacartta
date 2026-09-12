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
const tiers = ctx.MARKETPLACE_PRESETS.tiktok.tiers.map(t => ({ ...t, rate: t.rate / 100 }));
const calc = (price, cost = 65) => ctx.calculate(cost, 1, 'price', 0, price, 0, rates, tiers);

test('TikTok: exemplos oficiais e fronteiras de preço mantêm a tarifa fixa', () => {
  for (const [price, rate, fixed] of [[45,.10,4],[49.99,.10,4],[50,.06,6],[75,.06,6],[78.99,.06,6],[79,.06,6],[129.9,.06,6],[500,.06,6]]) {
    const result = calc(price);
    assert.ok(Math.abs(result.costs.find(c => c.name === 'Marketplace variável').value - price * rate) < 1e-9);
    assert.equal(result.costs.find(c => c.name === 'Marketplace fixo').value, fixed);
  }
});

test('caso da diretoria: venda R$ 129,90 e custo R$ 65', () => {
  const result = calc(129.9);
  assert.equal(result.netProfit.toFixed(2), '26.83');
  assert.equal((result.netMargin * 100).toFixed(2), '20.65');
  assert.equal(ctx.calculate(13, 5, 'price', 0, 129.9, 0, rates, tiers).netProfit, result.netProfit);
});

test('meta líquida encontra menor preço com as novas faixas', () => {
  for (const cost of [5, 20, 65]) for (const target of [0, .1, .2, .3]) {
    const price = ctx.findSalePriceForNetMargin(target, cost, rates, tiers);
    assert.ok(price !== null);
    assert.ok(calc(price, cost).netMargin >= target - 1e-9);
    for (let cent = 1; cent < Math.round(price * 100); cent++) {
      const p = cent / 100, rate = p < 50 ? .1 : .06, fixed = p < 50 ? 4 : 6;
      const profit = p - cost - p*rate - fixed - p*(.013+.06+.03+.03) - (p-cost)*.0925 - 1;
      assert.ok(profit / p < target - 1e-9);
    }
  }
});
