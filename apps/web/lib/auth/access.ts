// Controle de acesso por aba.
//
// Não existem perfis nomeados: cada usuário carrega em `app_metadata.tabs` a
// lista de abas que pode abrir (as caixinhas marcadas em /usuarios). Dois
// emails são administradores fixos — enxergam todas as abas e são os únicos
// que editam os acessos dos outros.
//
// A verificação roda sempre no servidor, em cima do usuário devolvido por
// `getCurrentUser()` (que valida o token via supabase.auth.getUser). O
// middleware continua cuidando apenas de "logado ou não".

import { readEnvValue, requireCurrentUser } from "./session";
import { ALL_TAB_KEYS, TABS, isAdminOnlyTab, isTabKey, tabByKey, type TabKey } from "./tabs";

const DEFAULT_MASTER_EMAILS = ["juliano@oliverhome.com.br", "oliveiros_cardoso@hotmail.com"];

type MaybeUser = {
  id?: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
} | null;

function masterEmails() {
  const override = readEnvValue("ORACULO_ADMIN_EMAILS");
  if (!override) return DEFAULT_MASTER_EMAILS;

  const parsed = override
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);

  return parsed.length > 0 ? parsed : DEFAULT_MASTER_EMAILS;
}

export function isMaster(user: MaybeUser) {
  if (!user) return false;
  // Mock de desenvolvimento (lib/auth/session.ts): sem login local, acesso total.
  if (user.id === "local-dev") return true;

  const email = user.email?.trim().toLowerCase();
  if (!email) return false;
  return masterEmails().includes(email);
}

function devTabsOverride() {
  if (process.env.NODE_ENV === "production") return null;

  const raw = readEnvValue("ORACULO_DEV_TABS");
  if (!raw) return null;

  const parsed = raw
    .split(",")
    .map((key) => key.trim())
    .filter(isTabKey);

  return parsed;
}

export function allowedTabs(user: MaybeUser): TabKey[] {
  if (!user) return [];

  if (isMaster(user)) {
    const override = devTabsOverride();
    return override ?? [...ALL_TAB_KEYS];
  }

  const raw = user.app_metadata?.tabs;
  if (!Array.isArray(raw)) return [];

  const granted = new Set(raw.filter(isTabKey));
  // Mantém a ordem canônica do menu, não a ordem gravada no metadata.
  // Abas adminOnly (ex.: Parâmetros) são exclusivas dos administradores fixos:
  // mesmo gravadas no metadata por engano, não contam para quem não é master.
  return ALL_TAB_KEYS.filter((key) => granted.has(key) && !isAdminOnlyTab(key));
}

export function canAccess(user: MaybeUser, tab: TabKey) {
  return allowedTabs(user).includes(tab);
}

export function firstAllowedHref(user: MaybeUser) {
  const [first] = allowedTabs(user);
  return first ? tabByKey(first)?.href ?? null : null;
}

// Resolve a aba dona de um caminho (sub-rotas e exports herdam a aba-mãe).
export function tabForPath(pathname: string): TabKey | null {
  let match: { key: TabKey; length: number } | null = null;

  for (const tab of TABS) {
    for (const path of tab.paths) {
      const hit = path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
      if (!hit) continue;
      if (!match || path.length > match.length) {
        match = { key: tab.key, length: path.length };
      }
    }
  }

  return match?.key ?? null;
}

export function isAllowedPath(user: MaybeUser, pathname: string) {
  const tab = tabForPath(pathname);
  if (!tab) return false;
  return canAccess(user, tab);
}

/**
 * Garante que existe sessão e informa se a aba está liberada.
 * Sem sessão redireciona para /login; sem permissão devolve `allowed: false`
 * para a página renderizar <NoAccess /> (evita loop de redirect na home).
 */
export async function requireTabAccess(tab: TabKey) {
  const user = await requireCurrentUser();
  return { user, allowed: canAccess(user, tab) };
}

export async function requireMaster() {
  const user = await requireCurrentUser();
  return { user, allowed: isMaster(user) };
}

/**
 * Versão para Server Actions: sem tela para renderizar, lança em vez de
 * devolver flag. O gate de renderização não basta — um POST direto na action
 * chega sem passar pela página.
 */
export async function assertTabAccess(tab: TabKey) {
  const user = await requireCurrentUser();
  if (!canAccess(user, tab)) {
    throw new Error(`Sem permissão para a aba ${tabByKey(tab)?.label ?? tab}.`);
  }
  return user;
}

export async function assertMaster() {
  const user = await requireCurrentUser();
  if (!isMaster(user)) {
    throw new Error("Apenas administradores podem alterar acessos.");
  }
  return user;
}
