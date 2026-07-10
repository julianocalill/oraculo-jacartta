import { createSupabaseUserClient } from "./supabase/user";

// Contagem exata dos alertas acionáveis (ruptura + ruptura iminente), usada
// pelo badge da sidebar em todas as páginas. Nunca derruba a página: em erro,
// o badge simplesmente some.
export async function loadActionableAlertCount(): Promise<number | undefined> {
  try {
    const supabase = await createSupabaseUserClient();
    const { count, error } = await supabase
      .from("oraculo_stock_watchlist_unified")
      .select("sku", { count: "exact", head: true })
      .not("sku", "is", null)
      .neq("sku", "")
      .in("stock_signal", ["ruptura", "ruptura_iminente"]);
    if (error) throw error;
    return count ?? undefined;
  } catch (err) {
    console.error("loadActionableAlertCount failed; hiding badge", err);
    return undefined;
  }
}
