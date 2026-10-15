import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from '../apps/web/node_modules/typescript/lib/typescript.js';
import { shopeeCollectionReady } from '../packages/domain/data-coverage.js';

const shops = [{ shop_id: 1, shop_name: 'Loja A' }, { shop_id: 2, shop_name: 'Loja B' }];
function runtime({ failTable, failRpc = false, pending = [], failed = 0, operation = 'uberlandia' } = {}) {
  const logged = [], calls = [];
  const timeout = { code: '57014', message: 'canceling statement due to statement timeout' };
  const db = {
    from(table) {
      calls.push(table);
      const result = table === failTable ? { error: timeout } : {
        data: table === 'shopee_shops' ? shops : table === 'shopee_sync_runs'
          ? { status: 'success', finished_at: new Date().toISOString(), meta: {} } : [],
        count: failed, error: null
      };
      const chain = new Proxy({}, { get: (_, key) => key === 'then'
        ? Promise.resolve(result).then.bind(Promise.resolve(result)) : () => chain });
      return chain;
    },
    rpc: async () => ({ data: pending, error: failRpc ? timeout : null })
  };
  const source = readFileSync('apps/web/lib/source-health.ts', 'utf8')
    .replace(/^import .*\n/gm, '').replace(/export async function/g, 'async function');
  const context = {
    shopeeCollectionReady, getRequestOperation: async () => operation,
    createSupabaseAdminClient: ({ operation: selected }) => { assert.equal(selected, operation); return db; },
    console: { error: (...args) => logged.push(args) }
  };
  vm.runInNewContext(ts.transpileModule(source + '\nglobalThis.load = loadShopeeCollection;', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText, context);
  return { load: context.load, logged, calls };
}

test('escrow timeout preserves the shop filter and marks coverage unknown', async () => {
  const rt = runtime({ failRpc: true });
  const result = await rt.load('shopee-escrow-sync', '2');
  assert.equal(result.ready, false);
  assert.equal(result.unavailable, true);
  assert.equal(result.shops.length, 2);
  assert.equal(result.pending.join(','), 'Loja B');
  assert.equal(rt.logged.length, 1);
});

test('directory, run and error-count failures cannot crash collection diagnostics', async () => {
  for (const failTable of ['shopee_shops', 'shopee_sync_runs', 'shopee_order_escrow']) {
    const result = await runtime({ failTable }).load('shopee-escrow-sync');
    assert.equal(result.ready, false);
    assert.equal(result.unavailable, true);
    assert.equal(result.shops.length, failTable === 'shopee_shops' ? 0 : 2);
  }
});

test('successful diagnostics still distinguish complete, backlog and failed records', async () => {
  for (const [options, ready] of [[{}, true], [{ pending: [{ order_sn: 'pending' }] }, false], [{ failed: 1 }, false]]) {
    const result = await runtime(options).load('shopee-escrow-sync');
    assert.equal(result.ready, ready);
    assert.equal(result.unavailable, false);
  }
});

test('Giracasa history failure stays isolated and cannot become ready', async () => {
  const result = await runtime({ operation: 'giracasa', failTable: 'shopee_order_backfill_state' })
    .load('shopee-escrow-sync');
  assert.equal(result.ready, false);
  assert.equal(result.unavailable, true);
  assert.equal(result.shops.length, 2);
});

test('returns and reconciliation retain their collection behavior', async () => {
  for (const source of ['shopee-returns-sync', 'shopee-reconciliation-sync']) {
    const rt = runtime({ failRpc: true });
    const result = await rt.load(source);
    assert.equal(result.ready, true);
    assert.equal(result.unavailable, false);
    assert.equal(rt.calls.includes('shopee_order_escrow'), false);
  }
});
