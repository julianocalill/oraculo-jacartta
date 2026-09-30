import type { Metadata } from 'next';
import { requireTabAccess } from '../../../lib/auth/access';
import { loadActionableAlertCount } from '../../../lib/alert-count';
import { getSaoPauloToday } from '../../../lib/date';
import { AppShell } from '../../components/app-shell';
import { NoAccess } from '../../components/no-access';
import { OperationLink as Link } from '../../components/operation-provider';
import { AdsPrintAnalyzer } from './print-analyzer';

export const metadata: Metadata = { title: 'Analisar print · Shopee Ads' };

export default async function AdsPrintPage() {
  const { allowed } = await requireTabAccess('ads');
  if (!allowed) return <NoAccess tab="ads" />;
  return <AppShell alertCount={await loadActionableAlertCount()}>
    <header className="topbar"><div><p className="eyebrow">Comercial · Shopee Ads</p><h1>Analisar print</h1><p>Envie a tela de performance de um anúncio, confira a leitura e receba sugestões.</p></div><Link className="pill" href="/ads">← Voltar para Ads</Link></header>
    <AdsPrintAnalyzer today={getSaoPauloToday()} />
  </AppShell>;
}
