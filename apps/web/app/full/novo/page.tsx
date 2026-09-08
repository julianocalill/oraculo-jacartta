import { requireTabAccess } from "../../../lib/auth/access";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { listOraculoUsers } from "../../../lib/users";
import { AppShell } from "../../components/app-shell";
import { NoAccess } from "../../components/no-access";
import { OperationLink as Link } from "../../components/operation-provider";
import { loadFullCreationCatalog } from "../data";
import { FullBuilder } from "../full-builder";

export const dynamic = "force-dynamic";

export default async function NewFullPage() {
  const [{ allowed }, alertCount] = await Promise.all([requireTabAccess("full"), loadActionableAlertCount()]);
  if (!allowed) return <NoAccess tab="full" />;
  const [catalog, users] = await Promise.all([loadFullCreationCatalog(), listOraculoUsers()]);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div><p className="eyebrow">Operações</p><h1>Novo Full</h1><p>Fotografe o anúncio, confirme o produto físico e crie o rascunho operacional.</p></div>
        <Link href="/full" className="button-secondary">Voltar</Link>
      </header>
      <FullBuilder {...catalog} users={users} />
    </AppShell>
  );
}
