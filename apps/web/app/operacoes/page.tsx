import { redirect } from "next/navigation";
import { userOperations, projectOperationUser, operationHref } from "@oraculo/domain/operations.js";
import { requireCurrentUser } from "../../lib/auth/session";
import { firstAllowedHref } from "../../lib/auth/access";
import { OperationLink } from "../components/operation-provider";
import { BrandMark } from "../components/brand-mark";

export const dynamic = "force-dynamic";

export default async function OperationsPage({ searchParams }: {
  searchParams?: Promise<{ trocar?: string }>;
}) {
  const user = await requireCurrentUser();
  const operations = userOperations(user).map((operation) => ({
    ...operation,
    landing: firstAllowedHref(projectOperationUser(user, operation.id))
  })).filter((operation) => operation.landing);
  if (operations.length === 1 && !(await searchParams)?.trocar) {
    redirect(operationHref(operations[0].landing!, operations[0].id));
  }
  return <main className="login-shell">
    <section className="login-card operation-picker">
      <BrandMark size={48} />
      <h1>Onde você quer entrar?</h1>
      <p>Escolha a operação para consultar os dados e trabalhar.</p>
      <div className="operation-options">
        {operations.map((operation) => <OperationLink key={operation.id}
          className="panel operation-option" href={operationHref(operation.landing!, operation.id)}>
          <strong>{operation.label}</strong><span>Entrar →</span>
        </OperationLink>)}
      </div>
      {!operations.length && <p>Nenhuma operação com abas liberadas. Solicite acesso ao administrador.</p>}
      <OperationLink href="/login">Gerenciar sessão</OperationLink>
    </section>
  </main>;
}
