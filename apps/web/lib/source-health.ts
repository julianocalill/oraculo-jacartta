import 'server-only';
import { commercialCoverage, shopeeCollectionReady } from '@oraculo/domain/data-coverage.js';
import { createSupabaseAdminClient } from './supabase/admin';
import { getRequestOperation, type OperationId } from './operation-context';

export async function loadCommercialCoverage(start: string, end: string, client = createSupabaseAdminClient()) {
  const { data, error } = await client.rpc('oraculo_olist_period_coverage', { start_date: start, end_date: end });
  if (error) throw error;
  return commercialCoverage((data ?? [])[0] ?? {});
}

export async function loadShopeeHistory(operation: OperationId, shopId?: string) {
  if (operation !== 'giracasa') return true;
  const admin = createSupabaseAdminClient({ operation });
  let query = admin.from('shopee_order_backfill_state').select('shop_id,completed_at');
  if (shopId && shopId !== 'all') query = query.eq('shop_id', Number(shopId));
  const [{ data, error }, cache, shops] = await Promise.all([
    query,
    admin.from('oraculo_item_recovery_state').select('last_refreshed_at').eq('id', true).maybeSingle(),
    admin.from('shopee_shops').select('shop_id').eq('is_active', true)
  ]);
  if (error) throw error;
  if (cache.error) throw cache.error;
  if (shops.error) throw shops.error;
  const selected = (shops.data ?? []).filter(shop => !shopId || shopId === 'all' || shop.shop_id === Number(shopId));
  return selected.length > 0 && selected.every(shop => {
    const state = data?.find(row => row.shop_id === shop.shop_id);
    return Boolean(state?.completed_at && cache.data?.last_refreshed_at &&
      Date.parse(cache.data.last_refreshed_at) >= Date.parse(state.completed_at));
  });
}

export async function loadShopeeCollection(source: string, shopId?: string) {
  const operation = await getRequestOperation();
  const admin = createSupabaseAdminClient({ operation });
  const shopQuery = admin.from('shopee_shops').select('shop_id,shop_name').eq('is_active', true);
  const { data: shops, error } = await shopQuery;
  if (error) throw error;
  const selected = (shops ?? []).filter(shop => !shopId || shopId === 'all' || shop.shop_id === Number(shopId));
  const historyReady = source === 'shopee-escrow-sync' || source === 'shopee-reconciliation-sync'
    ? await loadShopeeHistory(operation, shopId) : true;
  const runs = await Promise.all(selected.map(async shop => {
    const { data, error } = await admin.from('shopee_sync_runs')
      .select('status,finished_at,error_message,meta')
      .eq('source', `${source}:${shop.shop_id}`).order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    let backlog = false;
    let failedRecords = 0;
    if (source === 'shopee-escrow-sync') {
      const [pending, failed] = await Promise.all([
        admin.rpc('shopee_escrow_pending', {
          p_shop_id: shop.shop_id, p_since: '2026-08-01T03:00:00Z', p_limit: 1
        }),
        admin.from('shopee_order_escrow').select('id', { count: 'exact', head: true })
          .eq('shop_id', shop.shop_id).eq('status', 'error')
      ]);
      if (pending.error) throw pending.error;
      if (failed.error) throw failed.error;
      backlog = (pending.data ?? []).length > 0;
      failedRecords = failed.count ?? 0;
    }
    return { shop, run: data, backlog, failedRecords };
  }));
  const pending = runs.filter(({ run, backlog, failedRecords }) =>
    !shopeeCollectionReady(run, { backlog, historyReady, failedRecords }));
  return {
    shops: shops ?? [], ready: runs.length > 0 && pending.length === 0,
    pending: pending.map(({ shop }) => shop.shop_name ?? String(shop.shop_id))
  };
}
