import Link from "next/link";
import { requireTabAccess } from "../../../lib/auth/access";
import { NoAccess } from "../../components/no-access";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { DocumentacaoTabs } from "../tabs";
import { RECIPES } from "../recipes";

export const dynamic = "force-dynamic";

export default async function ReceitasPage() {
  const { allowed } = await requireTabAccess("documentacao");
  if (!allowed) return <NoAccess tab="documentacao" />;

  const alertCount = await loadActionableAlertCount();

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Receitas de SQL</h1>
          <p>Consultas prontas, testadas contra o banco de produção — copie e cole no Metabase ou no PowerBI</p>
        </div>
      </header>

      <DocumentacaoTabs active="receitas" />

      <section className="panel">
        <div className="doc-prose">
          <p>
            Cada receita responde a uma pergunta de negócio e já vem com as armadilhas relevantes ao lado do SQL —
            não num rodapé que ninguém lê. Se a sua pergunta não está aqui, comece pela mais parecida: ela já
            aponta para os objetos certos.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="doc-grid">
          {RECIPES.map((recipe) => (
            <Link key={recipe.slug} href={`/documentacao/receitas/${recipe.slug}`} className="doc-card">
              <p className="doc-card-title">{recipe.title}</p>
              <p className="doc-question">{recipe.question}</p>
              <p className="muted">
                {recipe.objects.join(", ")}
                {recipe.traps.length > 0
                  ? ` · ${recipe.traps.length} ${recipe.traps.length === 1 ? "armadilha evitada" : "armadilhas evitadas"}`
                  : ""}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
