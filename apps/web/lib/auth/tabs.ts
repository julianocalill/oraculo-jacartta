// Registro central das abas do Oráculo.
//
// É a fonte única da verdade para três coisas que antes viviam separadas:
// o menu lateral (sidebar-nav), o gate de acesso de cada página e a matriz de
// caixinhas em /usuarios. Adicionar uma aba nova é editar este array.
//
// `paths` lista os prefixos de rota que a aba governa — sub-rotas e route
// handlers de export herdam a permissão da aba-mãe (ex.: /shopee cobre
// /shopee/estoque e /shopee/reposicao/export).

export type TabGroup = "main" | "admin";

export type TabDefinition = {
  key: string;
  label: string;
  href: string;
  group: TabGroup;
  paths: string[];
};

export const TABS = [
  { key: "analytics", label: "Analytics", href: "/", group: "main", paths: ["/", "/export-fiscal"] },
  { key: "pedidos", label: "Pedidos", href: "/pedidos", group: "main", paths: ["/pedidos"] },
  { key: "mais-vendidos", label: "Mais Vendidos", href: "/mais-vendidos", group: "main", paths: ["/mais-vendidos"] },
  { key: "skus", label: "SKUs", href: "/skus", group: "main", paths: ["/skus"] },
  { key: "curva-de-venda", label: "Curva de Venda", href: "/curva-de-venda", group: "main", paths: ["/curva-de-venda"] },
  { key: "curva-de-estoque", label: "Curva de Estoque", href: "/curva-de-estoque", group: "main", paths: ["/curva-de-estoque"] },
  { key: "shopee", label: "Shopee", href: "/shopee", group: "main", paths: ["/shopee"] },
  { key: "mercado-livre", label: "Mercado Livre", href: "/mercado-livre", group: "main", paths: ["/mercado-livre"] },
  { key: "expedicao", label: "Expedição", href: "/expedicao", group: "main", paths: ["/expedicao"] },
  { key: "devolucoes", label: "Devoluções", href: "/devolucoes", group: "main", paths: ["/devolucoes"] },
  { key: "importacoes", label: "Importações", href: "/importacoes", group: "main", paths: ["/importacoes"] },
  { key: "calculadora", label: "Calculadora", href: "/calculadora", group: "main", paths: ["/calculadora"] },
  { key: "agenda", label: "Agenda", href: "/agenda", group: "main", paths: ["/agenda"] },
  { key: "alertas", label: "Alertas", href: "/alertas", group: "main", paths: ["/alertas"] },
  { key: "parametros", label: "Parâmetros", href: "/parametros", group: "main", paths: ["/parametros"] },
  { key: "usuarios", label: "Usuários", href: "/usuarios", group: "admin", paths: ["/usuarios"] },
  { key: "status", label: "Status sync", href: "/status", group: "admin", paths: ["/status"] }
] as const satisfies readonly TabDefinition[];

export type TabKey = (typeof TABS)[number]["key"];

export const ALL_TAB_KEYS = TABS.map((tab) => tab.key) as TabKey[];

export const MAIN_TAB_KEYS = TABS.filter((tab) => tab.group === "main").map((tab) => tab.key) as TabKey[];

export const ADMIN_TAB_KEYS = TABS.filter((tab) => tab.group === "admin").map((tab) => tab.key) as TabKey[];

export function isTabKey(value: unknown): value is TabKey {
  return typeof value === "string" && (ALL_TAB_KEYS as string[]).includes(value);
}

export function tabByKey(key: TabKey) {
  return TABS.find((tab) => tab.key === key) ?? null;
}

export function tabLabel(key: TabKey) {
  return tabByKey(key)?.label ?? key;
}
