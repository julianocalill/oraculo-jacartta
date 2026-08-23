import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";

const ACCESS_COOKIE = "oraculo_access_token";
const REFRESH_COOKIE = "oraculo_refresh_token";
// Janela dura da sessão: nasce no login com 1h de vida e nunca é renovada.
// O middleware exige este cookie — quando ele expira, o próximo clique cai no
// /login, independente de refresh token. É o "deslogue de hora em hora".
const SESSION_WINDOW_COOKIE = "oraculo_session_window";
const SESSION_WINDOW_SECONDS = 60 * 60;

// O parse do .env da raiz é I/O síncrono no event loop; sem memoização ele
// rodava a cada readEnvValue de var ausente, várias vezes por request.
let fallbackEnvCache: Record<string, string> | null = null;

function readFallbackEnv() {
  if (fallbackEnvCache) return fallbackEnvCache;
  fallbackEnvCache = loadFallbackEnv();
  return fallbackEnvCache;
}

function loadFallbackEnv() {
  try {
    const candidate = join(process.cwd(), "..", "..", ".env");
    if (!existsSync(candidate)) return {};

    const file = readFileSync(candidate, "utf8");
    return Object.fromEntries(
      file
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => {
          const index = line.indexOf("=");
          if (index === -1) return [line, ""];
          return [line.slice(0, index), line.slice(index + 1)];
        })
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

// Lê uma variável de ambiente caindo no .env da raiz do monorepo quando
// process.env não está populado (dev fora do next dev, scripts, etc).
export function readEnvValue(name: string) {
  return process.env[name] ?? readFallbackEnv()[name];
}

export function getSupabaseUrl() {
  const url = readEnvValue("SUPABASE_URL");
  if (!url) throw new Error("SUPABASE_URL is not set.");
  return url;
}

export function getSupabaseAnonKey() {
  const key = readEnvValue("SUPABASE_ANON_KEY");
  if (!key) throw new Error("SUPABASE_ANON_KEY is not set.");
  return key;
}

export function createSupabaseAuthClient() {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export async function setAuthCookies(accessToken: string, refreshToken: string) {
  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";

  store.set(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_WINDOW_SECONDS
  });

  // Mesma vida da janela de sessão: com deslogue em 1h, não há motivo para um
  // refresh token de 30 dias sobreviver no navegador.
  store.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_WINDOW_SECONDS
  });

  store.set(SESSION_WINDOW_COOKIE, String(Math.floor(Date.now() / 1000) + SESSION_WINDOW_SECONDS), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_WINDOW_SECONDS
  });
}

export async function clearAuthCookies() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
  store.delete(SESSION_WINDOW_COOKIE);
}

// React.cache: deduplica por request — a página (via requireTabAccess) e o
// AppShell chamam getCurrentUser de forma independente, e sem isto cada
// chamada custava 2 round-trips à API de auth do Supabase.
export const getCurrentUser = cache(async () => {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_COOKIE)?.value;

  // Em dev não há login: o mock abaixo é tratado como administrador por
  // `isMaster` (lib/auth/access.ts). Para testar o bloqueio por aba localmente,
  // defina ORACULO_DEV_TABS no .env da raiz.
  if (process.env.NODE_ENV !== "production" && (!accessToken || !refreshToken)) {
    return {
      id: "local-dev",
      email: "localhost@oraculo.local",
      app_metadata: {},
      user_metadata: { full_name: "Localhost" }
    };
  }

  if (!accessToken || !refreshToken) return null;

  // Valida o JWT direto (getUser(jwt)), sem setSession: setSession renovava o
  // refresh token por fora do middleware e a rotação dupla derrubava a sessão
  // em minutos (reuse detection do Supabase revoga a família inteira). Quem
  // renova token agora é só o middleware.
  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error) return null;

  return data.user;
});

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export { ACCESS_COOKIE, REFRESH_COOKIE };
