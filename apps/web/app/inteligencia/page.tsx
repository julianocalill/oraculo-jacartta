import { requireTabAccess } from "../../lib/auth/access";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { AppShell } from "../components/app-shell";
import { NoAccess } from "../components/no-access";
import { IntelligenceDashboard } from "./intelligence-dashboard";
import { loadIntelligencePayload } from "./data";

export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const [{ allowed }, alertCount, payload] = await Promise.all([
    requireTabAccess("inteligencia"),
    loadActionableAlertCount(),
    loadIntelligencePayload()
  ]);

  if (!allowed) return <NoAccess tab="inteligencia" />;

  return (
    <AppShell alertCount={alertCount}>
      <IntelligenceDashboard payload={payload} />
    </AppShell>
  );
}
