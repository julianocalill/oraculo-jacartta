// Ícones do menu lateral — traços no estilo Lucide (24×24, stroke 1.75),
// inline para não puxar biblioteca. Um ícone por aba, chaveado pela `key`
// de lib/auth/tabs.ts; abas sem entrada caem no ícone genérico.

import type { TabKey } from "../../lib/auth/tabs";

const PATHS: Record<string, string> = {
  analytics: "M3 3v18h18M7 14l4-4 4 4 5-6",
  "mais-vendidos": "M6 9H4.5a2.5 2.5 0 0 1 0-5H6m12 5h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22m10-7.34V17c0 .55.47.98.97 1.21C19.15 18.75 20 20.24 20 22M18 2H6v7a6 6 0 0 0 12 0V2Z",
  skus: "M21 8 12 3 3 8v8l9 5 9-5V8ZM3.3 8.3 12 13l8.7-4.7M12 13v9",
  "curva-de-venda": "M3 17l6-6 4 4 8-8M14 7h7v7",
  "curva-de-estoque": "M4 20V10m6 10V4m6 16v-7M2 20h20",
  "previsao-de-vendas": "M3 12a9 9 0 1 0 9-9M3 3v6h6M12 7v5l3 3",
  documentacao: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h8",
  pedidos: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4H6ZM3 6h18M16 10a4 4 0 0 1-8 0",
  shopee: "M5 8h14l-1 12H6L5 8ZM9 8V6a3 3 0 0 1 6 0v2",
  inteligencia: "M3 18h18M5 15l4-4 4 2 6-7M16 6h3v3",
  "mercado-livre": "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM7 12c2-3 8-3 10 0M7 14c2 2 8 2 10 0",
  calculadora: "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8",
  rpa: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  expedicao: "M1 3h15v13H1V3ZM16 8h4l3 3v5h-7V8ZM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  devolucoes: "M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13",
  importacoes: "M2 20a2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1M4 18l-1-5h18l-1 5M6 13V8h12v5M12 4v4",
  logistica: "M3 9h18v11H3V9ZM3 9l2-5h14l2 5M10 13h4",
  alertas: "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01",
  agenda: "M3 5h18v16H3V5ZM16 3v4M8 3v4M3 10h18",
  parametros: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  usuarios: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  status: "M22 12h-4l-3 9L9 3l-3 9H2"
};

const FALLBACK = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z";

export function NavIcon({ tab }: { tab: TabKey | string }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[tab] ?? FALLBACK} />
    </svg>
  );
}
