import { AppShell } from "./app-shell";
import { tabLabel, type TabKey } from "../../lib/auth/tabs";

// Tela mostrada quando o usuário abre uma aba que não está marcada para ele.
// A aba já some do menu lateral; isto cobre quem chega pela URL direta,
// por um link antigo ou por um favorito.
export function NoAccess({ tab, hasAnyTab = true }: { tab?: TabKey; hasAnyTab?: boolean }) {
  if (!hasAnyTab) {
    return (
      <AppShell>
        <header className="topbar">
          <div>
            <h1>Acesso não liberado</h1>
            <p>Seu usuário ainda não tem nenhuma aba liberada. Peça a liberação a um administrador.</p>
          </div>
        </header>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <header className="topbar">
        <div>
          <h1>Sem acesso</h1>
          <p>
            {tab
              ? `Você não tem acesso à aba "${tabLabel(tab)}". Peça a liberação a um administrador.`
              : "Você não tem acesso a esta aba. Peça a liberação a um administrador."}
          </p>
        </div>
      </header>
    </AppShell>
  );
}
