import Link from "next/link";
import { requireTabAccess } from "../../lib/auth/access";
import { NoAccess } from "../components/no-access";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { DocumentacaoTabs } from "./tabs";
import { loadCatalogObjects } from "./data";
import { DOMAINS, domainOf } from "./domains";
import { TRAPS } from "./traps";
import { RECIPES } from "./recipes";

export const dynamic = "force-dynamic";

export default async function DocumentacaoPage() {
  const { allowed } = await requireTabAccess("documentacao");
  if (!allowed) return <NoAccess tab="documentacao" />;

  const [alertCount, objects] = await Promise.all([loadActionableAlertCount(), loadCatalogObjects()]);

  const totalColumns = objects.reduce((sum, o) => sum + o.column_count, 0);
  const documentedColumns = objects.reduce((sum, o) => sum + o.documented_columns, 0);
  const documentedObjects = objects.filter((o) => o.object_comment).length;
  const objectPct = objects.length ? Math.round((documentedObjects / objects.length) * 100) : 0;
  const columnPct = totalColumns ? Math.round((documentedColumns / totalColumns) * 100) : 0;

  const byDomain = DOMAINS.map((domain) => {
    const items = objects.filter((o) => domainOf(o.domain_key) === domain.key);
    return {
      ...domain,
      count: items.length,
      documented: items.filter((i) => i.object_comment).length
    };
  }).filter((d) => d.count > 0);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Documentação do banco</h1>
          <p>
            Dicionário de dados, receitas de SQL e as armadilhas do dado — para montar relatório no Metabase e no
            PowerBI sem chutar
          </p>
        </div>
      </header>

      <DocumentacaoTabs active="visao" />

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Por onde começar</p>
        </div>
        <div className="doc-prose">
          <p>
            O banco do Oráculo tem <strong>{objects.length} objetos</strong> e{" "}
            <strong>{totalColumns.toLocaleString("pt-BR")} colunas</strong>. Esta área lê o schema{" "}
            <strong>direto do catálogo do Postgres</strong>, então o que você vê aqui é o banco real, não uma cópia
            que envelheceu.
          </p>
          <p>
            Se é sua primeira vez: comece por <Link className="doc-link" href="/documentacao/conectar">Conectar BI</Link> para ligar a
            ferramenta ao banco, depois vá em <Link className="doc-link" href="/documentacao/receitas">Receitas de SQL</Link> — são
            consultas prontas para os pedidos mais comuns. Antes de publicar qualquer número, leia{" "}
            <Link className="doc-link" href="/documentacao/armadilhas">Armadilhas</Link>.
          </p>
        </div>
      </section>

      <section className="panel doc-trap">
        <div className="section-head">
          <p className="eyebrow">Leia isto antes de confiar em qualquer total</p>
        </div>
        <div className="doc-prose">
          <p>
            Existem {TRAPS.length} armadilhas conhecidas neste banco. Cada uma já produziu um número errado que
            parecia certo. As três que mais custam caro:
          </p>
          <ul>
            <li>
              <strong>Somar Olist e Shopee conta a mesma venda duas vezes</strong> — R$ 12,7 mi contra R$ 8,27 mi de
              NF realmente faturada em 30 dias.
            </li>
            <li>
              <strong>Contar pedidos em <code>olist_order_items</code> subestima cerca de 3x</strong> — a contagem de
              pedidos sai de <code>olist_orders</code>.
            </li>
            <li>
              <strong>Devolução se filtra por <code>fiscal_origin_type</code></strong>, nunca por{" "}
              <code>fiscal_invoice_type = &apos;E&apos;</code> — o tipo infla 18x.
            </li>
          </ul>
          <p>
            <Link className="doc-link" href="/documentacao/armadilhas">Ver as {TRAPS.length} armadilhas →</Link>
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Cobertura da documentação</p>
            <h2>O que já está descrito</h2>
          </div>
        </div>
        <div className="doc-prose">
          <p>
            Esta barra é a lista de trabalho, não um enfeite: a descrição de cada objeto e coluna vive como{" "}
            <code>COMMENT ON</code> no próprio banco, então ela também aparece dentro do Metabase e do DBeaver. O que
            está em branco aqui está em branco lá.
          </p>
        </div>
        <div className="doc-grid">
          <div className="doc-card">
            <p className="doc-card-title">Objetos descritos</p>
            <strong className="doc-big">
              {documentedObjects} / {objects.length}
            </strong>
            <div className="doc-coverage-bar">
              <i style={{ width: `${objectPct}%` }} />
            </div>
            <p className="muted">{objectPct}% das tabelas, views e materialized views</p>
          </div>
          <div className="doc-card">
            <p className="doc-card-title">Colunas descritas</p>
            <strong className="doc-big">
              {documentedColumns.toLocaleString("pt-BR")} / {totalColumns.toLocaleString("pt-BR")}
            </strong>
            <div className="doc-coverage-bar">
              <i style={{ width: `${columnPct}%` }} />
            </div>
            <p className="muted">
              {columnPct}% —{" "}
              <Link className="doc-link" href="/documentacao/dicionario?pendentes=1">ver o que falta</Link>
            </p>
          </div>
          <div className="doc-card">
            <p className="doc-card-title">Receitas prontas</p>
            <strong className="doc-big">{RECIPES.length}</strong>
            <p className="muted">
              Consultas testadas contra o banco de produção.{" "}
              <Link className="doc-link" href="/documentacao/receitas">Abrir</Link>
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Mapa do banco</p>
            <h2>Domínios</h2>
          </div>
        </div>
        <div className="doc-prose">
          <p>
            O prefixo do nome diz de onde o dado vem: <code>olist_</code>, <code>shopee_</code>,{" "}
            <code>mercadolivre_</code> e <code>importacao_</code> são o dado bruto de cada fonte;{" "}
            <code>oraculo_</code> é a camada derivada que já fala a mesma língua entre canais — é ela que o BI deve
            consumir na maioria dos casos. Sufixo <code>_cache</code> é snapshot recalculado por cron;{" "}
            <code>_sync_runs</code> é registro operacional de importação, não serve para relatório.
          </p>
        </div>
        <div className="doc-grid">
          {byDomain.map((domain) => (
            <Link key={domain.key} href={`/documentacao/dicionario?dominio=${domain.key}`} className="doc-card">
              <p className="doc-card-title">{domain.label}</p>
              <strong className="doc-big">{domain.count}</strong>
              <p className="muted">{domain.description}</p>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
