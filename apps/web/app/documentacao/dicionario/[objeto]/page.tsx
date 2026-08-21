import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTabAccess } from "../../../../lib/auth/access";
import { NoAccess } from "../../../components/no-access";
import { AppShell } from "../../../components/app-shell";
import { loadActionableAlertCount } from "../../../../lib/alert-count";
import { DocumentacaoTabs } from "../../tabs";
import {
  loadCatalogObjects,
  loadCatalogColumns,
  loadViewSql,
  formatBytes,
  formatRows,
  kindLabel,
  coveragePct
} from "../../data";
import { domainLabel, layerOf, LAYER_LABEL, sensitivityOf, SENSITIVITY_LABEL } from "../../domains";
import { trapsForObject } from "../../traps";
import { recipesForObject } from "../../recipes";
import { SqlBlock } from "../../sql-block";

export const dynamic = "force-dynamic";

export default async function ObjetoPage({ params }: { params: Promise<{ objeto: string }> }) {
  const { allowed } = await requireTabAccess("documentacao");
  if (!allowed) return <NoAccess tab="documentacao" />;

  const { objeto } = await params;

  const [alertCount, objects, columns] = await Promise.all([
    loadActionableAlertCount(),
    loadCatalogObjects(),
    loadCatalogColumns(objeto)
  ]);

  const object = objects.find((o) => o.object_name === objeto);
  if (!object) notFound();

  const isView = object.object_kind !== "table";
  const viewSql = isView ? await loadViewSql(objeto) : null;
  const traps = trapsForObject(objeto);
  const recipes = recipesForObject(objeto);
  const sensitivity = sensitivityOf(objeto);
  const pct = coveragePct(object);

  const sampleSql = `select *\nfrom ${objeto}\nlimit 100;`;

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <p className="eyebrow">
            <Link href="/documentacao/dicionario">Dicionário</Link> · {domainLabel(object.domain_key)}
          </p>
          <h1>{objeto}</h1>
          <p>
            <span className={`kind-badge kind-${object.object_kind}`}>{kindLabel(object.object_kind)}</span>{" "}
            {LAYER_LABEL[layerOf(objeto, object.object_kind)]} · {object.column_count} colunas ·{" "}
            {formatRows(object.approx_rows)} linhas · {formatBytes(object.total_bytes)}
          </p>
        </div>
      </header>

      <DocumentacaoTabs active="dicionario" />

      {sensitivity !== "normal" ? (
        <section className="panel doc-trap">
          <div className="section-head">
            <p className="eyebrow">Atenção</p>
          </div>
          <div className="doc-prose">
            <p>
              <strong>{SENSITIVITY_LABEL[sensitivity]}.</strong>{" "}
              {sensitivity === "credencial"
                ? "Esta tabela guarda tokens e chaves de integração. Ela não tem uso analítico e não deve entrar em nenhum relatório."
                : sensitivity === "dado_pessoal"
                  ? "Guarda dado pessoal de terceiros (nome, documento, endereço). Só use agregado, e nunca publique um relatório que exponha linha a linha."
                  : "Tabela de uso interno com acesso por linha (RLS): o que você lê aqui depende de quem você é."}
            </p>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">O que é</p>
        </div>
        <div className="doc-prose">
          {object.object_comment ? (
            <p>{object.object_comment}</p>
          ) : (
            <p className="doc-missing">
              Este objeto ainda não tem descrição. Ela é escrita como <code>COMMENT ON</code> numa migration e
              aparece aqui e dentro do Metabase automaticamente.
            </p>
          )}
          {!object.readable_by_authenticated ? (
            <p className="muted">
              Não é legível pelo papel <code>authenticated</code> — o acesso é por <code>service_role</code> ou pelas
              RPCs correspondentes.
            </p>
          ) : null}
        </div>
      </section>

      {traps.length > 0 ? (
        <section className="panel doc-trap">
          <div className="section-head">
            <p className="eyebrow">Armadilhas deste objeto</p>
            <h2>{traps.length === 1 ? "1 armadilha conhecida" : `${traps.length} armadilhas conhecidas`}</h2>
          </div>
          <div className="doc-prose">
            {traps.map((trap) => (
              <div key={trap.id} style={{ marginBottom: 18 }}>
                <p>
                  <strong>{trap.title}</strong>
                </p>
                <p className="muted">{trap.evidence}</p>
                <p>
                  <Link href={`/documentacao/armadilhas#${trap.id}`}>Como fazer certo →</Link>
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Colunas</p>
            <h2>
              {object.column_count} colunas ·{" "}
              <span className={pct === 100 ? "doc-status is-done" : pct === 0 ? "doc-status is-missing" : "doc-status is-partial"}>
                {pct}% descritas
              </span>
            </h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Coluna</th>
                <th>Tipo</th>
                <th>Nulo?</th>
                <th>Chave</th>
                <th>Descrição</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column.column_name}>
                  <td>
                    <code>{column.column_name}</code>
                  </td>
                  <td className="muted">{column.data_type}</td>
                  <td className="muted">{column.is_nullable ? "sim" : "não"}</td>
                  <td className="muted">
                    {column.is_primary_key ? <span className="kind-badge kind-table">PK</span> : null}
                    {column.references_to ? (
                      <Link href={`/documentacao/dicionario/${column.references_to.split(".")[0]}`}>
                        → {column.references_to}
                      </Link>
                    ) : null}
                    {!column.is_primary_key && !column.references_to ? "—" : null}
                  </td>
                  <td>
                    {column.column_comment ? (
                      column.column_comment
                    ) : (
                      <span className="doc-missing">sem descrição</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Consulta de partida</p>
        </div>
        <SqlBlock sql={sampleSql} title="Espiar as primeiras linhas" />
      </section>

      {recipes.length > 0 ? (
        <section className="panel">
          <div className="section-head">
            <p className="eyebrow">Receitas que usam este objeto</p>
          </div>
          <div className="pill-row" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {recipes.map((recipe) => (
              <Link key={recipe.slug} href={`/documentacao/receitas/${recipe.slug}`} className="pill">
                {recipe.title}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {viewSql ? (
        <section className="panel">
          <div className="section-head">
            <p className="eyebrow">Definição</p>
            <h2>O SQL que monta esta {kindLabel(object.object_kind)}</h2>
          </div>
          <SqlBlock sql={viewSql} title={`${objeto} (definição)`} />
        </section>
      ) : null}
    </AppShell>
  );
}
