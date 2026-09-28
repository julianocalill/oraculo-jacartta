// Constantes do tema compartilhadas entre cliente (toggle) e servidor
// (leitura do cookie em lib/theme-server.ts). Sem imports de next/headers aqui.
export type Theme = "dark" | "light";

export const THEME_COOKIE = "oraculo-theme";

// Sidebar recolhida (só ícones). Mesmo mecanismo do tema: cookie lido no
// layout, que já manda <html data-sidebar> certo — sem salto no carregamento.
export type SidebarState = "expanded" | "collapsed";

export const SIDEBAR_COOKIE = "oraculo-sidebar";
