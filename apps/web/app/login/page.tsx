import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import {
  clearAuthCookies,
  createSupabaseAuthClient,
  getCurrentUser,
  setAuthCookies
} from "../../lib/auth/session";

export const dynamic = "force-dynamic";

type LoginSearchParams = {
  error?: string;
  next?: string;
};

async function hasAnyUser() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw error;
  return (data.users?.length ?? 0) > 0;
}

async function login(formData: FormData) {
  "use server";

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") || "/");

  const supabase = createSupabaseAuthClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    redirect(`/login?error=${encodeURIComponent("Email ou senha inválidos.")}`);
  }

  await setAuthCookies(data.session.access_token, data.session.refresh_token);
  redirect(next.startsWith("/") ? next : "/");
}

async function createFirstAdmin(formData: FormData) {
  "use server";

  const supabase = createSupabaseAdminClient();
  const { data: existing, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (listError) throw listError;
  if ((existing.users?.length ?? 0) > 0) redirect("/login");

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") || "Administrador").trim();

  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role: "admin" }
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/login");
}

async function logout() {
  "use server";
  await clearAuthCookies();
  redirect("/login");
}

export default async function LoginPage({
  searchParams
}: {
  searchParams?: Promise<LoginSearchParams>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const hasUsers = await hasAnyUser();

  if (user && hasUsers) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <span className="brand-mark">O</span>
          <h1>Você já está conectado</h1>
          <p>{user.email}</p>
          <form action={logout}>
            <button type="submit">Sair</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <span className="brand-mark">O</span>
        <h1>{hasUsers ? "Entrar no Oraculo" : "Criar primeiro administrador"}</h1>
        <p>{hasUsers ? "Acesse o painel operacional." : "Nenhum usuário existe ainda. Crie o primeiro admin."}</p>

        {params?.error ? <strong className="form-error">{params.error}</strong> : null}

        <form action={hasUsers ? login : createFirstAdmin} className="login-form">
          {!hasUsers ? (
            <label>
              <span>Nome</span>
              <input name="full_name" placeholder="Juliano Calil" required />
            </label>
          ) : null}
          <label>
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            <span>Senha</span>
            <input name="password" type="password" autoComplete={hasUsers ? "current-password" : "new-password"} required />
          </label>
          <input type="hidden" name="next" value={params?.next ?? "/"} />
          <button type="submit">{hasUsers ? "Entrar" : "Criar admin"}</button>
        </form>
      </section>
    </main>
  );
}
