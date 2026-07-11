import { requireCurrentUser } from "../../lib/auth/session";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { PricingCalculator } from "./calculator";

export const dynamic = "force-dynamic";

export default async function CalculadoraPage() {
  await requireCurrentUser();
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
