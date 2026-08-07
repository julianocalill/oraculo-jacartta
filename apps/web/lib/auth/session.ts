import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cache } from "react";

const ACCESS_COOKIE = "oraculo_access_token";
const REFRESH_COOKIE = "oraculo_refresh_token";

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
    maxAge: 60 * 60
  });

  store.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export async function clearAuthCookies() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
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

  const supabase = createSupabaseAuthClient();
  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  if (sessionError || !sessionData.session) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error) return null;

  return data.user;
});

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export { ACCESS_COOKIE, REFRESH_COOKIE };
