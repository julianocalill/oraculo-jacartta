import { cache } from "react";
import { createSupabaseAdminClient } from "./supabase/admin";
import { getSaoPauloToday } from "./date";

// Contagem de tarefas da Agenda que pedem atenção do usuário: pendentes com
// prazo até hoje (atrasadas + do dia). Tarefa futura não é aviso. Mesma
// definição usada pelo destaque "atrasada" em /agenda, para o badge nunca
// contradizer a página.
//
// Diferente do alert-count, o dado é POR USUÁRIO — unstable_cache com chave
// global vazaria a contagem entre usuários, então aqui é só React.cache
// (dedupe por request; count indexado numa tabela minúscula, sempre fresco
// após revalidatePath). Nunca derruba a página: em erro, o badge some.
const loadAgendaPendingCountCached = cache(
  async (userId: string): Promise<number | undefined> => {
    const supabase = createSupabaseAdminClient();

    const { data: rows, error: participantsError } = await supabase
      .from("oraculo_agenda_task_participants")
      .select("task_id")
      .eq("user_id", userId);
    if (participantsError) throw participantsError;

    const taskIds = (rows ?? []).map((row) => row.task_id as string);
    if (taskIds.length === 0) return 0;

    const { count, error } = await supabase
      .from("oraculo_agenda_tasks")
      .select("id", { count: "exact", head: true })
      .in("id", taskIds)
      .eq("status", "pendente")
      .lte("due_day", getSaoPauloToday());
    if (error) throw error;

    return count ?? 0;
  }
);

export async function loadAgendaPendingCount(userId: string): Promise<number | undefined> {
  try {
    return await loadAgendaPendingCountCached(userId);
  } catch (err) {
    console.error("loadAgendaPendingCount failed; hiding badge", err);
    return undefined;
  }
}
