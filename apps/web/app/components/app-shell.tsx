import type { ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";

// Shell padrão das páginas autenticadas: sidebar fixa + área de trabalho.
// O destaque do link ativo é resolvido no cliente via usePathname (SidebarNav).
export function AppShell({
  children,
  footer,
  alertCount
}: {
  children: ReactNode;
  footer?: ReactNode;
  alertCount?: number;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">O</span>
          <div>
            <strong>Oraculo</strong>
            <small>Multi-channel BI</small>
          </div>
        </div>

        <SidebarNav alertCount={alertCount} />

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
