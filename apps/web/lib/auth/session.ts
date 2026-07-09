import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ACCESS_COOKIE = "oraculo_access_token";
const REFRESH_COOKIE = "oraculo_refresh_token";

function readFallbackEnv() {
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

export function getSupabaseUrl() {
  const fallbackEnv = readFallbackEnv();
  const url = process.env.SUPABASE_URL ?? fallbackEnv.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL is not set.");
  return url;
}

export function getSupabaseAnonKey() {
  const fallbackEnv = readFallbackEnv();
  const key = process.env.SUPABASE_ANON_KEY ?? fallbackEnv.SUPABASE_ANON_KEY;
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

export async function getCurrentUser() {
  const store = await cookies();
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  const refreshToken = store.get(REFRESH_COOKIE)?.value;

  if (process.env.NODE_ENV !== "production" && (!accessToken || !refreshToken)) {
    return {
      id: "local-dev",
      email: "localhost@oraculo.local",
      app_metadata: { role: "admin" },
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
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function isAdmin(user: { app_metadata?: Record<string, unknown> } | null) {
  return user?.app_metadata?.role === "admin";
}

export { ACCESS_COOKIE, REFRESH_COOKIE };
