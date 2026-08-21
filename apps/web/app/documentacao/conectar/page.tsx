import { requireTabAccess } from "../../../lib/auth/access";
import { NoAccess } from "../../components/no-access";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { DocumentacaoTabs } from "../tabs";
import { CONNECTION_FIELDS } from "../connection";
import { SqlBlock } from "../sql-block";

export const dynamic = "force-dynamic";

export default async function ConectarPage() {
  const { allowed } = await requireTabAccess("documentacao");
  if (!allowed) return <NoAccess tab="documentacao" />;

  const alertCount = await loadActionableAlertCount();

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Conectar o BI ao banco</h1>
          <p>Metabase e PowerBI falam direto com o Postgres do Supabase — estes são os parâmetros</p>
        </div>
      </header>

      <DocumentacaoTabs active="conectar" />

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Parâmetros de conexão</p>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Campo</th>
                <th>Valor</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {CONNECTION_FIELDS.map((field) => (
                <tr key={field.label}>
                  <td>{field.label}</td>
                  <td>
                    <code>{field.value}</code>
                  </td>
                  <td className="muted">{field.note ?? "—"}</td>
                </tr>
              ))}
              <tr>
                <td>Senha</td>
                <td className="doc-missing">não é exibida aqui</td>
                <td className="muted">peça ao administrador do Oráculo</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel doc-trap">
        <div className="section-head">
          <p className="eyebrow">Antes de conectar</p>
        </div>
        <div className="doc-prose">
          <ul>
            <li>
              <strong>A senha não circula por aqui.</strong> Ela não aparece nesta tela, não vai por chat, ticket ou
              e-mail. Fica no gerenciador de senhas do time e no painel do Supabase (Settings → Database).
            </li>
            <li>
              <strong>Esta conexão consegue escrever.</strong> Ela não é somente-leitura por configuração. Nunca
              rode <code>insert</code>, <code>update</code>, <code>delete</code> ou <code>drop</code> numa consulta
              do Metabase — é o mesmo banco que alimenta o Oráculo e a operação.
            </li>
            <li>
              <strong>Use a porta 5432, não a 6543.</strong> A 6543 é o modo de transação do pooler: quebra
              prepared statements e comandos <code>SET</code>, e tanto o Metabase quanto o PowerBI esperam sessão.
            </li>
            <li>
              <strong>No PowerBI, use modo Importar, não DirectQuery.</strong> <code>olist_orders</code> tem 1,1 GB
              e o DirectQuery vai disparar consultas pesadas repetidas, concorrendo com os crons de sincronização.
            </li>
          </ul>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Passo a passo</p>
          <h2>Metabase</h2>
        </div>
        <div className="doc-prose">
          <ol>
            <li>Admin → Databases → Add database → PostgreSQL.</li>
            <li>Preencha host, porta, banco e usuário com os valores da tabela acima.</li>
            <li>
              Marque <em>Use a secure connection (SSL)</em>. Se pedir opções JDBC extras, use{" "}
              <code>sslmode=require</code>.
            </li>
            <li>
              Depois de sincronizar, vá em Admin → Table Metadata: as descrições de tabela e coluna que você vê no{" "}
              <strong>Dicionário</strong> aparecem lá também — elas vivem no próprio banco, não nesta tela.
            </li>
          </ol>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>PowerBI Desktop</h2>
        </div>
        <div className="doc-prose">
          <ol>
            <li>Obter Dados → Banco de dados PostgreSQL.</li>
            <li>
              Servidor: <code>aws-1-sa-east-1.pooler.supabase.com:5432</code> · Banco de dados:{" "}
              <code>postgres</code>.
            </li>
            <li>
              Escolha <strong>Importar</strong> (não DirectQuery).
            </li>
            <li>Nas credenciais, escolha a aba Banco de dados e marque Criptografar conexão.</li>
          </ol>
          <p className="muted">Requer o provedor Npgsql instalado.</p>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Teste de fumaça</p>
          <h2>Confirme que a conexão funciona</h2>
        </div>
        <SqlBlock
          sql={`-- 1) A conexão responde?
select current_database(), current_user, now();

-- 2) Consegue ver o schema de negócio?
select count(*) as objetos
from information_schema.tables
where table_schema = 'public';

-- 3) Um número real, já com a regra de negócio aplicada:
select sum(billed_revenue) as faturado_30d
from oraculo_fiscal_invoices_valid
where issued_date >= current_date - 30;`}
          title="Três consultas de verificação"
        />
      </section>
    </AppShell>
  );
}
