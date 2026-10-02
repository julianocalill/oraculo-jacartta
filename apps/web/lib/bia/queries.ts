import 'server-only';
import { resolveBiaChannels } from '@oraculo/domain/bia.js';
import { loadCommercialAnalysis, type CommercialData, type CommercialProduct } from '../../app/analise-comercial/data';
import { createBiaReadClient } from './read-client';
import type { BiaPlan } from './types';

function mergeCommercialData(parts: CommercialData[], catalogue: CommercialData): CommercialData {
  const products = new Map<string, CommercialProduct>();
  const daily = new Map<string, { day: string; invoices: number; revenue: number }>();
  const sums = ['units', 'revenue', 'cost', 'taxes', 'fees', 'covered_revenue', 'covered_profit', 'missing_cost_lines', 'missing_fee_lines'] as const;
  for (const part of parts) {
    for (const row of part.products) {
      const previous = products.get(row.sku);
      if (!previous) products.set(row.sku, { ...row });
      else for (const key of sums) previous[key] = Number(previous[key]) + Number(row[key]);
    }
    for (const row of part.daily) {
      const previous = daily.get(row.day) ?? { day: row.day, invoices: 0, revenue: 0 };
      previous.invoices += Number(row.invoices);
      previous.revenue += Number(row.revenue);
      daily.set(row.day, previous);
    }
  }
  return { ...catalogue, products: [...products.values()], daily: [...daily.values()] };
}

export async function queryBia(plan: BiaPlan, signal: AbortSignal) {
  const client = await createBiaReadClient(signal);
  // Same builder as the screen, with a strictly read-only, JWT-scoped client.
  const current = await loadCommercialAnalysis(plan.start, plan.end, undefined, client);
  const previous = plan.compareStart && plan.compareEnd
    ? await loadCommercialAnalysis(plan.compareStart, plan.compareEnd, undefined, client) : null;
  if (!plan.channel) return { current, previous, channels: [] as string[] };
  const channels = resolveBiaChannels(plan.channel, [...new Set([...current.channels, ...(previous?.channels ?? [])])]) as string[];
  if (!channels.length) return { message: `Não encontrei “${plan.channel}” no período consultado. Canais disponíveis: ${current.channels.join(', ') || 'nenhum canal carregado'}. Não substituí o filtro por todas as lojas.` };
  if (channels.length > 8) return { message: 'Esse filtro reúne mais de oito lojas. Escolha uma loja específica ou consulte todas as lojas.' };
  const selected: CommercialData[] = [];
  const selectedPrevious: CommercialData[] = [];
  // Bounded and sequential: protects the shared database from fan-out.
  for (const channel of channels) {
    selected.push(await loadCommercialAnalysis(plan.start, plan.end, channel, client));
    if (plan.compareStart && plan.compareEnd) selectedPrevious.push(await loadCommercialAnalysis(plan.compareStart, plan.compareEnd, channel, client));
  }
  return { current: mergeCommercialData(selected, current), previous: previous ? mergeCommercialData(selectedPrevious, previous) : null, channels };
}
