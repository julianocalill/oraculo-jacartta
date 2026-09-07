// Aba Devoluções — funil horizontal por canal, com a mesma linguagem de
// analytics do dashboard principal (cards com sparkline e variação, área
// diária, donut de motivos).
//
// Shopee e Mercado Livre entram por API (shopee-returns-sync /
// mercadolivre-returns-sync); TikTok entra pelo upload de planilha desta
// própria página. Todos gravam em oraculo_returns e esta tela lê só de lá.
//
// Plano e decisões: docs/plano-devolucoes.md e docs/plano-devolucoes-funil.md

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { assertTabAccess, requireTabAccess } from "../../lib/auth/access";
import { NoAccess } from "../components/no-access";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { AppShell } from "../components/app-shell";
import { MetricCard, type MetricDelta } from "../components/metric-card";
import { TaxDonut, RevenueArea } from "../components/fiscal-charts";
import { ReturnsFunnel, DecisionBar, type FunnelStep, type DecisionSlice } from "../components/returns-funnel";
import { DevolucoesTabs } from "./tabs";
import { importTikTokReturns } from "../../lib/returns-upload";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL: Record<string, string> = {
  shopee: "Shopee",
  tiktok: "TikTok Shop",
  mercadolivre: "Mercado Livre"
};

const REASON_LABEL: Record<string, string> = {
  produto_com_defeito: "Produto com defeito",
  avaria_transporte: "Avaria no transporte",
  nao_recebido: "Não recebido",
  item_errado: "Item errado ou faltando",
  arrependimento: "Arrependimento",
  divergencia_anuncio: "Divergência do anúncio",
  atraso: "Atraso",
  outros: "Outros"
};

const REASON_COLOR: Record<string, string> = {
  produto_com_defeito: "#fb6f84",
  avaria_transporte: "#f6c453",
  nao_recebido: "#6d8bff",
  item_errado: "#a97bff",
  arrependimento: "#3ecfd6",
  divergencia_anuncio: "#34d399",
  atraso: "#e3a93a",
  outros: "#5d6980"
};

const DISPUTE_LABEL: Record<string, string> = {
  ganhamos: "Ganhamos",
  perdemos: "Perdemos",
  encerrada: "Encerrada sem definição",
  em_aberto: "Em aberto"
};

type FunnelRow = { channel: string; stage: string; returns_count: number; amount: number | null };
type SummaryRow = {
  channel: string;
  returns_total: number;
  returns_loss: number;
  units: number | null;
  refund_amount: number | null;
  amount_from_nf: number;
  sem_nf_venda_count: number;
  sem_nf_count: number;
  sem_nf_amount: number | null;
  divergencia_count: number;
};
type ReasonRow = { reason_group: string; returns_count: number; refund_amount: number | null };
type SkuRow = {
  sku: string | null;
  product_name: string | null;
  returns_count: number;
  units: number | null;
  refund_amount: number | null;
  unit_cost: number | null;
  cost_lost: number | null;
  sem_nf_count: number;
};
type DisputeRow = { channel: string; outcome: string; returns_count: number; amount: number | null };
type DailyRow = { day: string; returns_count: number; loss_count: number; amount: number | null };
type ChannelRow = { channel: string; returns_count: number };
type Batch = {
  file_name: string;
  uploaded_at: string;
  sheet_names: string[] | null;
  rows_read: number;
  rows_inserted: number;
  rows_rejected: number;
  notes: string | null;
};

async function uploadReturns(formData: FormData) {
  "use server";
  const user = await assertTabAccess("devolucoes");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  await importTikTokReturns(file, user.id ?? null);
  revalidatePath("/devolucoes");
}

const nf = new Intl.NumberFormat("pt-BR");
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlShort = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0
});

const count = (v: number | null | undefined) => nf.format(v ?? 0);
const money = (v: number | null | undefined) => (v == null ? "—" : brl.format(v));
const moneyShort = (v: number | null | undefined) => (v == null ? "—" : brlShort.format(v));
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

function dateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function monthWindow(monthParam?: string) {
  const now = new Date();
  const [y, m] = monthParam?.match(/^\d{4}-\d{2}$/)
    ? monthParam.split("-").map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  return {
    from: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
    to: new Date(Date.UTC(y, m, 1)).toISOString(),
    prevFrom: new Date(Date.UTC(y, m - 2, 1)).toISOString(),
    prevTo: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
    label: new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(y, m - 1, 1))
    ),
    value: `${y}-${String(m).padStart(2, "0")}`,
    isCurrent: y === now.getUTCFullYear() && m === now.getUTCMonth() + 1
  };
}

/** Variação percentual entre períodos. `invert` marca métrica onde subir é ruim. */
function delta(current: number, previous: number, invert = true): MetricDelta {
  if (!previous) return null;
  const change = ((current - previous) / previous) * 100;
  if (!Number.isFinite(change) || Math.abs(change) < 0.05) return null;
  return {
    direction: change >= 0 ? "up" : "down",
    text: `${Math.abs(change).toFixed(1).replace(".", ",")}%`,
    title: `Mês anterior: ${nf.format(previous)}`,
    invert
  };
}

async function loadData(win: ReturnType<typeof monthWindow>, channel: string | null) {
  const supabase = createSupabaseAdminClient();
  const args = { p_from: win.from, p_to: win.to, p_channel: channel };

  const [funnel, summary, reasons, skus, disputes, daily, channels, prevSummary, batches] =
    await Promise.all([
      supabase.rpc("oraculo_returns_funnel", args),
      supabase.rpc("oraculo_returns_summary", args),
      supabase.rpc("oraculo_returns_by_reason", args),
      supabase.rpc("oraculo_returns_by_sku", { ...args, p_limit: 25 }),
      supabase.rpc("oraculo_returns_disputes", args),
      supabase.rpc("oraculo_returns_daily", args),
      supabase.rpc("oraculo_returns_channels", { p_from: win.from, p_to: win.to }),
      supabase.rpc("oraculo_returns_summary", {
        p_from: win.prevFrom,
        p_to: win.prevTo,
        p_channel: channel
      }),
      supabase
        .from("oraculo_returns_upload_batches")
        .select("file_name, uploaded_at, sheet_names, rows_read, rows_inserted, rows_rejected, notes")
        .order("uploaded_at", { ascending: false })
        .limit(1)
    ]);

  return {
    funnel: (funnel.data ?? []) as FunnelRow[],
    summary: (summary.data ?? []) as SummaryRow[],
    reasons: (reasons.data ?? []) as ReasonRow[],
    skus: (skus.data ?? []) as SkuRow[],
    disputes: (disputes.data ?? []) as DisputeRow[],
    daily: (daily.data ?? []) as DailyRow[],
    channels: (channels.data ?? []) as ChannelRow[],
    prevSummary: (prevSummary.data ?? []) as SummaryRow[],
    batch: ((batches.data ?? [])[0] ?? null) as Batch | null
  };
}

/** Soma um estágio do funil entre canais (a RPC devolve uma linha por canal). */
function stageTotal(rows: FunnelRow[], stage: string) {
  return rows
    .filter((r) => r.stage === stage)
    .reduce(
      (acc, r) => ({
        count: acc.count + Number(r.returns_count ?? 0),
        amount: acc.amount + Number(r.amount ?? 0)
      }),
      { count: 0, amount: 0 }
    );
}

// A cadeia do funil: cada passo é subconjunto ESTRITO do anterior.
//   abertas ⊃ decididas ⊃ concedidas ⊃ produto retorna ⊃ NF confere
// "Decididas" não vem da RPC — é o topo menos as que ainda aguardam decisão.
function buildSteps(rows: FunnelRow[]): FunnelStep[] {
  const abertas = stageTotal(rows, "abertas");
  const aguardando = stageTotal(rows, "aguardando_decisao");
  const cancelada = stageTotal(rows, "cancelada");
  const recusado = stageTotal(rows, "reembolso_recusado");
  const concedido = stageTotal(rows, "reembolso_concedido");
  const retorna = stageTotal(rows, "produto_retorna");
  const confere = stageTotal(rows, "nf_devolucao_confere");

  const decididas = {
    count: abertas.count - aguardando.count,
    amount: abertas.amount - aguardando.amount
  };

  return [
    { key: "abertas", label: "Abertas", count: abertas.count, amount: abertas.amount, tone: "neutral", dropLabel: "aguardando decisão" },
    { key: "decididas", label: "Decididas", count: decididas.count, amount: decididas.amount, tone: "neutral", dropLabel: `recusadas + canceladas (${nf.format(recusado.count + cancelada.count)})` },
    { key: "concedido", label: "Reembolso concedido", count: concedido.count, amount: concedido.amount, tone: "bad", dropLabel: "refund only (produto não volta)" },
    { key: "retorna", label: "Produto retorna", count: retorna.count, amount: retorna.amount, tone: "warn", dropLabel: "sem NF, divergência ou sem lastro" },
    { key: "confere", label: "NF de devolução confere", count: confere.count, amount: confere.amount, tone: "good" }
  ];
}

function buildDecision(rows: FunnelRow[]): { slices: DecisionSlice[]; total: number } {
  const get = (stage: string) => stageTotal(rows, stage);
  const slices: DecisionSlice[] = [
    { key: "aguardando", label: "Aguardando decisão", ...get("aguardando_decisao"), color: "#f6c453" },
    { key: "cancelada", label: "Cancelada pelo comprador", ...get("cancelada"), color: "#5d6980" },
    { key: "recusado", label: "Reembolso recusado", ...get("reembolso_recusado"), color: "#34d399" },
    { key: "concedido", label: "Reembolso concedido", ...get("reembolso_concedido"), color: "#fb6f84" }
  ].map((s) => ({ key: s.key, label: s.label, count: s.count, amount: s.amount, color: s.color }));

  return { slices, total: get("abertas").count };
}

export default async function DevolucoesPage({
  searchParams
}: {
  searchParams: Promise<{ mes?: string; canal?: string }>;
}) {
  const params = await searchParams;
  const win = monthWindow(params.mes);
  const activeTab = params.canal ?? "todos";
  const channel = activeTab !== "todos" ? activeTab : null;

  const [{ allowed }, alertCount, data] = await Promise.all([
    requireTabAccess("devolucoes"),
    loadActionableAlertCount(),
    loadData(win, channel)
  ]);
  if (!allowed) return <NoAccess tab="devolucoes" />;

  const steps = buildSteps(data.funnel);
  const decision = buildDecision(data.funnel);

  const sum = (rows: SummaryRow[], key: keyof SummaryRow) =>
    rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

  const totalReturns = sum(data.summary, "returns_total");
  const totalLoss = sum(data.summary, "returns_loss");
  const totalRefund = sum(data.summary, "refund_amount");
  const totalSemNf = sum(data.summary, "sem_nf_count");
  const totalSemNfAmount = sum(data.summary, "sem_nf_amount");
  const totalFromNf = sum(data.summary, "amount_from_nf");
  const totalCostLost = data.skus.reduce((acc, r) => acc + Number(r.cost_lost ?? 0), 0);

  const prevReturns = sum(data.prevSummary, "returns_total");
  const prevRefund = sum(data.prevSummary, "refund_amount");
  const prevSemNf = sum(data.prevSummary, "sem_nf_count");

  const sparkCount = data.daily.map((d) => Number(d.returns_count ?? 0));
  const sparkAmount = data.daily.map((d) => Number(d.amount ?? 0));
  const areaPoints = data.daily.map((d) => ({ label: d.day, value: Number(d.returns_count ?? 0) }));

  const donutSlices = data.reasons
    .filter((r) => Number(r.returns_count ?? 0) > 0)
    .map((r) => ({
      label: REASON_LABEL[r.reason_group] ?? r.reason_group,
      value: Number(r.returns_count ?? 0),
      color: REASON_COLOR[r.reason_group] ?? "#5d6980"
    }));

  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return monthWindow(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  });

  const tabChannels = data.channels.map((c) => ({
    key: c.channel,
    label: CHANNEL_LABEL[c.channel] ?? c.channel,
    count: Number(c.returns_count ?? 0)
  }));

  const lossRate = totalReturns > 0 ? (totalLoss / totalReturns) * 100 : 0;
  const channelName = channel ? (CHANNEL_LABEL[channel] ?? channel) : "todos os canais";

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Devoluções</h1>
          <p>
            Funil por canal cruzado com a NF de devolução da Olist · {win.label} · {channelName}
          </p>
        </div>
        <div className="filter-row">
          {months.map((m) => (
            <a
              key={m.value}
              href={`/devolucoes?mes=${m.value}&canal=${activeTab}`}
              className={m.value === win.value ? "chip chip-active" : "chip"}
            >
              {m.label}
            </a>
          ))}
        </div>
      </header>

      <DevolucoesTabs active={activeTab} month={win.value} channels={tabChannels} />

      {win.isCurrent ? (
        <section className="status-alerts">
          <div className="status-alert">
            Mês em curso: o topo do funil sempre parece inflado em relação ao fundo, porque as
            devoluções ainda vão ser decididas. Compare meses fechados.
          </div>
        </section>
      ) : null}

      <section className="metric-grid">
        <MetricCard
          accent="accent-blue"
          label="Devoluções abertas"
          value={count(totalReturns)}
          caption={`${pct(lossRate)} contam como perda`}
          delta={delta(totalReturns, prevReturns)}
          spark={sparkCount}
          sparkColor="#6d8bff"
        />
        <MetricCard
          accent="accent-red"
          label="Estornado"
          value={moneyShort(totalRefund)}
          caption={totalFromNf > 0 ? `${count(totalFromNf)} com valor estimado pela NF` : "valor informado pelos canais"}
          delta={delta(totalRefund, prevRefund)}
          spark={sparkAmount}
          sparkColor="#fb6f84"
        />
        <MetricCard
          accent="accent-yellow"
          label="Sem NF de devolução"
          value={count(totalSemNf)}
          caption={`${moneyShort(totalSemNfAmount)} sem entrada na Olist`}
          delta={delta(totalSemNf, prevSemNf)}
        />
        <MetricCard
          accent="accent-violet"
          label="Custo do produto perdido"
          value={moneyShort(totalCostLost)}
          caption="top 25 SKUs, a custo unitário"
        />
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Funil</p>
          <h2>Do pedido de devolução ao dinheiro</h2>
        </div>
        <p className="muted">
          Cada passo é um subconjunto estrito do anterior — é isso que autoriza o formato de funil.
          Acima de cada fita, quantas devoluções não avançaram e por quê.
        </p>
        <ReturnsFunnel steps={steps} />
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Decisão</p>
          <h2>Para onde foram as devoluções</h2>
        </div>
        <p className="muted">
          Estas quatro fatias somam o topo do funil, exatamente. Reembolso recusado é dinheiro
          retido — vitória financeira, não necessariamente vitória com o cliente.
        </p>
        <DecisionBar slices={decision.slices} total={decision.total} />
      </section>

      <section className="dashboard-section">
        <article className="panel">
          <div className="section-head">
            <p className="eyebrow">Ritmo</p>
            <h2>Devoluções abertas por dia</h2>
          </div>
          <RevenueArea points={areaPoints} />
        </article>

        <article className="panel">
          <div className="section-head">
            <p className="eyebrow">Motivos</p>
            <h2>Por que devolveram</h2>
          </div>
          {donutSlices.length > 0 ? (
            <>
              <TaxDonut slices={donutSlices} centerLabel="devoluções" />
              <div className="table-wrap">
                <table className="data-table dense-table">
                  <thead>
                    <tr>
                      <th>Motivo</th>
                      <th className="numeric">Casos</th>
                      <th className="numeric">Estornado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reasons.map((r) => (
                      <tr key={r.reason_group}>
                        <td>{REASON_LABEL[r.reason_group] ?? r.reason_group}</td>
                        <td className="numeric">{count(r.returns_count)}</td>
                        <td className="numeric">{money(r.refund_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="empty-state">Sem motivos classificados no período.</p>
          )}
        </article>
      </section>

      {activeTab === "todos" ? (
        <section className="panel">
          <div className="section-head">
            <p className="eyebrow">Comparativo</p>
            <h2>Canais lado a lado</h2>
          </div>
          <p className="muted">
            Ordens de grandeza diferentes: em julho a Shopee teve ~3.400 devoluções, o TikTok 1.725
            e o Mercado Livre 4. Volume baixo no ML é volume de venda menor no canal, não qualidade
            melhor. O ML <strong>não informa o valor do reembolso</strong> — ali o valor vem da NF de
            venda, que é o total do <em>pedido</em>, então estorno parcial aparece maior do que foi.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Canal</th>
                  <th className="numeric">Devoluções</th>
                  <th className="numeric">Contam como perda</th>
                  <th className="numeric">Unidades</th>
                  <th className="numeric">Estornado</th>
                  <th className="numeric">Valor estimado pela NF</th>
                  <th className="numeric">Sem NF de venda</th>
                  <th className="numeric">Sem NF de devolução</th>
                  <th className="numeric">R$ sem NF</th>
                  <th className="numeric">Divergências</th>
                </tr>
              </thead>
              <tbody>
                {data.summary.length === 0 ? (
                  <tr>
                    <td colSpan={10}>Nenhuma devolução no período.</td>
                  </tr>
                ) : (
                  data.summary.map((row) => (
                    <tr key={row.channel}>
                      <td>{CHANNEL_LABEL[row.channel] ?? row.channel}</td>
                      <td className="numeric">{count(row.returns_total)}</td>
                      <td className="numeric">{count(row.returns_loss)}</td>
                      <td className="numeric">{count(row.units)}</td>
                      <td className="numeric">{money(row.refund_amount)}</td>
                      <td className="numeric">{count(row.amount_from_nf)}</td>
                      <td className="numeric">{count(row.sem_nf_venda_count)}</td>
                      <td className="numeric">{count(row.sem_nf_count)}</td>
                      <td className="numeric">{money(row.sem_nf_amount)}</td>
                      <td className="numeric">{count(row.divergencia_count)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">SKUs</p>
          <h2>Onde a devolução se concentra</h2>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Produto</th>
                <th className="numeric">Devoluções</th>
                <th className="numeric">Unidades</th>
                <th className="numeric">Estornado</th>
                <th className="numeric">Custo unitário</th>
                <th className="numeric">Custo perdido</th>
                <th className="numeric">Sem NF</th>
              </tr>
            </thead>
            <tbody>
              {data.skus.length === 0 ? (
                <tr>
                  <td colSpan={8}>Sem dados no período.</td>
                </tr>
              ) : (
                data.skus.map((row, i) => (
                  <tr key={`${row.sku ?? "sem-sku"}-${i}`}>
                    <td>{row.sku ?? "—"}</td>
                    <td>{row.product_name ?? "—"}</td>
                    <td className="numeric">{count(row.returns_count)}</td>
                    <td className="numeric">{count(row.units)}</td>
                    <td className="numeric">{money(row.refund_amount)}</td>
                    <td className="numeric">{money(row.unit_cost)}</td>
                    <td className="numeric">{money(row.cost_lost)}</td>
                    <td className="numeric">{count(row.sem_nf_count)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {data.disputes.length > 0 ? (
        <section className="panel">
          <div className="section-head">
            <p className="eyebrow">Disputas</p>
            <h2>Ganhamos e perdemos</h2>
          </div>
          <p className="muted">
            Disputa é desvio, não etapa: em julho só 5,5% das devoluções do TikTok passaram por
            disputa. Com poucas dezenas por mês, leia a tendência, não o número isolado.
          </p>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Canal</th>
                  <th>Resultado</th>
                  <th className="numeric">Casos</th>
                  <th className="numeric">Valor</th>
                </tr>
              </thead>
              <tbody>
                {data.disputes.map((row) => (
                  <tr key={`${row.channel}-${row.outcome}`}>
                    <td>{CHANNEL_LABEL[row.channel] ?? row.channel}</td>
                    <td>{DISPUTE_LABEL[row.outcome] ?? row.outcome}</td>
                    <td className="numeric">{count(row.returns_count)}</td>
                    <td className="numeric">{money(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {activeTab === "todos" || activeTab === "tiktok" ? (
        <section className="panel">
          <div className="section-head">
            <p className="eyebrow">Ingestão</p>
            <h2>Planilha do TikTok Shop</h2>
          </div>
          <p className="muted">
            Shopee e Mercado Livre entram sozinhos por API. O TikTok é por upload: exportação de
            <em> Pedidos de devolução/reembolso</em> (.xlsx), uma aba por loja. As colunas são lidas
            pelo nome do cabeçalho, então abas com layouts diferentes funcionam. Subir o mesmo
            arquivo de novo <strong>atualiza</strong>, não duplica.
          </p>
          <form action={uploadReturns} className="upload-form">
            <label>
              <span>Arquivo .xlsx</span>
              <input type="file" name="file" accept=".xlsx" required />
            </label>
            <button type="submit">Importar</button>
          </form>
          {data.batch ? (
            <p className="muted">
              Último lote: <strong>{data.batch.file_name}</strong> · {dateTime(data.batch.uploaded_at)} ·{" "}
              {count(data.batch.rows_read)} lidas, {count(data.batch.rows_inserted)} gravadas,{" "}
              {count(data.batch.rows_rejected)} descartadas
              {data.batch.notes ? ` · ${data.batch.notes}` : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Como ler</p>
          <h2>Ressalvas</h2>
        </div>
        <ul className="muted">
          <li>
            <strong>É distribuição de estado, não coorte.</strong> As devoluções aguardando decisão
            ainda vão virar concedido ou recusado. Compare meses fechados.
          </li>
          <li>
            <strong>&ldquo;Sem NF de venda&rdquo; não é furo.</strong> A base de notas da Olist
            começa em junho/2026; devolução de venda anterior não tem lastro para cruzar.
          </li>
          <li>
            <strong>O casamento com a NF de devolução é heurístico.</strong> A nota de devolução não
            guarda o número do pedido, então o cruzamento usa CPF, SKU e janela de 90 dias. Confira
            uma amostra antes de cobrar alguém.
          </li>
          <li>
            <strong>Valor estimado pela NF não é o estorno.</strong> Quando o canal não informa o
            valor (hoje só o Mercado Livre), usa-se o total da NF de venda; em devolução parcial
            isso superestima.
          </li>
        </ul>
      </section>
    </AppShell>
  );
}
