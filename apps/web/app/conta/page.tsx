import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { requireCurrentUser } from "../../lib/auth/session";
import { avatarUrl, AVATAR_MIME } from "../../lib/auth/avatar";
import { changePassword, removeAvatar, updateName, uploadAvatar } from "./actions";

export const dynamic = "force-dynamic";

// Minha conta: cada pessoa administra a própria conta — foto, nome e senha.
// Não é aba (lib/auth/tabs.ts): todo usuário logado acessa, e o acesso a
// dados continua decidido pelas abas liberadas em /usuarios.

const OK: Record<string, string> = {
  nome: "Nome atualizado.",
  foto: "Foto atualizada.",
  "foto-removida": "Foto removida.",
  senha: "Senha alterada. Use a nova senha no próximo login."
};

const ERRO: Record<string, string> = {
  dev: "No ambiente local não há login real, então a conta não pode ser alterada aqui.",
  "nome-vazio": "Informe um nome.",
  "foto-vazia": "Escolha uma imagem antes de enviar.",
  "foto-formato": "Formato não aceito. Use JPG, PNG ou WebP.",
  "foto-tamanho": "A imagem passa de 2 MB. Escolha uma menor.",
  "senha-vazia": "Preencha a senha atual e a nova senha.",
  "senha-curta": "A nova senha precisa ter pelo menos 8 caracteres.",
  "senha-diferente": "A confirmação não bate com a nova senha.",
  "senha-igual": "A nova senha precisa ser diferente da atual.",
  "senha-atual": "Senha atual incorreta.",
  falha: "Não foi possível salvar agora. Tente de novo em instantes."
};

function initials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export default async function ContaPage({
  searchParams
}: {
  searchParams?: Promise<{ ok?: string; erro?: string }>;
}) {
  const [user, alertCount, params] = await Promise.all([
    requireCurrentUser(),
    loadActionableAlertCount(),
    searchParams
  ]);
  const name = String(user.user_metadata?.full_name || user.email || "Usuário");
  const photo = avatarUrl(user);
  const isDev = user.id === "local-dev";
  const ok = params?.ok ? OK[params.ok] : undefined;
  const erro = params?.erro ? ERRO[params.erro] : undefined;

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Minha conta</h1>
          <p>Sua foto, seu nome e sua senha de acesso ao Oráculo.</p>
        </div>
      </header>

      {ok ? <p className="account-notice account-notice-ok" role="status">{ok}</p> : null}
      {erro ? <p className="account-notice account-notice-error" role="alert">{erro}</p> : null}
      {isDev && !erro ? <p className="account-notice">{ERRO.dev}</p> : null}

      <div className="account-grid">
        <section className="panel account-card account-profile">
          <div className="account-avatar-large" aria-hidden="true">
            {photo ? <img src={photo} alt="" /> : <span>{initials(name)}</span>}
          </div>
          <div className="account-identity">
            <h2>{name}</h2>
            <p>{user.email}</p>
          </div>

          <form action={uploadAvatar} className="account-form">
            <label>
              <span>Foto de perfil</span>
              <input
                name="avatar"
                type="file"
                accept={Object.keys(AVATAR_MIME).join(",")}
                required
                disabled={isDev}
              />
            </label>
            <small>JPG, PNG ou WebP, até 2 MB. Foto quadrada fica melhor.</small>
            <div className="account-actions">
              <button type="submit" disabled={isDev}>Enviar foto</button>
            </div>
          </form>
          {photo ? (
            <form action={removeAvatar}>
              <button type="submit" className="account-link-danger" disabled={isDev}>Remover foto</button>
            </form>
          ) : null}
        </section>

        <div className="account-stack">
          <section className="panel account-card">
            <div className="section-head">
              <p className="eyebrow">Perfil</p>
              <h2>Nome</h2>
            </div>
            <form action={updateName} className="account-form">
              <label>
                <span>Como você aparece no Oráculo</span>
                <input name="full_name" defaultValue={String(user.user_metadata?.full_name ?? "")} maxLength={120} required disabled={isDev} />
              </label>
              <label>
                <span>Email</span>
                <input value={user.email ?? ""} readOnly disabled />
              </label>
              <small>O email é o seu login; para trocá-lo, fale com um administrador.</small>
              <div className="account-actions">
                <button type="submit" disabled={isDev}>Salvar nome</button>
              </div>
            </form>
          </section>

          <section className="panel account-card">
            <div className="section-head">
              <p className="eyebrow">Segurança</p>
              <h2>Mudar senha</h2>
            </div>
            <form action={changePassword} className="account-form">
              <label>
                <span>Senha atual</span>
                <input name="current_password" type="password" autoComplete="current-password" required disabled={isDev} />
              </label>
              <label>
                <span>Nova senha</span>
                <input name="new_password" type="password" autoComplete="new-password" minLength={8} required disabled={isDev} />
              </label>
              <label>
                <span>Confirmar nova senha</span>
                <input name="confirm_password" type="password" autoComplete="new-password" minLength={8} required disabled={isDev} />
              </label>
              <small>Pelo menos 8 caracteres.</small>
              <div className="account-actions">
                <button type="submit" disabled={isDev}>Mudar senha</button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
