import { operationById, operationHref, projectOperationUser, userOperations } from "@oraculo/domain/operations.js";
import { getRequestOperation } from "../../lib/operation-context";
import { OperationLink } from "./operation-provider";
import type { ReactNode } from "react";
import { SidebarNav } from "./sidebar-nav";
import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";
import { SidebarCollapse } from "./sidebar-collapse";
import { DrawerBackdrop, DrawerOpenButton } from "./sidebar-drawer";
import { logout } from "../../lib/auth/logout-action";
import { avatarUrl } from "../../lib/auth/avatar";
import { readTheme } from "../../lib/theme-server";
import type { Theme } from "../../lib/theme";
import { getCurrentUser, getLoginEventMarker } from "../../lib/auth/session";
import { allowedTabs, firstAllowedHref } from "../../lib/auth/access";
import { OperationSwitcher, type OperationChoice } from "./operation-switcher";
import { loadAgendaPendingCount } from "../../lib/agenda-count";
import { effectiveUserId } from "../../lib/users";
import { getActiveReleaseNotes } from "../../lib/release-notes";
import { ReleaseNotesPopup } from "./release-notes-popup";
import { biaUserName } from '@oraculo/domain/bia-sources.js';
import { BiaAccess } from "./bia-provider";
import { ollamaConfig } from "../documentacao/ask";

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
  profile?: { name: string; detail: string; avatar: string | null };
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
            <div className="sidebar-profile">
              {/* Nome e foto abrem Minha conta (foto, nome e senha). */}
              <OperationLink href="/conta" className="sidebar-profile-link" title={`Minha conta · ${profile.name}`} prefetch={false}>
                <span className="sidebar-avatar" aria-hidden="true">
                  {profile.avatar ? <img src={profile.avatar} alt="" /> : initials(profile.name)}
                </span>
                <div className="nav-label">
                  <strong>{profile.name}</strong>
                  <small>Minha conta</small>
                </div>
              </OperationLink>
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
  // Cada operação abre na primeira aba liberada ao usuário nela (mesma regra
  // de /operacoes); operação sem aba liberada não aparece no seletor.
  const operationChoices: OperationChoice[] = operations.flatMap((option) => {
    const landing = firstAllowedHref(projectOperationUser(user, option.id));
    return landing ? [{ id: option.id, label: option.label, href: operationHref(landing, option.id) }] : [];
  });

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
          <OperationSwitcher
            current={{ id: operation.id, label: operation.label, href: operationHref("/", operation.id) }}
            options={operationChoices}
          />
          <SidebarNav badges={{ "/alertas": alertCount, "/agenda": agendaCount }} tabs={tabs} />
        </>}
        footer={footer}
        profile={user ? {
          name: String(user.user_metadata?.full_name || user.email || "Usuário"),
          detail: operation.label,
          avatar: avatarUrl(user)
        } : undefined}
        theme={theme}
      >
        {children}
      </Frame>
      <BiaAccess operation={operation.id} userId={user?.id ?? ''} userName={biaUserName(user)} permissions={tabs.join(',')} allowed={Boolean(user && tabs.includes('bia'))} dataAllowed={tabs.includes('bia')} aiConfigured={ollamaConfig().enabled} />
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
