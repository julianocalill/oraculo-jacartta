import { requireTabAccess } from "../../lib/auth/access";
import { NoAccess } from "../components/no-access";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { PricingCalculator } from "./calculator";

export const dynamic = "force-dynamic";

export default async function CalculadoraPage() {
  const { allowed } = await requireTabAccess("calculadora");
  if (!allowed) return <NoAccess tab="calculadora" />;

  const alertCount = await loadActionableAlertCount();

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Calculadora de Precificação</h1>
          <p>Norte rápido de preço para marketplaces — produto unitário ou kit</p>
        </div>
      </header>

      <PricingCalculator />

      <p className="fiscal-note">
        Regras próprias da calculadora (portada de calculadora.oliverhome.com.br): taxas simplificadas e
        editáveis na tela. <strong>Não usa o motor fiscal do Oráculo</strong> — para margem fiscal real por
        SKU, veja a página SKUs.
      </p>
    </AppShell>
  );
}
