import "server-only";
import { cache } from "react";
import { createSupabaseAdminClient } from "./supabase/admin";

export const operationIsReady = cache(async (operation: string): Promise<boolean> => {
  // Compatibility while the additive migrations are being installed.
  if (operation === "uberlandia") return true;
  if (operation !== "giracasa") return false;
  const admin = createSupabaseAdminClient({ operation: "uberlandia" });
  const { data, error } = await admin.from("oraculo_operations").select("enabled").eq("id", operation).maybeSingle();
  if (error) return false;
  return data?.enabled === true;
});
