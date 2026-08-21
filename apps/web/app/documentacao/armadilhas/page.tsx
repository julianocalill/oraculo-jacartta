import Link from "next/link";
import { requireTabAccess } from "../../../lib/auth/access";
import { NoAccess } from "../../components/no-access";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { DocumentacaoTabs } from "../tabs";
import { TRAPS } from "../traps";

export const dynamic = "force-dynamic";

export default async function ArmadilhasPage() {
  const { allowed } = await requireTabAccess("documentacao");
  if (!allowed) return <NoAccess tab="documentacao" />;

  const alertCount = await loadActionableAlertCount();

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Armadilhas do dado</h1>
          <p>
            {TRAPS.length} formas conhecidas de produzir, de boa-fé, um número errado que parece certo
          </p>
        </div>
      </header>

      <DocumentacaoTabs active="armadilhas" />

      <section className="panel">
        <div className="doc-prose">
          <p>
            Nenhuma destas é hipótese: cada uma já custou um bug real em produção. Elas existem porque o banco junta
            quatro origens de dado que descrevem as mesmas vendas com nomes e recortes diferentes — a Olist emite a
            NF de todos os canais, e cada marketplace também conta a própria versão da mesma venda.
          </p>
        </div>
      </section>

      {TRAPS.map((trap) => (
        <section key={trap.id} id={trap.id} className="panel doc-trap">
          <div className="section-head">
            <p className="eyebrow">Armadilha</p>
            <h2>{trap.title}</h2>
          </div>
          <div className="doc-prose">
            <p>
              <strong>Errado:</strong> <code>{trap.wrong}</code>
            </p>
            <p>
              <strong>Certo:</strong> {trap.right}
            </p>
            <p className="muted">{trap.evidence}</p>
            {trap.objects.length > 0 ? (
              <div className="pill-row" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {trap.objects.map((object) => (
                  <Link key={object} href={`/documentacao/dicionario/${object}`} className="pill">
                    {object}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </section>
      ))}
    </AppShell>
  );
}
