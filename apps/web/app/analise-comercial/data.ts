import { createSupabaseUserClient } from '../../lib/supabase/user';
import { commercialMargin } from '@oraculo/domain/commercial-analysis.js';

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

export function filterCommercialProducts(products: CommercialProduct[], query: string) {
  const needle = query.trim().toLocaleLowerCase('pt-BR');
  return products.filter((row) => `${row.sku} ${row.product_name ?? ''}`.toLocaleLowerCase('pt-BR').includes(needle));
}

export function commercialProductStatus(row: CommercialProduct) {
  const costPending = row.missing_cost_lines > 0;
  const feePending = row.missing_fee_lines > 0;
  const margin = commercialMargin(row);
  return costPending && feePending ? 'Custo e comissão pendentes'
    : costPending ? 'Custo pendente'
    : feePending ? 'Comissão pendente'
    : margin === null ? 'Sem base de margem'
    : margin < 0 ? 'Margem negativa'
    : 'Margem calculada';
}

export async function loadCommercialAnalysis(start: string, end: string, channel?: string, client?: Awaited<ReturnType<typeof createSupabaseUserClient>>): Promise<CommercialData> {
  const supabase = client ?? await createSupabaseUserClient();
  const { data, error } = await supabase.rpc('oraculo_commercial_analysis', {
    p_start: start, p_end: end, p_channel: channel || null
  });
  if (error) throw error;
  if (!data || !Array.isArray(data.products) || !Array.isArray(data.daily)) {
    throw new Error('Resposta inválida da análise comercial');
  }
  return data as CommercialData;
}
