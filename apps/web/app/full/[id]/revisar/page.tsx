import { notFound } from "next/navigation";
import { loadActionableAlertCount } from "../../../../lib/alert-count";
import { isFullManager, requireTabAccess } from "../../../../lib/auth/access";
import { effectiveUserId, listOraculoUsersForTab } from "../../../../lib/users";
import { AppShell } from "../../../components/app-shell";
import { NoAccess } from "../../../components/no-access";
import { OperationLink as Link } from "../../../components/operation-provider";
import { loadFullCreationCatalog, loadFullDetail } from "../../data";
import { FullBuilder } from "../../full-builder";
import { fullCode } from "../../labels";

export const dynamic = "force-dynamic";

export default async function ReviseFullPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ allowed, user }, alertCount, route] = await Promise.all([requireTabAccess("full"), loadActionableAlertCount(), params]);
  if (!allowed) return <NoAccess tab="full" />;
  const [full, catalog, users] = await Promise.all([loadFullDetail(route.id), loadFullCreationCatalog(), listOraculoUsersForTab("full")]);
  if (!full) notFound();
  if (full.creator_user_id !== effectiveUserId(user) && !isFullManager(user)) return <NoAccess tab="full" />;
  if (["concluido", "cancelado"].includes(full.workflow_status)) notFound();

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar"><div><p className="eyebrow">{fullCode(full.number)}</p><h1>Nova revisão</h1><p>Itens, quantidades ou vínculo físico alterados reabrem as aprovações. O histórico anterior permanece intacto.</p></div><Link href={`/full/${full.id}`} className="button-secondary">Voltar</Link></header>
      <FullBuilder
        {...catalog}
        users={users}
        initial={{
          fullId: full.id,
          channel: full.channel,
          storeKey: full.store_key,
          logisticsUserId: full.logistics_user_id,
          approverUserId: full.approver_user_id,
          rows: full.items.map((item) => ({ commercialKey: item.channel_item_key, physicalProductId: item.selected_olist_product_id, quantity: item.requested_qty }))
        }}
      />
    </AppShell>
  );
}
