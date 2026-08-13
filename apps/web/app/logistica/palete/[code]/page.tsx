import Link from "next/link";
import { requireTabAccess } from "../../../../lib/auth/access";
import { loadActionableAlertCount } from "../../../../lib/alert-count";
import { AppShell } from "../../../components/app-shell";
import { NoAccess } from "../../../components/no-access";
import { formatLabelLine, loadPaleteByCode } from "../../data";

export const dynamic = "force-dynamic";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

const quantityFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/**
 * Ficha do palete — é o destino do QR Code da etiqueta.
 *
 * Exige login e a aba Logística (decisão do produto): quem bipar sem sessão cai
 * no /login?next= e volta para cá depois, comportamento padrão do middleware.
 */
export default async function PaletePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [{ allowed }, alertCount] = await Promise.all([
    requireTabAccess("logistica"),
    loadActionableAlertCount()
  ]);
  if (!allowed) return <NoAccess tab="logistica" />;

  const palete = await loadPaleteByCode(String(code ?? "").trim().toUpperCase());

  if (!palete) {
    return (
      <AppShell alertCount={alertCount}>
        <header className="topbar">
          <div>
            <h1>Palete não encontrado</h1>
            <p>Nenhuma etiqueta gerada com o código {code}</p>
          </div>
        </header>
        <section className="panel">
          <p>
            Confira o código impresso embaixo do QR ou{" "}
            <Link href="/logistica/etiqueta">gere uma etiqueta nova</Link>.
          </p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>{palete.product_label}</h1>
          <p>Palete {palete.code}</p>
        </div>
      </header>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Conteúdo</p>
          <h2>O que tem neste palete</h2>
        </div>

        <ul className="palete-linhas">
          {palete.itens.map((item) => (
            <li key={item.position}>
              {formatLabelLine(palete.product_label, item.variation_label, item.quantity)}
            </li>
          ))}
        </ul>

        <dl className="palete-dados">
          <div>
            <dt>Nota fiscal</dt>
            <dd>{palete.invoice_number ?? "—"}</dd>
          </div>
          <div>
            <dt>Caixas por palete</dt>
            <dd>{palete.boxes_per_pallet == null ? "—" : quantityFormatter.format(palete.boxes_per_pallet)}</dd>
          </div>
          <div>
            <dt>Etiquetas geradas</dt>
            <dd>{palete.label_count}</dd>
          </div>
          <div>
            <dt>Gerado em</dt>
            <dd>{dateTimeFormatter.format(new Date(palete.created_at))}</dd>
          </div>
        </dl>

        <p className="palete-acoes">
          <Link className="button-link" href={`/logistica/etiqueta/imprimir?code=${palete.code}`}>
            Reimprimir etiqueta
          </Link>
        </p>
      </section>
    </AppShell>
  );
}
