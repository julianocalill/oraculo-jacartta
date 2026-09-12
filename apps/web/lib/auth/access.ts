import { redirect } from "next/navigation";
import { operationIsReady } from "../operation-status";
import { getRequestOperation } from "../operation-context";
import { tabForPath } from "./path-tabs";
export { tabForPath } from "./path-tabs";
// Controle de acesso por aba.
//
// Não existem perfis nomeados: cada usuário carrega em `app_metadata.tabs` a
// lista de abas que pode abrir (as caixinhas marcadas em /usuarios). Dois
// emails são administradores fixos — enxergam todas as abas e são os únicos
// que editam os acessos dos outros.
//
// A verificação roda sempre no servidor, em cima do usuário devolvido por
// `getCurrentUser()` (JWT validado pelo PostgREST e identidade lida ao vivo). O
// middleware continua cuidando apenas de "logado ou não".

import { readEnvValue, requireCurrentUser } from "./session";
import { ALL_TAB_KEYS, TABS, isAdminOnlyTab, isTabKey, tabByKey, type TabKey } from "./tabs";

const DEFAULT_MASTER_EMAILS = ["juliano@oliverhome.com.br", "oliveiros_cardoso@hotmail.com"];

type MaybeUser = {
  id?: string;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
  oraculo_operation_allowed?: boolean;
  oraculo_operation?: string;
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

/** Gestor operacional do módulo Full na operação projetada no request. */
export function isFullManager(user: MaybeUser) {
  if (user?.oraculo_operation && user.oraculo_operation !== "uberlandia") return false;
  return isMaster(user) || user?.app_metadata?.full_manager === true;
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
  if (!user || user.oraculo_operation_allowed === false) return [];

  if (isMaster(user)) {
    const override = devTabsOverride();
    return override ?? [...ALL_TAB_KEYS];
  }

  const raw = user.app_metadata?.tabs;
  const restrictedRaw = user.app_metadata?.restricted_tabs;
  if (!Array.isArray(raw) && !Array.isArray(restrictedRaw)) return [];

  const granted = new Set(Array.isArray(raw) ? raw.filter(isTabKey) : []);
  const restrictedGranted = new Set(
    Array.isArray(restrictedRaw) ? restrictedRaw.filter(isTabKey) : []
  );
  // Mantém a ordem canônica do menu, não a ordem gravada no metadata.
  // Chaves adminOnly antigas gravadas em `tabs` continuam sem efeito. Uma aba
  // restrita só é liberada pelo campo separado `restricted_tabs`, evitando que
  // o backfill histórico reabra Parâmetros para todos de uma vez.
  return ALL_TAB_KEYS.filter((key) =>
    isAdminOnlyTab(key) ? restrictedGranted.has(key) : granted.has(key)
  );
}

export function canAccess(user: MaybeUser, tab: TabKey) {
  if (tab === "full" && user?.oraculo_operation && user.oraculo_operation !== "uberlandia") return false;
  return allowedTabs(user).includes(tab);
}

/** Route handlers must reject a disabled operation before building an export. */
export async function canAccessRequest(user: MaybeUser, tab: TabKey) {
  if (!canAccess(user, tab)) return false;
  return operationIsReady(await getRequestOperation());
}

export function firstAllowedHref(user: MaybeUser) {
  const [first] = allowedTabs(user);
  return first ? tabByKey(first)?.href ?? null : null;
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
  if (user.oraculo_operation_allowed && !(await operationIsReady(await getRequestOperation()))) redirect("/operacoes/giracasa");
  return { user, allowed: canAccess(user, tab) };
}

export async function requireMaster() {
  const user = await requireCurrentUser();
  if (user.oraculo_operation_allowed && !(await operationIsReady(await getRequestOperation()))) redirect("/operacoes/giracasa");
  return { user, allowed: isMaster(user) && user.oraculo_operation_allowed };
}

/**
 * Versão para Server Actions: sem tela para renderizar, lança em vez de
 * devolver flag. O gate de renderização não basta — um POST direto na action
 * chega sem passar pela página.
 */
export async function assertTabAccess(tab: TabKey) {
  const user = await requireCurrentUser();
  if (!canAccess(user, tab) || !(await operationIsReady(await getRequestOperation()))) {
    throw new Error(`Sem permissão para a aba ${tabByKey(tab)?.label ?? tab}.`);
  }
  return user;
}

export async function assertMaster() {
  const user = await requireCurrentUser();
  if (!isMaster(user) || !user.oraculo_operation_allowed || !(await operationIsReady(await getRequestOperation()))) {
    throw new Error("Apenas administradores podem alterar acessos.");
  }
  return user;
}
