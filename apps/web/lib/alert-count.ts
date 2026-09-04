import { operationIsReady } from "./operation-status";
import { getRequestOperation, type OperationId } from "./operation-context";
import { getCurrentUser } from "./auth/session";
import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "./supabase/admin";

// Contagem exata dos alertas acionáveis (ruptura + ruptura iminente), usada
// pelo badge da sidebar em todas as páginas. Nunca derruba a página: em erro,
// o badge simplesmente some.
//
// Cacheada por 60s e compartilhada entre usuários: o dado é global (watchlist
// de estoque, igual para todo mundo) e só aparece em páginas atrás do gate de
// auth. Por isso o fetch interno usa o admin client — unstable_cache não pode
// ler cookies(), então o client por usuário não entra aqui.
const loadActionableAlertCountCached = unstable_cache(
  async (operation: OperationId): Promise<number | null> => {
    const supabase = createSupabaseAdminClient({ operation });
    const { count, error } = await supabase
      .from("oraculo_stock_watchlist_unified")
      .select("sku", { count: "exact", head: true })
      .not("sku", "is", null)
      .neq("sku", "")
      .in("stock_signal", ["ruptura", "ruptura_iminente"]);
    if (error) throw error;
    // unstable_cache não armazena undefined; null é o "sem valor" cacheável.
    return count ?? null;
  },
  ["actionable-alert-count"],
  { revalidate: 60 }
);

export async function loadActionableAlertCount(): Promise<number | undefined> {
  try {
    const user = await getCurrentUser();
    if (!user?.oraculo_operation_allowed) return undefined;
    const operation = await getRequestOperation();
    if (!(await operationIsReady(operation))) return undefined;
    return (await loadActionableAlertCountCached(operation)) ?? undefined;
  } catch (err) {
    console.error("loadActionableAlertCount failed; hiding badge", err);
    return undefined;
  }
}
