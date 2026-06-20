import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { isAdmin, requireCurrentUser } from "../../lib/auth/session";

export const dynamic = "force-dynamic";

type AuthUser = {
  id: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
};

function date(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function displayName(user: AuthUser) {
  return String(user.user_metadata?.full_name || user.email || "Sem nome");
}

function roleOf(user: AuthUser) {
  return String(user.app_metadata?.role || "user");
}

function isBlocked(user: AuthUser) {
  return Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now());
}

async function loadUsers() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users as AuthUser[];
}

async function createUser(formData: FormData) {
  "use server";

  const supabase = createSupabaseAdminClient();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") || "").trim();
  const role = String(formData.get("role") || "user");

  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role }
  });

  if (error) throw error;
  revalidatePath("/usuarios");
}

async function updateUser(formData: FormData) {
  "use server";

  const supabase = createSupabaseAdminClient();
  const userId = String(formData.get("user_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") || "").trim();
  const role = String(formData.get("role") || "user");
  const password = String(formData.get("password") ?? "");
  const blocked = String(formData.get("blocked") ?? "false") === "true";

  const attributes: Parameters<typeof supabase.auth.admin.updateUserById>[1] = {
    email,
    user_metadata: { full_name: fullName },
    app_metadata: { role },
    ban_duration: blocked ? "876000h" : "none"
  };

  if (password) {
    attributes.password = password;
  }

  const { error } = await supabase.auth.admin.updateUserById(userId, attributes);
  if (error) throw error;
  revalidatePath("/usuarios");
}

export default async function UsuariosPage() {
  const currentUser = await requireCurrentUser();
  const allowed = isAdmin(currentUser);
  const users = allowed ? await loadUsers() : [];

  if (!allowed) {
    return (
      <main className="workspace single-workspace">
        <header className="topbar">
          <div>
            <Link href="/" className="back-link">← Analytics</Link>
            <h1>Usuários</h1>
            <p>Seu usuário não tem permissão de administrador.</p>
          </div>
        </header>
      </main>
    );
  }

  return (
    <main className="workspace single-workspace">
      <header className="topbar">
        <div>
          <Link href="/" className="back-link">← Analytics</Link>
          <h1>Usuários</h1>
          <p>Crie, edite e bloqueie acessos ao Oraculo.</p>
        </div>
      </header>

      <section className="panel settings-panel">
        <div className="section-head">
          <p className="eyebrow">Novo acesso</p>
          <h2>Criar usuário</h2>
        </div>
        <form action={createUser} className="upload-form user-form">
          <label>
            <span>Nome</span>
            <input name="full_name" required />
          </label>
          <label>
            <span>Email</span>
            <input name="email" type="email" required />
          </label>
          <label>
            <span>Senha</span>
            <input name="password" type="password" required />
          </label>
          <label>
            <span>Perfil</span>
            <select name="role" defaultValue="user">
              <option value="user">Usuário</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit">Criar usuário</button>
        </form>
      </section>

      <section className="panel product-panel">
        <div className="sku-toolbar">
          <div>
            <p className="eyebrow">Acessos</p>
            <h2>Usuários cadastrados</h2>
          </div>
          <div className="sku-actions">
            <strong>{users.length} usuários</strong>
            <span>Auth</span>
            <span>Perfil</span>
          </div>
        </div>

        <div className="user-list">
          {users.map((user) => (
            <form action={updateUser} className="user-edit-card" key={user.id}>
              <input type="hidden" name="user_id" value={user.id} />
              <label>
                <span>Nome</span>
                <input name="full_name" defaultValue={displayName(user)} />
              </label>
              <label>
                <span>Email</span>
                <input name="email" type="email" defaultValue={user.email ?? ""} />
              </label>
              <label>
                <span>Nova senha</span>
                <input name="password" type="password" placeholder="manter atual" />
              </label>
              <label>
                <span>Perfil</span>
                <select name="role" defaultValue={roleOf(user)}>
                  <option value="user">Usuário</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label>
                <span>Status</span>
                <select name="blocked" defaultValue={isBlocked(user) ? "true" : "false"}>
                  <option value="false">Ativo</option>
                  <option value="true">Bloqueado</option>
                </select>
              </label>
              <div className="user-meta">
                <span>Criado: {date(user.created_at)}</span>
                <span>Último login: {date(user.last_sign_in_at)}</span>
              </div>
              <button type="submit">Salvar</button>
            </form>
          ))}
        </div>
      </section>
    </main>
  );
}
