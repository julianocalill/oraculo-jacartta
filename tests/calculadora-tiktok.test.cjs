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
const tiers = ctx.MARKETPLACE_PRESETS.tiktok.tiers.map(t => ({
  max: t.max,
  rate: t.rate / 100,
  fixed: t.fixed,
  fixedShare: (t.fixedPct ?? 0) / 100
}));
const shipping = ctx.MARKETPLACE_PRESETS.tiktok.shipping;
const calc = (price, cost = 65) => ctx.calculate(cost, 1, 'price', 0, price, 0, rates, tiers, shipping);

test('TikTok: faixas operacionais aplicam a tarifa fixa na fronteira de preço', () => {
  for (const [price, rate, fixed, shippingFixed] of [[45,.10,4,12.1],[49.99,.10,4,12.1],[50,.06,6,19.3],[75,.06,6,19.3],[129.9,.06,6,19.3],[500,.06,6,19.3]]) {
    const result = calc(price);
    assert.ok(Math.abs(result.costs.find(c => c.name === 'Marketplace variável').value - price * rate) < 1e-9);
    assert.equal(result.costs.find(c => c.name === 'Marketplace fixo').value, fixed);
    assert.equal(result.costs.find(c => c.name === 'Envio TikTok').value, shippingFixed);
  }
});

test('caso da diretoria: venda R$ 129,90 e custo R$ 65', () => {
  const result = calc(129.9);
  assert.equal(result.netProfit.toFixed(2), '7.53');
  assert.equal((result.netMargin * 100).toFixed(2), '5.79');
  assert.equal(ctx.calculate(13, 5, 'price', 0, 129.9, 0, rates, tiers, shipping).netProfit, result.netProfit);
});

test('meta líquida encontra menor preço com as novas faixas', () => {
  for (const cost of [5, 20, 65]) for (const target of [0, .1, .2, .3]) {
    const price = ctx.findSalePriceForNetMargin(target, cost, rates, tiers, shipping);
    assert.ok(price !== null);
    assert.ok(calc(price, cost).netMargin >= target - 1e-9);
    for (let cent = 1; cent < Math.round(price * 100); cent++) {
      const p = cent / 100, rate = p < 50 ? .1 : .06, fixed = p < 50 ? 4 : 6, shippingFixed = p < 50 ? 12.1 : 19.3;
      const profit = p - cost - p*rate - fixed - shippingFixed - p*(.013+.06+.03+.03) - (p-cost)*.0925 - 1;
      assert.ok(profit / p < target - 1e-9);
    }
  }
});

test('comissão opcional de afiliado reduz o lucro e entra na busca por margem', () => {
  const affiliateRates = { ...rates, affiliate: .08 };
  const withoutAffiliate = calc(129.9);
  const withAffiliate = ctx.calculate(65, 1, 'price', 0, 129.9, 0, affiliateRates, tiers, shipping);
  const affiliateCost = withAffiliate.costs.find(c => c.name === 'Afiliado');

  assert.equal(affiliateCost.value.toFixed(2), '10.39');
  assert.equal((withoutAffiliate.netProfit - withAffiliate.netProfit).toFixed(2), '10.39');

  const target = .2;
  const price = ctx.findSalePriceForNetMargin(target, 65, affiliateRates, tiers, shipping);
  assert.ok(price !== null);
  const result = ctx.calculate(65, 1, 'price', 0, price, 0, affiliateRates, tiers, shipping);
  assert.ok(result.netMargin >= target - 1e-9);
});
