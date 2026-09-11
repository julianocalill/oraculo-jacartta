import { createSupabaseUserClient } from '../../lib/supabase/user';
export type AdsMetrics = { expense: number; direct_gmv: number; direct_orders: number; impressions: number; clicks: number; broad_gmv: number };
export type AdsCampaign = { shop_id: number; campaign_id: string; ad_name: string | null; campaign_status: string | null; is_active: boolean; roas_target: number | null; daily_budget: number | null; current: AdsMetrics; previous: AdsMetrics; focus: AdsMetrics; prior: AdsMetrics };
export type AdsDay = { shop_id: number; day: string; metrics: AdsMetrics; rows: number; covered: boolean };
export type AdsData = {
  shops: { shop_id: number; shop_name: string }[];
  campaigns: AdsCampaign[];
  daily: AdsDay[];
  health: { shop_id: number; shop_name: string; last_success: string | null; through_date: string | null; status: string | null }[];
};
export async function loadAds(start: string, end: string, shop?: string): Promise<AdsData> {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase.rpc('oraculo_ads_dashboard', { p_start: start, p_end: end, p_shop_id: shop ? Number(shop) : null });
  if (error) throw error;
  if (!data || !Array.isArray(data.daily) || !Array.isArray(data.campaigns) || !Array.isArray(data.health)) throw new Error('Resposta Ads inválida');
  return data;
}
