import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTabAccess } from "../../../../lib/auth/access";
import { NoAccess } from "../../../components/no-access";
import { AppShell } from "../../../components/app-shell";
import { loadActionableAlertCount } from "../../../../lib/alert-count";
import { DocumentacaoTabs } from "../../tabs";
import { recipeBySlug } from "../../recipes";
import { trapById } from "../../traps";
import { SqlBlock } from "../../sql-block";

export const dynamic = "force-dynamic";

export default async function ReceitaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { allowed } = await requireTabAccess("documentacao");
  if (!allowed) return <NoAccess tab="documentacao" />;

  const { slug } = await params;
  const recipe = recipeBySlug(slug);
  if (!recipe) notFound();

  const alertCount = await loadActionableAlertCount();
  const traps = recipe.traps.map(trapById).filter((trap): trap is NonNullable<typeof trap> => trap != null);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <p className="eyebrow">
            <Link className="doc-link" href="/documentacao/receitas">Receitas</Link>
          </p>
          <h1>{recipe.title}</h1>
          <p>{recipe.question}</p>
        </div>
      </header>

      <DocumentacaoTabs active="receitas" />

      <section className="panel">
        <SqlBlock sql={recipe.sql} title={recipe.title} />
        {recipe.notes ? (
          <div className="doc-prose" style={{ marginTop: 16 }}>
            <p className="fiscal-note">{recipe.notes}</p>
          </div>
        ) : null}
      </section>

      {traps.length > 0 ? (
        <section className="panel doc-trap">
          <div className="section-head">
            <p className="eyebrow">O que esta receita evita</p>
          </div>
          <div className="doc-prose">
            {traps.map((trap) => (
              <div key={trap.id} style={{ marginBottom: 18 }}>
                <p>
                  <strong>{trap.title}</strong>
                </p>
                <p className="muted">{trap.evidence}</p>
                <p>
                  <Link className="doc-link" href={`/documentacao/armadilhas#${trap.id}`}>Detalhes →</Link>
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Objetos usados</p>
        </div>
        <div className="pill-row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {recipe.objects.map((object) => (
            <Link key={object} href={`/documentacao/dicionario/${object}`} className="pill">
              {object}
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
