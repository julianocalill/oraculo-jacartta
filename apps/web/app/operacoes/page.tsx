import { redirect } from "next/navigation";
import { userOperations, projectOperationUser, operationHref } from "@oraculo/domain/operations.js";
import { requireCurrentUser } from "../../lib/auth/session";
import { firstAllowedHref } from "../../lib/auth/access";
import { OperationLink } from "../components/operation-provider";
import { BrandMark } from "../components/brand-mark";

export const dynamic = "force-dynamic";

// Primeiro nome para a saudação: full_name do cadastro; sem ele, a parte do
// email antes do @ (ex.: "juliano.calil@..." → "Juliano").
function firstName(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }) {
  const full = String(user.user_metadata?.full_name ?? "").trim();
  const base = full || String(user.email ?? "").split("@")[0].split(/[._-]/)[0];
  const first = base.split(/\s+/)[0] ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

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
      <p className="operation-welcome">{firstName(user) ? `Bem-vindo(a), ${firstName(user)}!` : "Bem-vindo(a)!"}</p>
      <h1>Onde você quer entrar?</h1>
      <p>Escolha a operação para consultar os dados e trabalhar.</p>
      <div className="operation-options">
        {operations.map((operation) => <OperationLink key={operation.id}
          className="panel operation-option" href={operationHref(operation.landing!, operation.id)}>
          <strong>{operation.label}</strong><span>Entrar →</span>
        </OperationLink>)}
      </div>
      {!operations.length && <p>Nenhuma operação com abas liberadas. Solicite acesso ao administrador.</p>}
      <OperationLink href="/login" className="operation-session-link">Gerenciar sessão</OperationLink>
    </section>
  </main>;
}
