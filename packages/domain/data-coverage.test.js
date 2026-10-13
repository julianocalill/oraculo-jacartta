import test from 'node:test';
import assert from 'node:assert/strict';
import { commercialCoverage, coveredForecastWeek, forecastCoverageIssue, shopeeCollectionReady, reconciliationVisibility } from './data-coverage.js';

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

test('a successful escrow batch with missing history or pending statements remains incomplete', () => {
  const now = Date.parse('2026-10-13T17:30:00Z');
  const run = { status: 'success', finished_at: '2026-10-13T17:20:00Z', meta: { failed: 0 } };
  assert.equal(shopeeCollectionReady(run, { backlog: true }, now), false);
  assert.equal(shopeeCollectionReady(run, { historyReady: false }, now), false);
  assert.equal(shopeeCollectionReady(run, { failedRecords: 1 }, now), false);
  assert.equal(shopeeCollectionReady(run, {}, now), true);
});
test('deferred, capped, stale or failed collections cannot certify financial coverage', () => {
  const now = Date.parse('2026-10-13T17:30:00Z');
  const run = { status: 'success', finished_at: '2026-10-13T17:20:00Z' };
  for (const meta of [{ deferred: true }, { capped: true }, { failed: 1 }]) {
    assert.equal(shopeeCollectionReady({ ...run, meta }, {}, now), false);
  }
  assert.equal(shopeeCollectionReady({ ...run, finished_at: '2026-10-11T17:20:00Z' }, {}, now), false);
  assert.equal(shopeeCollectionReady(null, {}, now), false);
});
test('an unfinished wallet history cannot report zero paid, zero alerts or its old balance as current', () => {
  const result = reconciliationVisibility({ ready: false, lastSyncedAt: '2026-10-13',
    walletsCount: 1, balanceAsOf: '2026-08-27', releasedCount: 0, attentionCount: 0 });
  assert.deepEqual(result, { summary: true, wallet: false, total: false, paid: false, alerts: false });
});
test('observed partial credits remain visible and a completed collection permits measured zeros', () => {
  const input = { lastSyncedAt: null, walletsCount: 1, balanceAsOf: '2026-10-13', releasedCount: 1, attentionCount: 2 };
  assert.deepEqual(reconciliationVisibility({ ...input, ready: false }),
    { summary: false, wallet: false, total: false, paid: true, alerts: true });
  assert.deepEqual(reconciliationVisibility({ ...input, ready: true, releasedCount: 0, attentionCount: 0 }),
    { summary: true, wallet: true, total: true, paid: true, alerts: true });
});
