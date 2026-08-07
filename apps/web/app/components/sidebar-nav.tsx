"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS, type TabKey } from "../../lib/auth/tabs";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ alertCount, tabs }: { alertCount?: number; tabs: TabKey[] }) {
  const pathname = usePathname() ?? "/";
  const granted = new Set<string>(tabs);

  const mainLinks = TABS.filter((tab) => tab.group === "main" && granted.has(tab.key));
  const adminLinks = TABS.filter((tab) => tab.group === "admin" && granted.has(tab.key));

  return (
    <>
      {mainLinks.length > 0 ? (
        <nav className="nav-group" aria-label="Principal">
          <span>Principal</span>
          {mainLinks.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={isActive(pathname, tab.href) ? "nav-active" : undefined}
              aria-current={isActive(pathname, tab.href) ? "page" : undefined}
            >
              {tab.label}
              {tab.href === "/alertas" && alertCount != null && alertCount > 0 ? <b>{alertCount}</b> : null}
            </Link>
          ))}
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
