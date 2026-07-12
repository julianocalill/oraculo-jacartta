import type { ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";
import { BrandMark } from "./brand-mark";

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
          <BrandMark />
          <div>
            <strong>Oráculo</strong>
            <small>BI multicanal</small>
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
