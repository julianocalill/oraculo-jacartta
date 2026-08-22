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

// Setor do menu lateral: cada um vira um acordeão (details/summary) na
// sidebar. Aba `main` sem setor fica solta, sempre visível (Agenda,
// Parâmetros). `group` continua mandando no acesso e em /usuarios — setor é
// só organização visual.
export type TabSector = "analitico" | "comercial" | "operacoes";

export const SECTORS: ReadonlyArray<{ key: TabSector; label: string }> = [
  { key: "analitico", label: "Analítico" },
  { key: "comercial", label: "Comercial" },
  { key: "operacoes", label: "Operações" }
];

export type TabDefinition = {
  key: string;
  label: string;
  href: string;
  group: TabGroup;
  paths: string[];
  sector?: TabSector;
};

export const TABS = [
  { key: "analytics", label: "Analytics", href: "/", group: "main", paths: ["/", "/export-fiscal"], sector: "analitico" },
  { key: "pedidos", label: "Pedidos", href: "/pedidos", group: "main", paths: ["/pedidos"], sector: "comercial" },
  { key: "mais-vendidos", label: "Mais Vendidos", href: "/mais-vendidos", group: "main", paths: ["/mais-vendidos"], sector: "analitico" },
  { key: "skus", label: "SKUs", href: "/skus", group: "main", paths: ["/skus"], sector: "analitico" },
  { key: "curva-de-venda", label: "Curva de Venda", href: "/curva-de-venda", group: "main", paths: ["/curva-de-venda"], sector: "analitico" },
  { key: "curva-de-estoque", label: "Curva de Estoque", href: "/curva-de-estoque", group: "main", paths: ["/curva-de-estoque"], sector: "analitico" },
  { key: "previsao-de-vendas", label: "Previsão de Vendas", href: "/previsao-de-vendas", group: "main", paths: ["/previsao-de-vendas"], sector: "analitico" },
  { key: "shopee", label: "Shopee", href: "/shopee", group: "main", paths: ["/shopee"], sector: "comercial" },
  { key: "mercado-livre", label: "Mercado Livre", href: "/mercado-livre", group: "main", paths: ["/mercado-livre"], sector: "comercial" },
  { key: "expedicao", label: "Expedição", href: "/expedicao", group: "main", paths: ["/expedicao"], sector: "operacoes" },
  { key: "devolucoes", label: "Devoluções", href: "/devolucoes", group: "main", paths: ["/devolucoes"], sector: "operacoes" },
  { key: "importacoes", label: "Importações", href: "/importacoes", group: "main", paths: ["/importacoes"], sector: "operacoes" },
  { key: "logistica", label: "Logística", href: "/logistica", group: "main", paths: ["/logistica"], sector: "operacoes" },
  { key: "calculadora", label: "Calculadora", href: "/calculadora", group: "main", paths: ["/calculadora"], sector: "comercial" },
  // Guarda CPF/endereço de centenas de afiliados: por ser opt-in por usuário,
  // a aba nasce invisível para todo mundo até ser liberada em /usuarios.
  { key: "rpa", label: "RPA Afiliados", href: "/rpa", group: "main", paths: ["/rpa"], sector: "comercial" },
  // Mapa do banco (nomes de tabela, colunas e descrições — nunca dados) mais as
  // instruções de conexão direta ao Postgres para Metabase/PowerBI. Nasce
  // invisível como /rpa: liberada em /usuarios para quem escreve query.
  { key: "documentacao", label: "Documentação", href: "/documentacao", group: "main", paths: ["/documentacao"], sector: "analitico" },
  { key: "agenda", label: "Agenda", href: "/agenda", group: "main", paths: ["/agenda"] },
  { key: "alertas", label: "Alertas", href: "/alertas", group: "main", paths: ["/alertas"], sector: "operacoes" },
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
