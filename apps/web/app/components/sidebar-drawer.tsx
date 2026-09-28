"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Gaveta do menu no celular/tablet (≤1024px, ver globals.css "Gaveta").
// O estado mora em <html data-drawer>, como o tema e a sidebar recolhida:
// o CSS faz a animação e nenhum componente precisa re-renderizar.
export const DRAWER_QUERY = "(max-width: 1024px)";

export function setDrawer(open: boolean) {
  document.documentElement.dataset.drawer = open ? "open" : "closed";
}

export function DrawerOpenButton() {
  return (
    <button type="button" className="drawer-open" onClick={() => setDrawer(true)} aria-label="Abrir menu">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}

// Fundo escurecido + fechamento automático: ao trocar de página e no Esc.
export function DrawerBackdrop() {
  const pathname = usePathname();

  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawer(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <button type="button" className="sidebar-backdrop" onClick={() => setDrawer(false)} aria-label="Fechar menu" tabIndex={-1} />;
}
