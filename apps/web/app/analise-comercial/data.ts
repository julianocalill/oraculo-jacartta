import { createSupabaseUserClient } from '../../lib/supabase/user';

export type CommercialProduct = {
  sku: string;
  product_name: string | null;
  units: number;
  revenue: number;
  cost: number;
  taxes: number;
  fees: number;
  covered_revenue: number;
  covered_profit: number;
  missing_cost_lines: number;
  missing_fee_lines: number;
};
export type CommercialData = {
  products: CommercialProduct[];
  daily: { day: string; invoices: number; revenue: number }[];
  channels: string[];
  processed_days: number;
  oldest_refresh: string | null;
  latest_refresh: string | null;
  recent_refresh: string | null;
};

export async function loadCommercialAnalysis(start: string, end: string, channel?: string): Promise<CommercialData> {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase.rpc('oraculo_commercial_analysis', {
    p_start: start, p_end: end, p_channel: channel || null
  });
  if (error) throw error;
  if (!data || !Array.isArray(data.products) || !Array.isArray(data.daily)) {
    throw new Error('Resposta inválida da análise comercial');
  }
  return data as CommercialData;
}
