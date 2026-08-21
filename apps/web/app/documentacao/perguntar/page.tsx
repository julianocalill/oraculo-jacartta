import { Suspense } from "react";
import Link from "next/link";
import { requireTabAccess } from "../../../lib/auth/access";
import { NoAccess } from "../../components/no-access";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { DocumentacaoTabs } from "../tabs";
import { loadCatalogObjects, kindLabel } from "../data";
import { findCandidates, ollamaConfig } from "../ask";
import { AiAnswer } from "./ai-answer";

export const dynamic = "force-dynamic";

const EXEMPLOS = [
  "quanto eu faturei por canal em julho",
  "quais produtos vão acabar no estoque",
  "por que meu total de vendas dá o dobro",
  "qual o custo de cada SKU",
  "quanto os clientes estão devolvendo e por quê"
];

export default async function PerguntarPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { allowed } = await requireTabAccess("documentacao");
  if (!allowed) return <NoAccess tab="documentacao" />;

  const params = await searchParams;
  const q = (params.q ?? "").trim();

  const [alertCount, objects] = await Promise.all([loadActionableAlertCount(), loadCatalogObjects()]);
  const candidates = q ? findCandidates(q, objects) : null;
  const { enabled: iaLigada } = ollamaConfig();

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Perguntar</h1>
          <p>Descreva o que você quer saber em português — a busca aponta onde o dado mora</p>
        </div>
      </header>

      <DocumentacaoTabs active="perguntar" />

      <section className="panel">
        <form className="filter-row filter-form" method="get">
          <label style={{ flex: "1 1 420px" }}>
            <span>Sua pergunta</span>
            <input name="q" defaultValue={q} placeholder="quanto eu faturei por canal no mês passado" />
          </label>
          <button type="submit">Buscar</button>
        </form>

        {!q ? (
          <div className="doc-prose" style={{ marginTop: 16 }}>
            <p>
              Esta busca não devolve números — ela devolve <strong>o caminho</strong>: qual tabela ou view usar, qual
              receita de SQL já resolve o caso e quais armadilhas se aplicam. O número você tira do Metabase ou do
              PowerBI depois, com a certeza de estar olhando o lugar certo.
            </p>
            <p>Exemplos:</p>
            <ul>
              {EXEMPLOS.map((exemplo) => (
                <li key={exemplo}>
                  <Link className="doc-link" href={`/documentacao/perguntar?q=${encodeURIComponent(exemplo)}`}>
                    {exemplo}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {candidates ? (
        <>
          {candidates.objects.length === 0 && candidates.recipes.length === 0 ? (
            <section className="panel">
              <p className="empty-state">
                Nada no catálogo casou com essa pergunta. Tente termos do negócio (faturamento, estoque, devolução,
                custo, canal) ou procure direto no{" "}
                <Link className="doc-link" href="/documentacao/dicionario">
                  dicionário
                </Link>
                .
              </p>
            </section>
          ) : (
            <>
              {candidates.recipes.length > 0 ? (
                <section className="panel">
                  <div className="section-head">
                    <p className="eyebrow">Já existe receita pronta</p>
                    <h2>{candidates.recipes[0].title}</h2>
                  </div>
                  <div className="doc-prose">
                    <p>{candidates.recipes[0].question}</p>
                    <p>
                      <Link className="doc-link" href={`/documentacao/receitas/${candidates.recipes[0].slug}`}>
                        Abrir a consulta pronta →
                      </Link>
                    </p>
                  </div>
                  {candidates.recipes.length > 1 ? (
                    <div className="pill-row" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                      {candidates.recipes.slice(1).map((recipe) => (
                        <Link key={recipe.slug} href={`/documentacao/receitas/${recipe.slug}`} className="pill">
                          {recipe.title}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {candidates.objects.length > 0 ? (
                <section className="panel">
                  <div className="section-head">
                    <p className="eyebrow">Onde o dado mora</p>
                    <h2>
                      {candidates.objects.length} {candidates.objects.length === 1 ? "objeto" : "objetos"} no catálogo
                    </h2>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Objeto</th>
                          <th>Tipo</th>
                          <th>O que é</th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.objects.map((object) => (
                          <tr key={object.object_name}>
                            <td>
                              <Link
                                className="row-link doc-object"
                                href={`/documentacao/dicionario/${object.object_name}`}
                              >
                                {object.object_name}
                              </Link>
                            </td>
                            <td>
                              <span className={`kind-badge kind-${object.object_kind}`}>
                                {kindLabel(object.object_kind)}
                              </span>
                            </td>
                            <td className="doc-desc">
                              {object.object_comment ?? <span className="doc-missing">sem descrição</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : null}

              {candidates.traps.length > 0 ? (
                <section className="panel doc-trap">
                  <div className="section-head">
                    <p className="eyebrow">Cuidado com isto</p>
                    <h2>
                      {candidates.traps.length}{" "}
                      {candidates.traps.length === 1 ? "armadilha se aplica" : "armadilhas se aplicam"}
                    </h2>
                  </div>
                  <div className="doc-prose">
                    {candidates.traps.map((trap) => (
                      <div key={trap.id} style={{ marginBottom: 18 }}>
                        <p>
                          <strong>{trap.title}</strong>
                        </p>
                        <p className="muted">{trap.evidence}</p>
                        <p>
                          <Link className="doc-link" href={`/documentacao/armadilhas#${trap.id}`}>
                            Como fazer certo →
                          </Link>
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {iaLigada ? (
                <section className="panel">
                  <div className="section-head">
                    <p className="eyebrow">Leitura por IA local</p>
                  </div>
                  <Suspense
                    fallback={
                      <p className="muted">Consultando o modelo local… os resultados acima já estão completos.</p>
                    }
                  >
                    <AiAnswer candidates={candidates} objects={objects} />
                  </Suspense>
                </section>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </AppShell>
  );
}
