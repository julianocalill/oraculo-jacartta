import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { requireCurrentUser } from "../../../lib/auth/session";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { SortableTable, type SortableCell } from "../../components/sortable-table";
import { LojaPills, ShopeeTabs } from "../tabs";
import { HINTS } from "../../../lib/column-hints";
import { type Curve, brl, count, loadShopeeData, trendSlope, trendText } from "../data";
import {
  SUGESTOES_POR_LOJA,
  buildReposicaoSuggestions,
  clampInt,
  situacaoMeta
} from "./build-suggestions";

export const dynamic = "force-dynamic";

// Cadastro de custos em massa, ancorado no SKU do marketplace (decisão
// 2026-07-16: os custos do ERP estão zerados para a maioria dos SKUs; o
// livro de custos passa a ser mantido aqui, com prioridade sobre o Olist).
async function saveCustos(formData: FormData) {
  "use server";
  await requireCurrentUser();
  const raw = String(formData.get("linhas") ?? "");
  const rows = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\S+)\s+([\d.,]+)$/);
      if (!match) return null;
      const cost = Number(match[2].replace(/\./g, "").replace(",", "."));
      const costDot = Number(match[2].replace(",", "."));
      // aceita "12,34", "12.34" e "1.234,56"
      const unit = Number.isFinite(costDot) && match[2].includes(".") && !match[2].includes(",") ? costDot : cost;
      return Number.isFinite(unit) && unit > 0 ? { sku: match[1], unit } : null;
    })
    .filter((row): row is { sku: string; unit: number } => row !== null);
  if (rows.length === 0) return;

  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("oraculo_margin_sku_params").upsert(
    rows.map((row) => ({
      source: "shopee",
      sku: row.sku,
      unit_cost_override: row.unit,
      active: true,
      notes: "cadastro em massa (reposição Shopee)",
      updated_at: now
    })),
    { onConflict: "source,sku" }
  );
  if (error) throw error;
  revalidatePath("/shopee/reposicao");
  revalidatePath("/shopee/estoque");
  revalidatePath("/shopee");
  revalidatePath("/mercado-livre");
  revalidatePath("/mercado-livre/envio");
}

const curveBadge: Record<Exclude<Curve, null>, string> = {
  A: "status-pill signal-good",
  B: "status-pill signal-warning",
  C: "status-pill signal-muted"
};

export default async function ShopeeReposicaoPage({
  searchParams
}: {
  searchParams?: Promise<{ alvo?: string; prazo?: string; loja?: string; limite?: string }>;
}) {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const params = await searchParams;
  const alvo = clampInt(params?.alvo, 30, 7, 90);
  const prazo = clampInt(params?.prazo, 7, 0, 30);
  const limite = clampInt(params?.limite, SUGESTOES_POR_LOJA, 1, 100);
  const lojaFiltro = Number(params?.loja) || null;

  const data = await loadShopeeData();
  if (!data) {
    return (
      <AppShell alertCount={alertCount}>
        <header className="topbar">
          <div>
            <h1>Sugestão de reposição Shopee</h1>
            <p>Aguardando primeira sincronização de produtos.</p>
          </div>
        </header>
        <ShopeeTabs active="reposicao" />
      </AppShell>
    );
  }

  const { shops } = data;
  const {
    horizonte,
    trends,
    visiveis,
    kitsExcluidos,
    omitidos,
    totalUnidades,
    totalGmv,
    perdaEstancada
  } = buildReposicaoSuggestions(data, { alvo, prazo, limite, loja: lojaFiltro });

  // O export recebe os mesmos parâmetros da tela para gerar a mesma lista
  const exportQs = new URLSearchParams({
    alvo: String(alvo),
    prazo: String(prazo),
    limite: String(limite)
  });
  if (lojaFiltro) exportQs.set("loja", String(lojaFiltro));

  const rows: SortableCell[][] = visiveis.map((s) => [
    { text: s.titulo, sort: s.titulo, subtitle: s.porque },
    { text: situacaoMeta[s.situacao].label, sort: situacaoMeta[s.situacao].rank, badge: situacaoMeta[s.situacao].badge },
    s.curve ? { text: `Curva ${s.curve}`, sort: s.curve, badge: curveBadge[s.curve] } : { text: "—", sort: null },
    { text: s.vendas, sort: s.vendas },
    { text: trendText(trends.get(s.trendKey)), sort: trendSlope(trends.get(s.trendKey)) },
    { text: s.velocity.toFixed(1), sort: s.velocity },
    { text: `${Math.floor(s.cobertura)}d`, sort: s.cobertura },
    s.lossPerDay > 0
      ? { text: brl(s.lossPerDay), sort: s.lossPerDay, badge: "status-pill signal-danger" }
      : { text: "—", sort: 0 },
    { text: count(s.enviar), sort: s.enviar, badge: "status-pill signal-good" },
    { text: brl(s.gmv), sort: s.gmv },
    s.custo && s.custo > 0 ? { text: brl(s.custo * s.enviar), sort: s.custo * s.enviar } : { text: "—", sort: null }
  ]);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Sugestão de reposição Shopee</h1>
          <p>
            Regra: repor = média/dia × (alvo {alvo}d + prazo {prazo}d) − estoque − trânsito · FBS usa a
            velocidade da própria Shopee
          </p>
        </div>
        <form className="filter-row filter-form" method="get">
          <label>
            <span>Dias de estoque alvo</span>
            <input type="number" name="alvo" min={7} max={90} defaultValue={alvo} />
          </label>
          <label>
            <span>Prazo de reposição</span>
            <input type="number" name="prazo" min={0} max={30} defaultValue={prazo} />
          </label>
          {lojaFiltro ? <input type="hidden" name="loja" value={lojaFiltro} /> : null}
          <label>
            <span>Itens por loja</span>
            <input type="number" name="limite" min={1} max={100} defaultValue={limite} />
          </label>
          <button type="submit">Recalcular</button>
          <Link className="button-link" href={`/shopee/reposicao/export?${exportQs.toString()}`}>
            Exportar .xlsx
          </Link>
        </form>
      </header>

      <ShopeeTabs active="reposicao" />
      <LojaPills
        shops={shops}
        active={lojaFiltro}
        basePath="/shopee/reposicao"
        extraParams={{ alvo, prazo, limite }}
      />

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-blue">
          <span className="label">Itens sugeridos</span>
          <strong>{count(visiveis.length)}</strong>
          <small>máx. {limite} por loja</small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Unidades a repor</span>
          <strong>{count(totalUnidades)}</strong>
          <small>Para {horizonte} dias de cobertura</small>
        </article>
        <article className="metric accent-emerald">
          <span className="label">Venda protegida</span>
          <strong>{brl(totalGmv)}</strong>
          <small>GMV da reposição a preço de anúncio</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Perda estancada / dia</span>
          <strong>{brl(perdaEstancada)}</strong>
          <small>Se as rupturas forem repostas</small>
        </article>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">
              Priorizado por situação → curva → perda. O “porquê” de cada item está sob o título.
            </p>
            <h2>Itens para repor</h2>
          </div>
          <span className="pill">
            alvo {alvo}d + prazo {prazo}d
          </span>
        </div>
        <SortableTable
          columns={[
            { label: "Produto e justificativa" },
            { label: "Situação", hint: HINTS.situacao },
            { label: "Curva", hint: HINTS.curva },
            { label: "Vendas 30/60d", numeric: true, hint: HINTS.vendas3060 },
            { label: "Tendência 120→0", numeric: true, hint: HINTS.tendencia },
            { label: "Média/dia", numeric: true, hint: HINTS.mediaDia },
            { label: "Cobertura", numeric: true, hint: HINTS.cobertura },
            { label: "Perda/dia", numeric: true, hint: HINTS.perdaDia },
            { label: "Repor", numeric: true, hint: HINTS.enviar },
            { label: "Venda protegida", numeric: true, hint: HINTS.vendaProtegida },
            { label: "Custo", numeric: true, hint: HINTS.custoEnvio }
          ]}
          rows={rows}
          initialSort={1}
          initialDir="asc"
          showRank
        />
        {omitidos > 0 && (
          <p className="table-note">
            Exibindo até {limite} itens por loja — {count(omitidos)} candidatos de menor prioridade ficaram
            fora. Ajuste “Itens por loja” para ver mais.
          </p>
        )}
        {kitsExcluidos > 0 && (
          <p className="table-note">
            {count(kitsExcluidos)} kits ficaram fora da sugestão — kits são compostos de produtos simples;
            reponha os componentes.
          </p>
        )}
        <p className="table-note">
          Sugestões FBS usam a velocidade calculada pela própria Shopee e são limitadas ao estoque local
          disponível para envio; sugestões locais indicam reposição de compra/produção. Custo vem do livro
          de custos por SKU (cadastro abaixo &gt; Olist &gt; kits).
        </p>
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">
            Livro de custos ancorado no SKU do marketplace — tem prioridade sobre o custo do ERP
          </p>
          <h2>Cadastrar custos por SKU</h2>
        </div>
        <p className="table-note">
          Uma linha por SKU: <code>0770 12,50</code>. Os custos aparecem imediatamente nas colunas de
          margem/custo da Shopee e do Mercado Livre (mesmo livro). Dica: comece pelos SKUs listados na
          sugestão acima — são só {count(visiveis.length)}.
        </p>
        <form action={saveCustos} className="upload-form manual-form">
          <textarea name="linhas" rows={6} placeholder={"0770 12,50\n0771-100un 8,90\nSTRONDAL-PLUS 21,00"} />
          <button type="submit">Salvar custos</button>
        </form>
      </section>
    </AppShell>
  );
}
