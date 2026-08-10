"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, type TabKey } from "../../lib/auth/tabs";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// `badges` mapeia href da aba → contador exibido ao lado do label (some quando
// zero/undefined). Hoje: /alertas (rupturas, global) e /agenda (tarefas
// pendentes do usuário), ambos montados pelo AppShell.
export function SidebarNav({ badges, tabs }: { badges?: Record<string, number | undefined>; tabs: TabKey[] }) {
  const pathname = usePathname() ?? "/";
  const granted = new Set<string>(tabs);

  const mainLinks = TABS.filter((tab) => tab.group === "main" && granted.has(tab.key));
  const adminLinks = TABS.filter((tab) => tab.group === "admin" && granted.has(tab.key));

  return (
    <>
      {mainLinks.length > 0 ? (
        <nav className="nav-group" aria-label="Principal">
          <span>Principal</span>
          {mainLinks.map((tab) => {
            const badge = badges?.[tab.href];
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={isActive(pathname, tab.href) ? "nav-active" : undefined}
                aria-current={isActive(pathname, tab.href) ? "page" : undefined}
              >
                {tab.label}
                {badge != null && badge > 0 ? <b>{badge}</b> : null}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {adminLinks.length > 0 ? (
        <nav className="nav-group nav-admin" aria-label="Admin">
          <span>Admin</span>
          {adminLinks.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={isActive(pathname, tab.href) ? "nav-active" : undefined}
              aria-current={isActive(pathname, tab.href) ? "page" : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </>
  );
}
