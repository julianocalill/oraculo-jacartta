import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Memoizado: é I/O síncrono no event loop e createSupabaseAdminClient roda
// várias vezes por request. Só é consultado quando process.env não tem a var.
let fallbackEnvCache: Record<string, string> | null = null;

function readFallbackEnv() {
  if (fallbackEnvCache) return fallbackEnvCache;
  fallbackEnvCache = loadFallbackEnv();
  return fallbackEnvCache;
}

function loadFallbackEnv() {
  try {
    const candidate = join(process.cwd(), "..", "..", ".env");
    if (!existsSync(candidate)) {
      return {};
    }

    const file = readFileSync(candidate, "utf8");
    return Object.fromEntries(
      file
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .map((line) => {
          const index = line.indexOf("=");
          if (index === -1) {
            return [line, ""];
          }

          return [line.slice(0, index), line.slice(index + 1)];
        })
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

export function createSupabaseAdminClient() {
  const url = process.env.SUPABASE_URL ?? readFallbackEnv().SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? readFallbackEnv().SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL is not set.");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
