import 'server-only';
import { commercialCoverage } from '@oraculo/domain/data-coverage.js';
import { createSupabaseAdminClient } from './supabase/admin';

export async function loadCommercialCoverage(start: string, end: string, client = createSupabaseAdminClient()) {
  const { data, error } = await client.rpc('oraculo_olist_period_coverage', { start_date: start, end_date: end });
  if (error) throw error;
  return commercialCoverage((data ?? [])[0] ?? {});
}

export async function loadShopeeCollection(source: string, shopId?: string) {
  const admin = createSupabaseAdminClient();
  const shopQuery = admin.from('shopee_shops').select('shop_id,shop_name').eq('is_active', true);
  const { data: shops, error } = await shopQuery;
  if (error) throw error;
  const selected = (shops ?? []).filter(shop => !shopId || shopId === 'all' || shop.shop_id === Number(shopId));
  const runs = await Promise.all(selected.map(async shop => {
    const { data, error } = await admin.from('shopee_sync_runs')
      .select('status,finished_at,error_message,meta')
      .eq('source', `${source}:${shop.shop_id}`).order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    let backlog = false;
    if (source === 'shopee-escrow-sync') {
      const pending = await admin.rpc('shopee_escrow_pending', {
        p_shop_id: shop.shop_id, p_since: '2026-08-01T03:00:00Z', p_limit: 1
      });
      if (pending.error) throw pending.error;
      backlog = (pending.data ?? []).length > 0;
    }
    return { shop, run: data, backlog };
  }));
  const pending = runs.filter(({ run, backlog }) => backlog || !run || run.status !== 'success' ||
    !run.finished_at || Date.now() - Date.parse(run.finished_at) > 30 * 3600000 ||
    run.meta?.capped || run.meta?.deferred || Number(run.meta?.failed ?? 0) > 0);
  return {
    shops: shops ?? [], ready: runs.length > 0 && pending.length === 0,
    pending: pending.map(({ shop }) => shop.shop_name ?? String(shop.shop_id))
  };
}
