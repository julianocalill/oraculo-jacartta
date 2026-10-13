import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialCoverage, coveredForecastWeek, forecastCoverageIssue } from './data-coverage.js';

test('orders without items cannot produce a zero-demand forecast or negative trend', () => {
  const raw = { forecast_units: 0, trend: 0.7, base_avg_units: 0,
    weeks_detail: [{ orders: 4963, units: 0, items_coverage_pct: 0, is_base: true }] };
  const safe = coveredForecastWeek(raw);
  assert.equal(safe.forecast_units, null);
  assert.equal(safe.trend, null);
  assert.match(safe.calc_note, /indisponível/);
  assert.equal(raw.trend, 0.7);
});
test('missing previous-period items invalidate the trend even if the base is complete', () => {
  assert.ok(forecastCoverageIssue({ weeks_detail: [
    { orders: 100, items_coverage_pct: 100, is_base: true },
    { orders: 100, items_coverage_pct: 80, is_base: false }
  ] }));
});
test('a measured zero and a week without orders remain valid', () => {
  const week = { forecast_units: 0, weeks_detail: [{ orders: 0, items_coverage_pct: null }] };
  assert.equal(coveredForecastWeek(week), week);
  assert.equal(forecastCoverageIssue({ weeks_detail: [{ orders: 100, items_coverage_pct: 90 }] }), null);
});
test('unknown coverage is missing when orders exist', () => {
  assert.ok(forecastCoverageIssue({ weeks_detail: [{ orders: 1, items_coverage_pct: null }] }));
  assert.deepEqual(commercialCoverage({ orders_valid: 10, orders_with_items: 0 }),
    { orders: 10, covered: 0, percent: 0, unavailable: true, partial: true });
  assert.equal(commercialCoverage({ orders_valid: 0, orders_with_items: 0 }).unavailable, false);
});
