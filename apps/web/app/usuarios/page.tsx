import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { assertMaster, isMaster, requireMaster } from "../../lib/auth/access";
import { ALL_TAB_KEYS, isAdminOnlyTab, isTabKey, tabLabel, type TabKey } from "../../lib/auth/tabs";
import { AppShell } from "../components/app-shell";
import { NoAccess } from "../components/no-access";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { TabCheckboxes } from "./tab-checkboxes";

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
  return !value
    ? "-"
    : new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo"
      }).format(new Date(value));
}

function displayName(user: AuthUser) {
  return String(user.user_metadata?.full_name || user.email || "Sem nome");
}

function tabsOf(user: AuthUser): TabKey[] {
  const raw = user.app_metadata?.tabs;
  const restrictedRaw = user.app_metadata?.restricted_tabs;
  const granted = new Set(Array.isArray(raw) ? raw.filter(isTabKey) : []);
  const restrictedGranted = new Set(
    Array.isArray(restrictedRaw) ? restrictedRaw.filter(isTabKey) : []
  );
  return ALL_TAB_KEYS.filter((key) =>
    isAdminOnlyTab(key) ? restrictedGranted.has(key) : granted.has(key)
  );
}

function isBlocked(user: AuthUser) {
  return Boolean(user.banned_until && new Date(user.banned_until).getTime() > Date.now());
}

// Só as chaves conhecidas entram no metadata — o formulário não define o vocabulário.
function readTabs(formData: FormData): TabKey[] {
  const submitted = new Set(formData.getAll("tabs").map(String).filter(isTabKey));
  return ALL_TAB_KEYS.filter((key) => submitted.has(key) && !isAdminOnlyTab(key));
}

function readRestrictedTabs(formData: FormData): TabKey[] {
  const submitted = new Set(formData.getAll("restricted_tabs").map(String).filter(isTabKey));
  return ALL_TAB_KEYS.filter((key) => submitted.has(key) && isAdminOnlyTab(key));
}

async function loadUsers() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users as AuthUser[];
}

async function createUser(formData: FormData) {
  "use server";
  await assertMaster();

  const supabase = createSupabaseAdminClient();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") || "").trim();

  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: {
      tabs: readTabs(formData),
      restricted_tabs: readRestrictedTabs(formData)
    }
  });

  if (error) throw error;
  revalidatePath("/usuarios");
}

async function updateUser(formData: FormData) {
  "use server";
  await assertMaster();

  const supabase = createSupabaseAdminClient();
  const userId = String(formData.get("user_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") || "").trim();
  const password = String(formData.get("password") ?? "");
  const blocked = String(formData.get("blocked") ?? "false") === "true";

  const attributes: Parameters<typeof supabase.auth.admin.updateUserById>[1] = {
    email,
    user_metadata: { full_name: fullName },
    ban_duration: blocked ? "876000h" : "none"
  };

  // Administradores fixos não têm caixinhas no formulário: preservar o metadata
  // deles evita zerar o acesso de quem edita a própria linha.
  if (!isMaster({ id: userId, email })) {
    attributes.app_metadata = {
      tabs: readTabs(formData),
      restricted_tabs: readRestrictedTabs(formData)
    };
  }

  if (password) {
    attributes.password = password;
  }

  const { error } = await supabase.auth.admin.updateUserById(userId, attributes);
  if (error) throw error;
  revalidatePath("/usuarios");
}

export default async function UsuariosPage() {
  const [{ allowed }, alertCount] = await Promise.all([
    requireMaster(),
    loadActionableAlertCount()
  ]);
  if (!allowed) return <NoAccess tab="usuarios" />;

  // loadUsers usa a auth admin API — fica atrás do gate de master de propósito.
  const users = await loadUsers();

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Usuários</h1>
          <p>Crie acessos e marque, aba por aba, o que cada pessoa pode abrir.</p>
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
          <TabCheckboxes />
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
            <span>Abas</span>
          </div>
        </div>

        <div className="user-list">
          {users.map((user) => {
            const master = isMaster(user);
            const granted = tabsOf(user);

            return (
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
                  <span>Status</span>
                  <select name="blocked" defaultValue={isBlocked(user) ? "true" : "false"}>
                    <option value="false">Ativo</option>
                    <option value="true">Bloqueado</option>
                  </select>
                </label>

                {master ? (
                  <div className="tab-access tab-access-master">
                    <span>Abas liberadas</span>
                    <p>Administrador — acesso total a todas as abas.</p>
                  </div>
                ) : (
                  <TabCheckboxes selected={granted} />
                )}

                <div className="user-meta">
                  <span>Criado: {date(user.created_at)}</span>
                  <span>Último login: {date(user.last_sign_in_at)}</span>
                  <span>
                    {master
                      ? "Administrador"
                      : granted.length === 0
                        ? "Nenhuma aba liberada"
                        : `${granted.length} abas: ${granted.map(tabLabel).join(", ")}`}
                  </span>
                </div>
                <button type="submit">Salvar</button>
              </form>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
