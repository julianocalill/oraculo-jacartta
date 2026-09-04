import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialPeriod, commercialTotals, commercialMargin } from './commercial-analysis.js';

test('período conserva o dia escolhido e inclui ambas as pontas', () => {
  assert.deepEqual(commercialPeriod(undefined, undefined, '2026-09-04'), { start: '2026-09-04', end: '2026-09-04', days: 1 });
  assert.deepEqual(commercialPeriod('2026-08-30', '2026-09-04', '2026-09-04'), { start: '2026-08-30', end: '2026-09-04', days: 6 });
  assert.deepEqual(commercialPeriod('2026-08-30', undefined, '2026-09-04'), { start: '2026-08-30', end: '2026-08-30', days: 1 });
});
test('rejeita dias inexistentes, datas invertidas, futuras e intervalos excessivos', () => {
  for (const [start, end] of [['2026-02-30', '2026-03-01'], ['2026-09-03', '2026-09-02'], ['2026-09-05', '2026-09-05'], ['2024-01-01', '2026-09-04'], ['', '2026-09-04']]) {
    assert.ok(commercialPeriod(start, end, '2026-09-04').error);
  }
  assert.equal(commercialPeriod('2024-02-29', '2024-02-29', '2026-09-04').days, 1);
});
test('totais preservam vendas sem margem e ponderam somente a receita coberta', () => {
  const rows = [
    { units: 2, revenue: 100, covered_revenue: 100, covered_profit: 20 },
    { units: 5, revenue: 900, covered_revenue: 0, covered_profit: 0 },
    { units: 1, revenue: 20, covered_revenue: 20, covered_profit: -10 }
  ];
  const totals = commercialTotals(rows);
  assert.equal(totals.revenue, 1020);
  assert.equal(totals.units, 8);
  assert.equal(totals.covered_profit / totals.covered_revenue, 10 / 120);
});
test('produto com custo ou comissão parcial nunca mostra margem completa', () => {
  const base = { revenue: 100, covered_profit: -5, missing_cost_lines: 0, missing_fee_lines: 0 };
  assert.equal(commercialMargin(base), -0.05);
  assert.equal(commercialMargin({ ...base, missing_cost_lines: 1 }), null);
  assert.equal(commercialMargin({ ...base, missing_fee_lines: 1 }), null);
  assert.equal(commercialMargin({ ...base, revenue: 0 }), null);
});
