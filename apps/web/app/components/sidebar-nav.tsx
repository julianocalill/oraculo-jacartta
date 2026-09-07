"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SECTORS, TABS, type TabKey } from "../../lib/auth/tabs";
import { NavIcon } from "./nav-icons";

type Tab = (typeof TABS)[number];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// `badges` mapeia href da aba → contador exibido ao lado do label (some quando
// zero/undefined). Hoje: /alertas (rupturas, global) e /agenda (tarefas
// pendentes do usuário), ambos montados pelo AppShell.
//
// Setores (Analítico · Comercial · Operações) são <details name="..."> nativos:
// o `name` compartilhado faz o browser fechar os outros ao abrir um (acordeão
// sem estado React), e `open` vem do pathname — o setor da página atual já
// nasce aberto. Abas sem setor (Agenda, Parâmetros) ficam soltas, sempre
// visíveis; Admin continua como grupo próprio no rodapé.
export function SidebarNav({ badges, tabs }: { badges?: Record<string, number | undefined>; tabs: TabKey[] }) {
  const pathname = usePathname() ?? "/";
  const granted = new Set<string>(tabs);

  const mainLinks = TABS.filter((tab) => tab.group === "main" && granted.has(tab.key));
  const adminLinks = TABS.filter((tab) => tab.group === "admin" && granted.has(tab.key));
  const looseLinks = mainLinks.filter((tab) => !("sector" in tab));
  const sectors = SECTORS
    .map((sector) => ({
      ...sector,
      links: mainLinks.filter((tab) => "sector" in tab && tab.sector === sector.key)
    }))
    .filter((sector) => sector.links.length > 0);

  function renderLink(tab: Tab) {
    const active = isActive(pathname, tab.href);
    const badge = badges?.[tab.href];
    return (
      <Link
        key={tab.href}
        href={tab.href}
        className={active ? "nav-active" : undefined}
        aria-current={active ? "page" : undefined}
      >
        <NavIcon tab={tab.key} />
        {tab.label}
        {badge != null && badge > 0 ? <b>{badge}</b> : null}
      </Link>
    );
  }

  return (
    <>
      {mainLinks.length > 0 ? (
        <nav className="nav-group" aria-label="Principal">
          {sectors.map((sector) => {
            const active = sector.links.some((tab) => isActive(pathname, tab.href));
            const badgeSum = sector.links.reduce((sum, tab) => sum + (badges?.[tab.href] ?? 0), 0);
            return (
              <details
                key={sector.key}
                className={active ? "nav-sector nav-sector-active" : "nav-sector"}
                name="oraculo-setor"
                open={active}
              >
                <summary>
                  {sector.label}
                  {badgeSum > 0 ? <b>{badgeSum}</b> : null}
                </summary>
                <div className="nav-sector-links">{sector.links.map(renderLink)}</div>
              </details>
            );
          })}
          {looseLinks.map(renderLink)}
        </nav>
      ) : null}

      {adminLinks.length > 0 ? (
        <nav className="nav-group nav-admin" aria-label="Admin">
          <span>Admin</span>
          {adminLinks.map(renderLink)}
        </nav>
      ) : null}
    </>
  );
}
