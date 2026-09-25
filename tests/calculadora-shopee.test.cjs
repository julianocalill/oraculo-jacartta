const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require(require.resolve('typescript', { paths: [__dirname + '/../apps/web'] }));
const source = fs.readFileSync(__dirname + '/../apps/web/app/calculadora/calculator.tsx', 'utf8')
  .replace('import { useMemo, useState } from "react";', '').split('const DEFAULT_RATE_STRINGS')[0];
const ctx = vm.createContext({ Intl });
vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText + '\nObject.assign(globalThis, { calculate, MARKETPLACE_PRESETS });', ctx);
const rates = { icmsMg: .013, difal: .06, pisCofins: .0925, ads: .03, fixedOperational: .03, averageRefund: 1 };
const tiers = ctx.MARKETPLACE_PRESETS.shopee.tiers.map(t => ({
  max: t.max,
  rate: t.rate / 100,
  fixed: t.fixed,
  fixedShare: (t.fixedPct ?? 0) / 100
}));

function calc(price) {
  return ctx.calculate(20, 1, 'price', 0, price, 0, rates, tiers);
}

test('Shopee: primeira faixa cobra R$ 4,50 até R$ 79,99 inclusive', () => {
  for (const price of [1, 50, 79.98, 79.99]) {
    assert.equal(calc(price).costs.find(c => c.name === 'Marketplace fixo').value, 4.5);
  }
});

test('Shopee: faixas acima de R$ 79,99 permanecem inalteradas', () => {
  for (const [price, fixed] of [[80, 16], [99.99, 16], [100, 20], [200, 26], [500, 28]]) {
    assert.equal(calc(price).costs.find(c => c.name === 'Marketplace fixo').value, fixed);
  }
});
