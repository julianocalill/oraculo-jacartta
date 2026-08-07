import type { ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";
import { BrandMark } from "./brand-mark";
import { getCurrentUser } from "../../lib/auth/session";
import { allowedTabs } from "../../lib/auth/access";

// Casca visual compartilhada. Fica separada do AppShell porque o skeleton
// (app/loading.tsx) não pode ser async — fallback de Suspense é sempre síncrono.
function Frame({ nav, children, footer }: { nav: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div>
            <strong>Oráculo</strong>
            <small>BI multicanal</small>
          </div>
        </div>

        {nav}

        <div className="sidebar-footer">
          {footer ?? (
            <>
              <span className="sync-dot">•••••</span>
              <small>Grupo Jacartta</small>
              <strong>BI multicanal</strong>
            </>
          )}
        </div>
      </aside>

      <main className="workspace">{children}</main>
    </div>
  );
}

// Shell padrão das páginas autenticadas: sidebar fixa + área de trabalho.
// A sidebar lista apenas as abas liberadas para o usuário (caixinhas em
// /usuarios); o destaque do link ativo é resolvido no cliente via usePathname.
export async function AppShell({
  children,
  footer,
  alertCount
}: {
  children: ReactNode;
  footer?: ReactNode;
  alertCount?: number;
}) {
  const user = await getCurrentUser();
  const tabs = allowedTabs(user);

  return (
    <Frame nav={<SidebarNav alertCount={alertCount} tabs={tabs} />} footer={footer}>
      {children}
    </Frame>
  );
}

// Usado só pelo loading.tsx: mesma casca, sem consultar a sessão.
// Renderiza o próprio SidebarNav sem abas — mesma forma de árvore do AppShell,
// para o React trocar o fallback pelo conteúdo sem deixar nó órfão na sidebar.
export function AppShellSkeleton({ children }: { children: ReactNode }) {
  return <Frame nav={<SidebarNav tabs={[]} />}>{children}</Frame>;
}
