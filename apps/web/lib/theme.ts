// Constantes do tema compartilhadas entre cliente (toggle) e servidor
// (leitura do cookie em lib/theme-server.ts). Sem imports de next/headers aqui.
export type Theme = "dark" | "light";

export const THEME_COOKIE = "oraculo-theme";
