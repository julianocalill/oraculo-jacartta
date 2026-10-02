import { redirect } from 'next/navigation';
import { operationHref } from '@oraculo/domain/operations.js';
import { requireTabAccess, canAccess, firstAllowedHref } from '../../lib/auth/access';
import { loadActionableAlertCount } from '../../lib/alert-count';
import { getRequestOperation } from '../../lib/operation-context';
import { AppShell } from '../components/app-shell';
import { NoAccess } from '../components/no-access';

export const dynamic = 'force-dynamic';

// Old links open the same chat on an authorized business page.
export default async function BiaPage() {
  const { user, allowed } = await requireTabAccess('bia');
  if (!allowed) return <NoAccess tab="bia" />;
  const operation = await getRequestOperation();
  const landing = canAccess(user, 'analise-comercial') ? '/analise-comercial' : firstAllowedHref(user);
  if (landing && landing !== '/bia') redirect(`${operationHref(landing, operation)}?bia=1`);
  return <AppShell alertCount={await loadActionableAlertCount()}>
    <header className="topbar"><div><h1>Sua assistente de dados</h1><p>A B.ia está no canto inferior direito. Converse pelo painel lateral.</p></div></header>
  </AppShell>;
}
