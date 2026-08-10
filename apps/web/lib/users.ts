import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "./supabase/admin";

// Diretório de usuários do Oráculo para features colaborativas (Agenda).
//
// Não existe tabela pública de perfis: usuários vivem só em auth.users, e a
// única forma de listá-los é a auth admin API (service-role). Este loader
// expõe APENAS id/nome/email — abas liberadas, datas de login e bloqueio
// continuam restritos ao gate de master em /usuarios.

export type OraculoUser = {
  id: string;
  name: string;
  email: string;
};

// O mock de dev (lib/auth/session.ts) tem id "local-dev", que não é uuid e não
// existe em auth.users. Este sentinela fixo permite gravar tarefas em colunas
// uuid durante o desenvolvimento sem FK quebrada nem cast inválido.
export const LOCAL_DEV_UUID = "00000000-0000-0000-0000-0000000000dd";

export function effectiveUserId(user: { id: string }): string {
  return user.id === "local-dev" ? LOCAL_DEV_UUID : user.id;
}

// Diretório é dado global (igual para todo usuário logado) e muda raramente —
// cache compartilhado de 5 min, mesmo racional do alert-count: o fetch interno
// usa o admin client porque unstable_cache não pode ler cookies().
const listOraculoUsersCached = unstable_cache(
  async (): Promise<OraculoUser[]> => {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw error;

    return data.users
      .map((user) => ({
        id: user.id,
        name: String(user.user_metadata?.full_name || user.email || "Sem nome"),
        email: user.email ?? ""
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  },
  ["oraculo-users-directory"],
  { revalidate: 300 }
);

export async function listOraculoUsers(): Promise<OraculoUser[]> {
  return listOraculoUsersCached();
}

export async function mapOraculoUsersById(): Promise<Map<string, OraculoUser>> {
  const users = await listOraculoUsers();
  return new Map(users.map((user) => [user.id, user]));
}
