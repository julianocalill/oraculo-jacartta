import { redirect } from "next/navigation";
import { requireCurrentUser } from "../../../lib/auth/session";
import { operationGrant } from "@oraculo/domain/operations.js";
import { OperationLink } from "../../components/operation-provider";

export default async function GiracasaPreparationPage() {
  const user = await requireCurrentUser();
  if (!operationGrant(user, "giracasa")) redirect("/operacoes");
  return <main className="login-shell"><section className="login-card">
    <h1>Giracasa — São Paulo</h1>
    <p>A operação está em preparação. As contas próprias, a carga de dados e os cálculos precisam ser validados antes da liberação.</p>
    <p>Seu acesso já está cadastrado. Os dados serão disponibilizados quando a operação for ativada.</p>
    <OperationLink href="/operacoes?trocar=1">Voltar às operações</OperationLink>
  </section></main>;
}
