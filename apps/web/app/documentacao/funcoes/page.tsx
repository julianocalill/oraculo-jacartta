import { requireTabAccess } from "../../../lib/auth/access";
import { NoAccess } from "../../components/no-access";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { DocumentacaoTabs } from "../tabs";
import { loadCatalogFunctions } from "../data";

export const dynamic = "force-dynamic";

export default async function FuncoesPage({ searchParams }: { searchParams: Promise<{ todas?: string; q?: string }> }) {
  const { allowed } = await requireTabAccess("documentacao");
  if (!allowed) return <NoAccess tab="documentacao" />;

  const params = await searchParams;
  const todas = params.todas === "1";
  const q = (params.q ?? "").trim().toLowerCase();

  const [alertCount, functions] = await Promise.all([loadActionableAlertCount(), loadCatalogFunctions()]);

  // Por padrão só o que serve para relatório: chamável por `authenticated` e que
  // devolve dado. Trigger e rotina de refresh (retorno void) são maquinaria
  // interna — ficam atrás de ?todas=1.
  const filtered = functions.filter((fn) => {
    if (!todas && (!fn.callable_by_authenticated || fn.return_type === "trigger" || fn.return_type === "void")) {
      return false;
    }
    if (q && !`${fn.function_name} ${fn.function_comment ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Funções (RPC)</h1>
          <p>
            Análises prontas que rodam igual no Metabase e no PowerBI — chame com{" "}
            <code>select * from nome_da_funcao(...)</code>
          </p>
        </div>
        <form className="filter-row filter-form" method="get">
          <label>
            <span>Buscar</span>
            <input name="q" defaultValue={params.q ?? ""} placeholder="nome da função" />
          </label>
          <label>
            <span>Mostrar</span>
            <select name="todas" defaultValue={todas ? "1" : ""}>
              <option value="">Só as úteis para relatório</option>
              <option value="1">Todas, incluindo internas</option>
            </select>
          </label>
          <button type="submit">Aplicar</button>
        </form>
      </header>

      <DocumentacaoTabs active="funcoes" />

      <section className="panel">
        <div className="doc-prose">
          <p>
            Uma função encapsula a regra de negócio já validada — margem com decomposição fiscal, curva ABC que
            exclui pedido B2B, devolução que não conta recusa como perda. Usar a função em vez de reescrever a
            conta no Metabase é o que mantém o número igual ao da tela do Oráculo.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Funções</p>
            <h2>
              {filtered.length} {filtered.length === 1 ? "função" : "funções"}
            </h2>
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="empty-state">Nenhuma função com esse filtro.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Função</th>
                  <th>Parâmetros</th>
                  <th>Retorna</th>
                  <th>Descrição</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((fn) => (
                  <tr key={`${fn.function_name}(${fn.identity_arguments})`}>
                    <td>
                      <code>{fn.function_name}</code>
                    </td>
                    <td className="muted">
                      {fn.arguments ? <code>{fn.arguments}</code> : <span className="muted">sem parâmetros</span>}
                    </td>
                    <td className="muted">{fn.return_type}</td>
                    <td className="doc-desc">
                      {fn.function_comment ? (
                        fn.function_comment
                      ) : (
                        <span className="doc-missing">sem descrição</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
