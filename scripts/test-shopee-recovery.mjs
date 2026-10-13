import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import ts from '../apps/web/node_modules/typescript/lib/typescript.js';

function runtime(name, overrides = {}) {
  const code = readFileSync(`supabase/functions/${name}/index.ts`, 'utf8').replace(/^import .*\n/gm, '');
  const context = { URL, URLSearchParams, Request, Response, TextEncoder, Map, Date, crypto: webcrypto,
    console, fetch: async () => { throw new Error('Unexpected request'); },
    createClient: () => { throw new Error('Unauthenticated DB access'); },
    Deno: { env: { get: () => undefined }, serve: fn => { context.handler = fn; } }, ...overrides };
  const compiled = ts.transpileModule(code + '\n globalThis.testFns = { ' + (name === 'shopee-sync' ? 'syncShop' : 'syncShopSbs') + ' };',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }, reportDiagnostics: true });
  assert.equal((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(compiled.outputText, context);
  return context;
}
function fixture({ failDetail = 0, failState = false } = {}) {
  const persisted = [], orders = [];
  let page = 0;
  const db = { from: table => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { access_token: 'test', access_token_expires_at: new Date(Date.now()+3600000).toISOString() } }) }) }),
    upsert: async rows => { if (table === 'shopee_orders') orders.push(...rows); return { error: null }; },
    update: values => ({ eq: async () => { if (failState) return { error: { message: 'DB unavailable' } }; persisted.push(values); return { error: null }; } })
  }) };
  const fetch = async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('get_order_list')) {
      page++;
      assert.equal(parsed.searchParams.get('time_range_field'), 'create_time');
      return { ok: true, json: async () => ({ response: { order_list: Array.from({length:50},(_,i)=>({ order_sn: `${page}-${i}` })), more: true, next_cursor: `cursor-${page}` } }) };
    }
    if (parsed.pathname.endsWith('get_order_detail')) {
      if (page === failDetail) return { ok: false, json: async () => ({ error: 'test_failure', message: 'Detail unavailable' }) };
      return { ok: true, json: async () => ({ response: { order_list: parsed.searchParams.get('order_sn_list').split(',').map(order_sn=>({ order_sn, order_status: 'COMPLETED', item_list: [] })) } }) };
    }
    throw new Error('Unexpected endpoint');
  };
  return { db, fetch, persisted, orders };
}
const state = { requested_from: '2026-08-01T03:00:00Z', next_to: '2026-10-14T03:00:00Z', cursor: '', records_processed: 100 };
const shop = { shop_id: 1, partner_id: 2 };
test('bounded order recovery saves each page and resumes the same day after the cap', async () => {
  const f=fixture(), rt=runtime('shopee-sync',{fetch:f.fetch});
  const result=await rt.testFns.syncShop(f.db,shop,new Map([[2,'test-key']]),45,state);
  assert.equal(result.capped,true);
  assert.equal(f.orders.length,200);
  assert.equal(f.persisted.length,4);
  assert.equal(f.persisted.at(-1).cursor,'cursor-4');
  assert.equal(f.persisted.at(-1).next_to,'2026-10-14T03:00:00.000Z');
  assert.equal(f.persisted.at(-1).records_processed,300);
});
test('failure fetching a page never advances its durable cursor', async () => {
  const f=fixture({failDetail:2}), rt=runtime('shopee-sync',{fetch:f.fetch});
  await assert.rejects(rt.testFns.syncShop(f.db,shop,new Map([[2,'test-key']]),45,state),/Detail unavailable/);
  assert.equal(f.persisted.length,1);
  assert.equal(f.persisted[0].cursor,'cursor-1');
});
test('failure persisting the cursor fails the batch for idempotent replay', async () => {
  const f=fixture({failState:true}), rt=runtime('shopee-sync',{fetch:f.fetch});
  await assert.rejects(rt.testFns.syncShop(f.db,shop,new Map([[2,'test-key']]),45,state),/DB unavailable/);
  assert.equal(f.persisted.length,0);
});
test('missing sync secret rejects requests before accessing the database', async () => {
  for (const name of ['shopee-sync','shopee-sync-sbs']) {
    const rt=runtime(name);
    assert.equal((await rt.handler(new Request('https://example.test',{method:'POST'}))).status,401);
  }
});
test('an empty inventory response preserves the last known position', async () => {
  const f=fixture(), rt=runtime('shopee-sync-sbs',{fetch:async()=>({ok:true,json:async()=>({response:{item_list:[]}})})});
  const result=await rt.testFns.syncShopSbs(f.db,shop,'test-key');
  assert.equal(result.deferred,true);
  assert.equal(f.persisted.length,0);
});
test('a malformed inventory response fails without replacement', async () => {
  const f=fixture(), rt=runtime('shopee-sync-sbs',{fetch:async()=>({ok:true,json:async()=>({response:{}})})});
  await assert.rejects(rt.testFns.syncShopSbs(f.db,shop,'test-key'),/sem item_list/);
  assert.equal(f.persisted.length,0);
});
test('the SBS warehouse identity differs from the marketplace item and is persisted with its mapping', async () => {
  const f = fixture();
  let replaced = null;
  f.db.rpc = async (name, params) => { assert.equal(name, 'replace_shopee_sbs_inventory'); replaced = params; return { error: null }; };
  const rt = runtime('shopee-sync-sbs', { fetch: async () => ({ ok: true, json: async () => ({ response: {
    item_list: [{ warehouse_item_id: 'warehouse-20', sku_list: [{ model_id: 'warehouse-model',
      shop_sku_list: [{ shop_item_id: 'listing-10', shop_model_id: 'listing-model' }],
      whs_list: [{ whs_id: 'BRFGO1', sellable_qty: 12 }] }] }]
  } }) }) });
  const result = await rt.testFns.syncShopSbs(f.db, shop, 'test-key');
  assert.equal(result.deferred, false);
  assert.equal(replaced.p_rows[0].id, '1-BRFGO1-warehouse-20-warehouse-model');
  assert.equal(replaced.p_rows[0].item_id, 'warehouse-20');
  assert.equal(replaced.p_rows[0].shop_item_id, 'listing-10');
  assert.equal(replaced.p_rows[0].shop_model_id, 'listing-model');
  assert.equal(replaced.p_rows[0].sellable_qty, 12);
});
test('a nonempty inventory lacking warehouse identity cannot replace a valid position', async () => {
  const f = fixture();
  f.db.rpc = async () => { assert.fail('Invalid inventory replaced the current position'); };
  const rt = runtime('shopee-sync-sbs', { fetch: async () => ({ ok: true, json: async () => ({ response: {
    item_list: [{ sku_list: [{ whs_list: [{ whs_id: 'BRFGO1', sellable_qty: 12 }] }] }]
  } }) }) });
  await assert.rejects(rt.testFns.syncShopSbs(f.db, shop, 'test-key'), /warehouse_item_id/);
});
