import { operationById, userOperations } from "@oraculo/domain/operations.js";
import { getRequestOperation } from "../../lib/operation-context";
import { OperationLink } from "./operation-provider";
import type { ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";
import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";
import { SidebarCollapse } from "./sidebar-collapse";
import { DrawerBackdrop, DrawerOpenButton } from "./sidebar-drawer";
import { logout } from "../../lib/auth/logout-action";
import { readTheme } from "../../lib/theme-server";
import type { Theme } from "../../lib/theme";
import { getCurrentUser, getLoginEventMarker } from "../../lib/auth/session";
import { allowedTabs } from "../../lib/auth/access";
import { loadAgendaPendingCount } from "../../lib/agenda-count";
import { effectiveUserId } from "../../lib/users";
import { getActiveReleaseNotes } from "../../lib/release-notes";
import { ReleaseNotesPopup } from "./release-notes-popup";

// Casca visual compartilhada. Fica separada do AppShell porque o skeleton
// (app/loading.tsx) não pode ser async — fallback de Suspense é sempre síncrono.
function Frame({
  nav,
  children,
  footer,
  profile,
  theme
}: {
  nav: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  profile?: { name: string; detail: string };
  theme: Theme;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar" id="oraculo-menu">
        <div className="brand">
          <BrandMark />
          <div className="nav-label">
            <strong>Oráculo</strong>
            <small>BI multicanal</small>
          </div>
          <SidebarCollapse />
        </div>

        <div className="sidebar-scroll">{nav}</div>

        <div className="sidebar-bottom">
          <ThemeToggle initial={theme} />

          <div className="sidebar-footer">
            {footer ?? (
              <>
                <span className="sync-dot">•••••</span>
                <small>Grupo Jacartta</small>
                <strong>BI multicanal</strong>
              </>
            )}
          </div>

          {profile ? (
            <div className="sidebar-profile" title={`${profile.name} · ${profile.detail}`}>
              <span className="sidebar-avatar" aria-hidden="true">{initials(profile.name)}</span>
              <div className="nav-label">
                <strong>{profile.name}</strong>
                <small>{profile.detail}</small>
              </div>
              <form action={logout} className="sidebar-logout">
                <button type="submit" aria-label="Sair" title="Sair">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                  </svg>
                  <span className="nav-label">Sair</span>
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </aside>
      <DrawerBackdrop />
      {/* Só aparece até 1024px: barra do topo que abre o menu em gaveta. Vem
          depois da sidebar no DOM de propósito: o BrandMark usa um id fixo de
          gradiente e a cópia visível precisa ser a primeira; o grid a põe no topo. */}
      <header className="mobile-topbar">
        <BrandMark size={34} />
        <div className="brand-text">
          <strong>Oráculo</strong>
          <small>{profile?.detail ?? "BI multicanal"}</small>
        </div>
        <DrawerOpenButton />
      </header>

      <main className="workspace">{children}</main>
    </div>
  );
}

function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
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
  const operation = operationById(await getRequestOperation())!;
  const operations = userOperations(user);

  // O badge da Agenda é por usuário, então é o próprio shell que o carrega —
  // as páginas continuam passando só o alertCount (global) que já recebiam.
  const agendaCount =
    user && tabs.includes("agenda")
      ? await loadAgendaPendingCount(effectiveUserId(user))
      : undefined;

  const [theme, loginMarker] = await Promise.all([
    readTheme(),
    getLoginEventMarker()
  ]);
  const activeReleases = loginMarker ? getActiveReleaseNotes() : [];

  return (
    <>
      <Frame
        nav={<>
          <div className="operation-switcher">
            <strong>{operation.label}</strong>
            {operations.length > 1 && <OperationLink href="/operacoes?trocar=1">Trocar operação</OperationLink>}
          </div>
          <SidebarNav badges={{ "/alertas": alertCount, "/agenda": agendaCount }} tabs={tabs} />
        </>}
        footer={footer}
        profile={user ? {
          name: String(user.user_metadata?.full_name || user.email || "Usuário"),
          detail: operation.label
        } : undefined}
        theme={theme}
      >
        {children}
      </Frame>
      {loginMarker && activeReleases.length > 0 && (
        <ReleaseNotesPopup releases={activeReleases} loginMarker={loginMarker} />
      )}
    </>
  );
}

// Usado só pelo loading.tsx: mesma casca, sem consultar a sessão.
// Renderiza o próprio SidebarNav sem abas — mesma forma de árvore do AppShell,
// para o React trocar o fallback pelo conteúdo sem deixar nó órfão na sidebar.
export function AppShellSkeleton({ children }: { children: ReactNode }) {
  return <Frame nav={<SidebarNav tabs={[]} />} theme="dark">{children}</Frame>;
}
