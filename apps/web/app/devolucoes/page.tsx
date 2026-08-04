// Aba Devoluções — funil, valores e cruzamento com a NF da Olist.
//
// Shopee e Mercado Livre entram por API (shopee-returns-sync /
// mercadolivre-returns-sync); TikTok entra pelo upload de planilha desta
// própria página. Todos gravam em oraculo_returns e esta tela lê só de lá.
//
// Plano e decisões: docs/plano-devolucoes.md e docs/plano-devolucoes-funil.md

import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { requireCurrentUser } from "../../lib/auth/session";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { AppShell } from "../components/app-shell";
import { ReturnsFunnel, type FunnelStage } from "../components/returns-funnel";
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

const DISPUTE_LABEL: Record<string, string> = {
  ganhamos: "Ganhamos",
  perdemos: "Perdemos",
  encerrada: "Encerrada sem definição",
  em_aberto: "Em aberto"
};

type FunnelRow = {
  channel: string;
  stage: string;
  stage_order: number;
  returns_count: number;
  units: number | null;
  amount: number | null;
};

type SummaryRow = {
  channel: string;
  returns_total: number;
  returns_loss: number;
  units: number | null;
  refund_amount: number | null;
  sem_nf_venda_count: number;
  sem_nf_count: number;
  sem_nf_amount: number | null;
  divergencia_count: number;
};

type ReasonRow = {
  reason_group: string;
  returns_count: number;
  units: number | null;
  refund_amount: number | null;
};

type SkuRow = {
  sku: string | null;
  sku_channel: string | null;
  product_name: string | null;
  returns_count: number;
  units: number | null;
  refund_amount: number | null;
  unit_cost: number | null;
  cost_lost: number | null;
  sem_nf_count: number;
};

type DisputeRow = { channel: string; outcome: string; returns_count: number; amount: number | null };

type Batch = {
  id: string;
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
  const user = await requireCurrentUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  await importTikTokReturns(file, user.id ?? null);
  revalidatePath("/devolucoes");
}

function count(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(value ?? 0);
}

function money(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function moneyShort(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
}

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
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(from),
    value: `${y}-${String(m).padStart(2, "0")}`
  };
}

async function loadData(from: string, to: string, channel: string | null) {
  const supabase = createSupabaseAdminClient();
  const args = { p_from: from, p_to: to, p_channel: channel };

  const [funnel, summary, reasons, skus, disputes, batches] = await Promise.all([
    supabase.rpc("oraculo_returns_funnel", args),
    supabase.rpc("oraculo_returns_summary", args),
    supabase.rpc("oraculo_returns_by_reason", args),
    supabase.rpc("oraculo_returns_by_sku", { ...args, p_limit: 25 }),
    supabase.rpc("oraculo_returns_disputes", args),
    supabase
      .from("oraculo_returns_upload_batches")
      .select("id, file_name, uploaded_at, sheet_names, rows_read, rows_inserted, rows_rejected, notes")
      .order("uploaded_at", { ascending: false })
      .limit(1)
  ]);

  return {
    funnel: (funnel.data ?? []) as FunnelRow[],
    summary: (summary.data ?? []) as SummaryRow[],
    reasons: (reasons.data ?? []) as ReasonRow[],
    skus: (skus.data ?? []) as SkuRow[],
    disputes: (disputes.data ?? []) as DisputeRow[],
    batch: ((batches.data ?? [])[0] ?? null) as Batch | null
  };
}

const STAGE_META: Record<string, { label: string; hint: string; tone: FunnelStage["tone"]; nested?: boolean }> = {
  abertas: {
    label: "Devoluções abertas",
    hint: "tudo que o comprador solicitou no período",
    tone: "neutral"
  },
  aguardando_decisao: {
    label: "Aguardando decisão",
    hint: "ainda vão virar concedido ou recusado",
    tone: "warn"
  },
  cancelada: {
    label: "Cancelada",
    hint: "comprador desistiu ou o prazo expirou — nunca virou reembolso",
    tone: "neutral"
  },
  reembolso_recusado: {
    label: "Reembolso recusado",
    hint: "dinheiro retido — vitória financeira, não necessariamente com o cliente",
    tone: "good"
  },
  reembolso_concedido: {
    label: "Reembolso concedido",
    hint: "pagamos de volta ao comprador",
    tone: "bad"
  },
  produto_retorna: {
    label: "…com produto retornando",
    hint: "exclui refund only, onde a mercadoria não volta",
    tone: "bad",
    nested: true
  },
  nf_devolucao_confere: {
    label: "…NF de devolução confere",
    hint: "entrou na Olist, valor e quantidade batem",
    tone: "good",
    nested: true
  },
  sem_nf_devolucao: {
    label: "…SEM NF de devolução",
    hint: "produto voltou e não deu entrada — é aqui que há dinheiro a recuperar",
    tone: "bad",
    nested: true
  }
};

function buildStages(rows: FunnelRow[]): FunnelStage[] {
  const totals = new Map<string, { count: number; amount: number }>();
  for (const row of rows) {
    const acc = totals.get(row.stage) ?? { count: 0, amount: 0 };
    acc.count += Number(row.returns_count ?? 0);
    acc.amount += Number(row.amount ?? 0);
    totals.set(row.stage, acc);
  }
  return Object.entries(STAGE_META)
    .map(([key, meta]) => {
      const acc = totals.get(key);
      return {
        key,
        label: meta.label,
        hint: meta.hint,
        tone: meta.tone,
        nested: meta.nested,
        count: acc?.count ?? 0,
        amount: acc?.amount ?? null
      };
    })
    .filter((stage) => stage.count > 0 || stage.key === "abertas");
}

export default async function DevolucoesPage({
  searchParams
}: {
  searchParams: Promise<{ mes?: string; canal?: string }>;
}) {
  await requireCurrentUser();
  const params = await searchParams;
  const alertCount = await loadActionableAlertCount();
  const window = monthWindow(params.mes);
  const channel = params.canal && params.canal !== "todos" ? params.canal : null;

  const { funnel, summary, reasons, skus, disputes, batch } = await loadData(
    window.from,
    window.to,
    channel
  );

  const stages = buildStages(funnel);
  const totalReturns = summary.reduce((sum, r) => sum + Number(r.returns_total ?? 0), 0);
  const totalRefund = summary.reduce((sum, r) => sum + Number(r.refund_amount ?? 0), 0);
  const totalSemNf = summary.reduce((sum, r) => sum + Number(r.sem_nf_count ?? 0), 0);
  const totalSemNfAmount = summary.reduce((sum, r) => sum + Number(r.sem_nf_amount ?? 0), 0);
  const totalCostLost = skus.reduce((sum, r) => sum + Number(r.cost_lost ?? 0), 0);

  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    return monthWindow(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  });

  const channels = ["todos", "shopee", "tiktok", "mercadolivre"];
  const link = (mes: string, canal: string) => `/devolucoes?mes=${mes}&canal=${canal}`;
  const currentChannel = params.canal ?? "todos";

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Devoluções</h1>
          <p>Funil por canal, cruzado com a NF de devolução da Olist</p>
        </div>
      </header>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Período e canal</p>
          <h2>{window.label}</h2>
        </div>
        <div className="filter-row">
          {months.map((m) => (
            <a
              key={m.value}
              href={link(m.value, currentChannel)}
              className={m.value === window.value ? "chip chip-active" : "chip"}
            >
              {m.label}
            </a>
          ))}
        </div>
        <div className="filter-row">
          {channels.map((c) => (
            <a
              key={c}
              href={link(window.value, c)}
              className={c === currentChannel ? "chip chip-active" : "chip"}
            >
              {c === "todos" ? "Todos os canais" : CHANNEL_LABEL[c] ?? c}
            </a>
          ))}
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric accent-blue">
          <span className="label">Devoluções abertas</span>
          <strong>{count(totalReturns)}</strong>
          <small>solicitadas no período</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Estornado</span>
          <strong>{moneyShort(totalRefund)}</strong>
          <small>somando todos os estágios</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Sem NF de devolução</span>
          <strong>{count(totalSemNf)}</strong>
          <small>{moneyShort(totalSemNfAmount)} sem entrada na Olist</small>
        </article>
        <article className="metric accent-violet">
          <span className="label">Custo do produto perdido</span>
          <strong>{moneyShort(totalCostLost)}</strong>
          <small>top 25 SKUs, a custo unitário</small>
        </article>
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Funil</p>
          <h2>Do pedido de devolução ao dinheiro</h2>
        </div>
        <p className="muted">
          Os quatro estágios de decisão (aguardando, cancelada, recusado, concedido) somam o topo —
          toda devolução está em exatamente um deles.
          Os estágios recuados e tracejados são recorte do estágio acima, não uma nova fatia.
        </p>
        <ReturnsFunnel stages={stages} />
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Por canal</p>
          <h2>Onde estão as devoluções</h2>
        </div>
        <p className="muted">
          Os canais têm ordens de grandeza diferentes — em julho a Shopee teve ~2.700 devoluções,
          o TikTok 1.728 e o Mercado Livre 4. Volume baixo no ML é volume de venda menor no canal,
          não qualidade melhor.
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
                <th className="numeric">Sem NF de venda</th>
                <th className="numeric">Sem NF de devolução</th>
                <th className="numeric">R$ sem NF</th>
                <th className="numeric">Divergências</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 ? (
                <tr>
                  <td colSpan={9}>Nenhuma devolução no período.</td>
                </tr>
              ) : (
                summary.map((row) => (
                  <tr key={row.channel}>
                    <td>{CHANNEL_LABEL[row.channel] ?? row.channel}</td>
                    <td className="numeric">{count(row.returns_total)}</td>
                    <td className="numeric">{count(row.returns_loss)}</td>
                    <td className="numeric">{count(row.units)}</td>
                    <td className="numeric">{money(row.refund_amount)}</td>
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

      <section className="settings-grid">
        <article className="panel">
          <div className="section-head">
            <p className="eyebrow">Motivos</p>
            <h2>Por que devolveram</h2>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Motivo</th>
                  <th className="numeric">Devoluções</th>
                  <th className="numeric">Estornado</th>
                </tr>
              </thead>
              <tbody>
                {reasons.length === 0 ? (
                  <tr>
                    <td colSpan={3}>Sem dados no período.</td>
                  </tr>
                ) : (
                  reasons.map((row) => (
                    <tr key={row.reason_group}>
                      <td>{REASON_LABEL[row.reason_group] ?? row.reason_group}</td>
                      <td className="numeric">{count(row.returns_count)}</td>
                      <td className="numeric">{money(row.refund_amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
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
                {disputes.length === 0 ? (
                  <tr>
                    <td colSpan={4}>Nenhuma disputa no período.</td>
                  </tr>
                ) : (
                  disputes.map((row) => (
                    <tr key={`${row.channel}-${row.outcome}`}>
                      <td>{CHANNEL_LABEL[row.channel] ?? row.channel}</td>
                      <td>{DISPUTE_LABEL[row.outcome] ?? row.outcome}</td>
                      <td className="numeric">{count(row.returns_count)}</td>
                      <td className="numeric">{money(row.amount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>
      </section>

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
              {skus.length === 0 ? (
                <tr>
                  <td colSpan={8}>Sem dados no período.</td>
                </tr>
              ) : (
                skus.map((row, index) => (
                  <tr key={`${row.sku ?? "sem-sku"}-${index}`}>
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
        {batch ? (
          <p className="muted">
            Último lote: <strong>{batch.file_name}</strong> · {dateTime(batch.uploaded_at)} ·{" "}
            {count(batch.rows_read)} lidas, {count(batch.rows_inserted)} gravadas,{" "}
            {count(batch.rows_rejected)} descartadas
            {batch.notes ? ` · ${batch.notes}` : ""}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Como ler</p>
          <h2>Ressalvas</h2>
        </div>
        <ul className="muted">
          <li>
            <strong>É distribuição de estado, não coorte.</strong> As devoluções aguardando decisão
            ainda vão virar concedido ou recusado — no mês corrente o topo sempre parece inflado
            em relação ao fundo. Compare meses fechados.
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
            <strong>Reembolso recusado é vitória financeira</strong>, não necessariamente vitória
            com o cliente — pode virar disputa ou má avaliação depois.
          </li>
        </ul>
      </section>
    </AppShell>
  );
}
