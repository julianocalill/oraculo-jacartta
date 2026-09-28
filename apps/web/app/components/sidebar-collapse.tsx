"use client";

import { SIDEBAR_COOKIE } from "../../lib/theme";
import { DRAWER_QUERY, setDrawer } from "./sidebar-drawer";

// Botão redondo na borda da sidebar que alterna expandida ↔ só ícones.
// O estado mora em <html data-sidebar> (o layout já o renderiza a partir do
// cookie), então o CSS anima a coluna do grid sem estado React.
// No celular/tablet o card é gaveta, e o mesmo botão só a fecha.
export function SidebarCollapse() {
  function toggle() {
    if (window.matchMedia(DRAWER_QUERY).matches) {
      setDrawer(false);
      return;
    }
    const root = document.documentElement;
    const next = root.dataset.sidebar === "collapsed" ? "expanded" : "collapsed";
    root.dataset.sidebar = next;
    document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <button type="button" className="sidebar-collapse" onClick={toggle} aria-label="Recolher ou expandir o menu" title="Recolher/expandir menu">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
    </button>
  );
}
