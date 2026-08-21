import Link from "next/link";
import { requireTabAccess } from "../../../lib/auth/access";
import { NoAccess } from "../../components/no-access";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { DocumentacaoTabs } from "../tabs";
import {
  loadCatalogObjects,
  searchCatalogColumns,
  formatBytes,
  formatRows,
  kindLabel,
  coveragePct
} from "../data";
import { DOMAINS, domainOf, layerOf, LAYER_LABEL, sensitivityOf, SENSITIVITY_LABEL } from "../domains";

export const dynamic = "force-dynamic";

type Search = { q?: string; dominio?: string; tipo?: string; pendentes?: string };

export default async function DicionarioPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { allowed } = await requireTabAccess("documentacao");
  if (!allowed) return <NoAccess tab="documentacao" />;

  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const dominio = params.dominio ?? "todos";
  const tipo = params.tipo ?? "todos";
  const pendentes = params.pendentes === "1";

  const [alertCount, objects, columnMatches] = await Promise.all([
    loadActionableAlertCount(),
    loadCatalogObjects(),
    // A busca de coluna é o recurso mais pedido por quem monta relatório
    // ("onde fica a coluna do faturamento?"). Só vale a pena a partir de 3
    // caracteres — abaixo disso devolve o schema inteiro.
    q.length >= 3 ? searchCatalogColumns(q) : Promise.resolve([])
  ]);

  const filtered = objects.filter((object) => {
    if (dominio !== "todos" && domainOf(object.domain_key) !== dominio) return false;
    if (tipo !== "todos" && object.object_kind !== tipo) return false;
    if (pendentes && object.object_comment && object.documented_columns === object.column_count) return false;
    if (q) {
      const haystack = `${object.object_name} ${object.object_comment ?? ""}`.toLowerCase();
      if (!haystack.includes(q.toLowerCase())) return false;
    }
    return true;
  });

  const groupedMatches = columnMatches.reduce<Record<string, typeof columnMatches>>((acc, column) => {
    (acc[column.object_name] ??= []).push(column);
    return acc;
  }, {});

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Dicionário de dados</h1>
          <p>
            {objects.length} objetos lidos direto do catálogo do Postgres · clique para ver colunas, tipos e chaves
          </p>
        </div>
        <form className="filter-row filter-form" method="get">
          <label>
            <span>Buscar</span>
            <input name="q" defaultValue={q} placeholder="tabela, coluna ou descrição" />
          </label>
          <label>
            <span>Domínio</span>
            <select name="dominio" defaultValue={dominio}>
              <option value="todos">Todos</option>
              {DOMAINS.map((domain) => (
                <option key={domain.key} value={domain.key}>
                  {domain.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Tipo</span>
            <select name="tipo" defaultValue={tipo}>
              <option value="todos">Todos</option>
              <option value="table">Tabelas</option>
              <option value="view">Views</option>
              <option value="materialized_view">Materialized views</option>
            </select>
          </label>
          <label>
            <span>Cobertura</span>
            <select name="pendentes" defaultValue={pendentes ? "1" : ""}>
              <option value="">Todas</option>
              <option value="1">Só o que falta descrever</option>
            </select>
          </label>
          <button type="submit">Aplicar</button>
        </form>
      </header>

      <DocumentacaoTabs active="dicionario" />

      {q.length >= 3 && columnMatches.length > 0 ? (
        <section className="panel">
          <div className="section-head">
            <p className="eyebrow">Colunas que casam com “{q}”</p>
            <h2>{columnMatches.length} colunas em {Object.keys(groupedMatches).length} objetos</h2>
          </div>
          <div className="doc-columns-list">
            {Object.entries(groupedMatches).map(([objectName, columns]) => (
              <p key={objectName} className="doc-match">
                <Link href={`/documentacao/dicionario/${objectName}`}>{objectName}</Link>
                <span className="muted"> · {columns.map((c) => c.column_name).join(", ")}</span>
              </p>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Objetos</p>
            <h2>
              {filtered.length} {filtered.length === 1 ? "resultado" : "resultados"}
            </h2>
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="empty-state">Nenhum objeto com esses filtros.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Objeto</th>
                  <th>Tipo</th>
                  <th>Camada</th>
                  <th>Descrição</th>
                  <th className="numeric">Colunas</th>
                  <th className="numeric">Descritas</th>
                  <th className="numeric">Linhas aprox.</th>
                  <th className="numeric">Tamanho</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((object) => {
                  const pct = coveragePct(object);
                  const sensitivity = sensitivityOf(object.object_name);
                  return (
                    <tr key={object.object_name}>
                      <td>
                        <Link href={`/documentacao/dicionario/${object.object_name}`}>{object.object_name}</Link>
                        {sensitivity !== "normal" ? (
                          <div className="doc-badge doc-badge-warn">{SENSITIVITY_LABEL[sensitivity]}</div>
                        ) : null}
                      </td>
                      <td>
                        <span className={`kind-badge kind-${object.object_kind}`}>
                          {kindLabel(object.object_kind)}
                        </span>
                      </td>
                      <td className="muted">{LAYER_LABEL[layerOf(object.object_name, object.object_kind)]}</td>
                      <td>
                        {object.object_comment ? (
                          object.object_comment
                        ) : (
                          <span className="doc-missing">sem descrição</span>
                        )}
                      </td>
                      <td className="numeric">{object.column_count}</td>
                      <td className="numeric">
                        <span className={pct === 100 ? "doc-status is-done" : pct === 0 ? "doc-status is-missing" : "doc-status is-partial"}>
                          {pct}%
                        </span>
                      </td>
                      <td className="numeric">{formatRows(object.approx_rows)}</td>
                      <td className="numeric">{formatBytes(object.total_bytes)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
