"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MAIN_LINKS = [
  { href: "/", label: "Analytics" },
  { href: "/pedidos", label: "Pedidos" },
  { href: "/skus", label: "SKUs" },
  { href: "/curva-de-venda", label: "Curva de Venda" },
  { href: "/curva-de-estoque", label: "Curva de Estoque" },
  { href: "/shopee", label: "Take Rate Shopee" },
  { href: "/mercado-livre", label: "Mercado Livre Full" },
  { href: "/importacoes", label: "Importações" },
  { href: "/calculadora", label: "Calculadora" },
  { href: "/alertas", label: "Alertas" },
  { href: "/parametros", label: "Parâmetros" }
];

const ADMIN_LINKS = [
  { href: "/usuarios", label: "Usuários" },
  { href: "/status", label: "Status sync" }
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ alertCount }: { alertCount?: number }) {
  const pathname = usePathname() ?? "/";

  return (
    <>
      <nav className="nav-group" aria-label="Principal">
        <span>Principal</span>
        {MAIN_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={isActive(pathname, link.href) ? "nav-active" : undefined}
            aria-current={isActive(pathname, link.href) ? "page" : undefined}
          >
            {link.label}
            {link.href === "/alertas" && alertCount != null && alertCount > 0 ? (
              <b>{alertCount}</b>
            ) : null}
          </Link>
        ))}
      </nav>

      <nav className="nav-group nav-admin" aria-label="Admin">
        <span>Admin</span>
        {ADMIN_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={isActive(pathname, link.href) ? "nav-active" : undefined}
            aria-current={isActive(pathname, link.href) ? "page" : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
