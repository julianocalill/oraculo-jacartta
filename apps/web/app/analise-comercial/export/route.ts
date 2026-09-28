import { commercialMargin, commercialPeriod } from '@oraculo/domain/commercial-analysis.js';
import { canAccessRequest } from '../../../lib/auth/access';
import { getCurrentUser } from '../../../lib/auth/session';
import { getSaoPauloToday } from '../../../lib/date';
import { commercialProductStatus, filterCommercialProducts, loadCommercialAnalysis } from '../data';

function csvCell(value: string | number | null | undefined) {
  let text = String(value ?? '');
  // Excel interpreta fórmulas mesmo dentro de campos CSV entre aspas.
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvNumber(value: number, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(number)
    : '';
}

function csvPercent(value: number | null) {
  return value === null ? '' : `${csvNumber(value * 100, 1)}%`;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response('Não autenticado', { status: 401 });
  if (!(await canAccessRequest(user, 'analise-comercial'))) {
    return new Response('Sem acesso a esta aba', { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const period = commercialPeriod(params.get('start'), params.get('end'), getSaoPauloToday());
  if (period.error || !period.start || !period.end) {
    return new Response(period.error ?? 'Período inválido', { status: 400 });
  }

  const channel = params.get('canal') || undefined;
  const query = params.get('q') ?? '';
  let products;
  try {
    const data = await loadCommercialAnalysis(period.start, period.end, channel);
    products = filterCommercialProducts(data.products, query);
  } catch (error) {
    console.error('Falha ao exportar análise comercial', error);
    return new Response('Não foi possível carregar a análise comercial', { status: 500 });
  }

  const header = [
    'Produto', 'SKU', 'Unidades', 'Receita (R$)', 'Margem (%)', 'Resultado (R$)',
    'Preço médio (R$)', 'Custo líquido (R$)', 'Impostos (R$)', 'Comissão (R$)', 'Situação'
  ];
  const rows = products.map((row) => {
    const margin = commercialMargin(row);
    return [
      row.product_name || (row.sku ? `Produto ${row.sku}` : 'Produto sem SKU'),
      row.sku || 'Sem SKU',
      csvNumber(row.units),
      csvNumber(row.revenue),
      csvPercent(margin),
      margin === null ? '' : csvNumber(row.covered_profit),
      row.units > 0 ? csvNumber(row.revenue / row.units) : '',
      row.missing_cost_lines > 0 ? '' : csvNumber(row.cost),
      csvNumber(row.taxes),
      row.missing_fee_lines > 0 ? '' : csvNumber(row.fees),
      commercialProductStatus(row)
    ].map(csvCell).join(';');
  });
  const csv = `\uFEFF${[header.map(csvCell).join(';'), ...rows].join('\r\n')}\r\n`;
  const channelSuffix = channel
    ? `-${channel.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    : '';
  const searchSuffix = query.trim() ? '-busca' : '';
  const filename = `analise-comercial-${period.start}-a-${period.end}${channelSuffix}${searchSuffix}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store'
    }
  });
}
