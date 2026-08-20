import Link from "next/link";
import { requireTabAccess } from "../../lib/auth/access";
import { NoAccess } from "../components/no-access";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { SortableTable } from "../components/sortable-table";
import { ForecastChart } from "../components/forecast-chart";
import { formatBrDate } from "../../lib/date";
import { HINTS } from "../../lib/column-hints";
import { asTargetWeek, loadForecastView, type ForecastSku } from "./data";

export const dynamic = "force-dynamic";

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function count(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n(value));
}

function dec(value: number | null | undefined, digits = 1) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(n(value));
}

function pct(value: number | null | undefined) {
  return `${dec(value, 1)}%`;
}

function range(low: number | null | undefined, high: number | null | undefined) {
  return `${count(low)} – ${count(high)}`;
}

// Tendência como variação percentual: 1.043 → "+4,3%".
function trendPct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const delta = (value - 1) * 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${dec(delta, 1)}%`;
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const WEEKDAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

const STOCK_STATUS: Record<ForecastSku["stock_status"], { label: string; badge: string; rank: number }> = {
  ruptura: { label: "Ruptura", badge: "status-pill signal-danger", rank: 0 },
  risco_alto: { label: "Risco alto", badge: "status-pill signal-danger", rank: 1 },
  risco: { label: "Risco", badge: "status-pill signal-warning", rank: 2 },
  atencao: { label: "Atenção", badge: "status-pill signal-warning", rank: 3 },
  ok: { label: "OK", badge: "status-pill signal-good", rank: 4 },
  sem_estoque_mapeado: { label: "Sem estoque mapeado", badge: "status-pill signal-muted", rank: 5 }
};

export default async function PrevisaoDeVendasPage({
  searchParams
}: {
  searchParams?: Promise<{ semana?: string }>;
}) {
  const params = await searchParams;
  const target = asTargetWeek(params?.semana);
  const [{ allowed }, alertCount, view] = await Promise.all([
    requireTabAccess("previsao-de-vendas"),
    loadActionableAlertCount(),
    loadForecastView(target)
  ]);
  if (!allowed) return <NoAccess tab="previsao-de-vendas" />;

  const week = view.week;
  const targetStart = week?.target_week_start ?? null;
  const targetEnd = targetStart ? addDays(targetStart, 6) : null;
  const hasForecast = week?.forecast_units != null;

  const riskCount = view.skus.filter((sku) =>
    sku.stock_status === "ruptura" || sku.stock_status === "risco_alto" || sku.stock_status === "risco"
  ).length;
  const purchaseTotal = view.skus.reduce((sum, sku) => sum + n(sku.purchase_suggestion), 0);

  // Acurácia recente: erro absoluto médio do backtest (previsão feita "como se
  // fosse na época" contra o realizado).
  const backtestErrors = view.backtest
    .map((row) => (row.error_pct == null ? null : Math.abs(row.error_pct)))
    .filter((value): value is number => value != null);
  const meanAbsError = backtestErrors.length > 0
    ? backtestErrors.reduce((sum, value) => sum + value, 0) / backtestErrors.length
    : null;
  const withinCount = view.backtest.filter((row) => row.within_range).length;

  const details = week?.weeks_detail ?? [];

  const exportHref = targetStart
    ? `/previsao-de-vendas/export?semana=${targetStart}`
    : "/previsao-de-vendas/export";

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Previsão de Vendas</h1>
          <p>
            {targetStart
              ? `Semana de ${formatBrDate(targetStart)} a ${formatBrDate(targetEnd)} · unidades de marketplaces (Olist), sem atacado B2B`
              : "Previsão semanal de unidades para planejamento de estoque"}
          </p>
        </div>
        <form className="filter-row filter-form" method="get">
          <label>
            <span>Semana (qualquer dia dela)</span>
            <input type="date" name="semana" defaultValue={params?.semana ?? ""} />
          </label>
          <button type="submit">Aplicar</button>
          <Link className="button-link" href={exportHref}>Exportar</Link>
        </form>
      </header>

      {week?.calc_note && (
        <section className="status-alerts">
          <div className="status-alert">{week.calc_note}</div>
        </section>
      )}

      <section className="metric-grid metric-grid-seven">
        <article className="metric accent-yellow">
          <span className="label">Previsão da semana</span>
          <strong>{hasForecast ? `${count(week?.forecast_units)} un` : "—"}</strong>
          <small>{hasForecast ? `Faixa ${range(week?.forecast_low, week?.forecast_high)}` : "Sem dados suficientes"}</small>
        </article>
        <article className="metric accent-violet">
          <span className="label">Tendência</span>
          <strong>{trendPct(week?.trend)}</strong>
          <small>
            {week?.trend_raw != null && week?.trend != null && Math.abs(week.trend_raw - week.trend) > 0.0001
              ? `Cru ${trendPct(week.trend_raw)} — limitado a ±30%`
              : week?.trend_raw != null
                ? "Média 4 semanas vs 4 anteriores"
                : "Sem semanas anteriores suficientes — neutra"}
          </small>
        </article>
        <article className="metric accent-blue">
          <span className="label">{`Média ${week?.n_base ?? 0} semana${(week?.n_base ?? 0) === 1 ? "" : "s"}`}</span>
          <strong>{week?.base_avg_units != null ? `${count(week.base_avg_units)} un` : "—"}</strong>
          <small>
            {week?.prev_avg_units != null
              ? `${week?.n_prev ?? 0} anteriores: ${count(week.prev_avg_units)} un`
              : `${week?.n_base ?? 0} semana(s) completa(s) na base`}
          </small>
        </article>
        <article className={`metric ${riskCount > 0 ? "accent-red" : "accent-green"}`}>
          <span className="label">SKUs em risco</span>
          <strong>{count(riskCount)}</strong>
          <small>Estoque abaixo do cenário central · {count(view.skus.length)} SKUs previstos</small>
        </article>
        <article className="metric accent-green">
          <span className="label">Acurácia recente</span>
          <strong>{meanAbsError != null ? `±${dec(meanAbsError, 1)}%` : "—"}</strong>
          <small>
            {view.backtest.length > 0
              ? `Erro médio · ${withinCount} de ${view.backtest.length} semanas na faixa`
              : "Backtest indisponível"}
          </small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Sugestão de compra</span>
          <strong>{count(purchaseTotal)} un</strong>
          <small>Soma dos SKUs abaixo do cenário alto</small>
        </article>
        <article className="metric metric-text">
          <span className="label">Atacado B2B (fora da previsão)</span>
          <strong>{count(view.offmarketUnitsBase)} un</strong>
          <small>{`Pedidos sem canal nas ${week?.n_base ?? 0} semanas-base`}</small>
        </article>
      </section>

      <section className="panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Unidades por dia</p>
            <h2>Histórico e previsão</h2>
          </div>
          <span className="pill">{`${details.length} semana${details.length === 1 ? "" : "s"} completa${details.length === 1 ? "" : "s"} + 7 dias previstos`}</span>
        </div>
        <ForecastChart
          history={view.history.map((point) => ({ date: point.date, units: point.units }))}
          lastCompleteWeekEnd={week?.last_complete_week ? addDays(week.last_complete_week, 6) : null}
          forecast={view.daily.map((day) => ({
            date: day.day_date,
            units: day.forecast_units,
            low: day.forecast_low,
            high: day.forecast_high
          }))}
        />
      </section>

      {view.daily.length > 0 && (
        <section className="panel product-panel">
          <div className="sku-toolbar">
            <div>
              <p className="eyebrow">Curva da semana prevista</p>
              <h2>Previsão dia a dia</h2>
            </div>
          </div>
          <SortableTable
            columns={[
              { label: "Dia" },
              { label: "Peso do dia", numeric: true, hint: HINTS.prevPeso },
              { label: "Média histórica", numeric: true, hint: HINTS.prevPeso },
              { label: "Previsão", numeric: true, hint: HINTS.prevPrevisao },
              { label: "Faixa", numeric: true, hint: HINTS.prevFaixa }
            ]}
            initialSort={0}
            initialDir="asc"
            rows={view.daily.map((day) => [
              {
                text: `${WEEKDAYS[day.isodow - 1]} ${formatBrDate(day.day_date)}`,
                sort: day.isodow
              },
              { text: pct(day.weight_pct), sort: n(day.weight_pct) },
              { text: count(day.avg_units_dow), sort: n(day.avg_units_dow) },
              { text: count(day.forecast_units), sort: n(day.forecast_units) },
              { text: range(day.forecast_low, day.forecast_high), sort: n(day.forecast_units) }
            ])}
          />
        </section>
      )}

      {view.channels.length > 0 && (
        <section className="panel product-panel">
          <div className="sku-toolbar">
            <div>
              <p className="eyebrow">Quebra por canal</p>
              <h2>Previsão por canal de venda</h2>
            </div>
            <div className="sku-actions">
              <span>{`Share das ${week?.n_base ?? 0} semanas-base aplicado ao total`}</span>
            </div>
          </div>
          <SortableTable
            columns={[
              { label: "Canal" },
              { label: "Unidades na base", numeric: true },
              { label: "Média/semana", numeric: true, hint: HINTS.prevMediaSemana },
              { label: "Share", numeric: true },
              { label: "Tendência do canal", numeric: true, hint: HINTS.prevTendencia },
              { label: "Previsão", numeric: true, hint: HINTS.prevPrevisao },
              { label: "Faixa", numeric: true, hint: HINTS.prevFaixa }
            ]}
            initialSort={5}
            initialDir="desc"
            rows={view.channels.map((channel) => [
              { text: channel.channel_name, sort: channel.channel_name },
              { text: count(channel.units_base), sort: n(channel.units_base) },
              { text: count(channel.avg_units_week), sort: n(channel.avg_units_week) },
              { text: pct(channel.share_pct), sort: n(channel.share_pct) },
              {
                text: channel.channel_trend != null ? trendPct(channel.channel_trend) : "—",
                sort: channel.channel_trend ?? null
              },
              { text: count(channel.forecast_units), sort: n(channel.forecast_units) },
              { text: range(channel.forecast_low, channel.forecast_high), sort: n(channel.forecast_units) }
            ])}
          />
        </section>
      )}

      {view.skus.length > 0 && (
        <section className="panel product-panel">
          <div className="sku-toolbar">
            <div>
              <p className="eyebrow">Planejamento de estoque</p>
              <h2>Previsão por SKU</h2>
            </div>
            <div className="sku-actions">
              <span>Todos os marketplaces somados (o cache de SKU não separa canal)</span>
            </div>
          </div>
          <SortableTable
            columns={[
              { label: "Produto" },
              { label: "SKU" },
              { label: "Média/semana", numeric: true, hint: HINTS.prevMediaSemana },
              { label: "Previsão", numeric: true, hint: HINTS.prevPrevisao },
              { label: "Faixa", numeric: true, hint: HINTS.prevFaixa },
              { label: "Estoque disponível", numeric: true },
              { label: "Cobertura", numeric: true, hint: HINTS.prevCobertura },
              { label: "Situação", numeric: true, hint: HINTS.prevStatus },
              { label: "Sugestão de compra", numeric: true, hint: HINTS.prevSugestao }
            ]}
            initialSort={3}
            initialDir="desc"
            rows={view.skus.map((sku) => {
              const status = STOCK_STATUS[sku.stock_status];
              return [
                {
                  text: sku.product_name ?? "Sem nome",
                  sort: sku.product_name ?? null,
                  href: `/skus?source=olist&sku=${encodeURIComponent(sku.sku)}`,
                  subtitle: sku.is_new
                    ? `Novo — ${sku.weeks_considered} semana(s) de histórico`
                    : undefined
                },
                { text: sku.sku, sort: sku.sku },
                { text: dec(sku.avg_units_week, 1), sort: n(sku.avg_units_week) },
                { text: dec(sku.forecast_units, 1), sort: n(sku.forecast_units) },
                { text: range(sku.forecast_low, sku.forecast_high), sort: n(sku.forecast_units) },
                {
                  text: sku.available_stock != null ? count(sku.available_stock) : "—",
                  sort: sku.available_stock ?? null
                },
                {
                  text: sku.coverage_weeks != null ? `${dec(sku.coverage_weeks, 1)} sem` : "—",
                  sort: sku.coverage_weeks ?? null
                },
                { text: status.label, sort: status.rank, badge: status.badge },
                { text: count(sku.purchase_suggestion), sort: n(sku.purchase_suggestion) }
              ];
            })}
          />
        </section>
      )}

      {details.length > 0 && (
        <section className="panel product-panel">
          <div className="sku-toolbar">
            <div>
              <p className="eyebrow">Auditoria do cálculo</p>
              <h2>Semanas usadas na previsão</h2>
            </div>
            <div className="sku-actions">
              <span>Base = 4 mais recentes · Anteriores = referência da tendência</span>
            </div>
          </div>
          <SortableTable
            columns={[
              { label: "Semana" },
              { label: "Papel" },
              { label: "Unidades", numeric: true },
              { label: "Pedidos", numeric: true },
              { label: "Cobertura de itens", numeric: true, hint: HINTS.prevSemanaBase }
            ]}
            initialSort={0}
            initialDir="desc"
            rows={details.map((detail) => [
              {
                text: `${formatBrDate(detail.week_start)} a ${formatBrDate(addDays(detail.week_start, 6))}`,
                sort: detail.week_start
              },
              {
                text: detail.is_base ? "Base" : "Anterior",
                sort: detail.is_base ? 0 : 1,
                badge: detail.is_base ? "status-pill signal-good" : "status-pill signal-muted"
              },
              { text: count(detail.units), sort: n(detail.units) },
              { text: count(detail.orders), sort: n(detail.orders) },
              {
                text: detail.items_coverage_pct != null ? pct(detail.items_coverage_pct) : "—",
                sort: detail.items_coverage_pct ?? null,
                badge:
                  detail.items_coverage_pct != null && detail.items_coverage_pct < 90
                    ? "status-pill signal-warning"
                    : undefined
              }
            ])}
          />
        </section>
      )}

      {view.backtest.length > 0 && (
        <section className="panel product-panel">
          <div className="sku-toolbar">
            <div>
              <p className="eyebrow">Prova do método</p>
              <h2>Backtest: previsão vs realizado</h2>
            </div>
            <div className="sku-actions">
              <span>Cada semana prevista só com os dados que existiam antes dela</span>
            </div>
          </div>
          <SortableTable
            columns={[
              { label: "Semana" },
              { label: "Previsão", numeric: true },
              { label: "Faixa", numeric: true },
              { label: "Realizado", numeric: true },
              { label: "Erro", numeric: true },
              { label: "Na faixa?", numeric: true }
            ]}
            initialSort={0}
            initialDir="desc"
            rows={view.backtest.map((row) => [
              {
                text: `${formatBrDate(row.week_start)} a ${formatBrDate(addDays(row.week_start, 6))}`,
                sort: row.week_start
              },
              { text: count(row.forecast_units), sort: n(row.forecast_units) },
              { text: range(row.forecast_low, row.forecast_high), sort: n(row.forecast_units) },
              { text: count(row.realized_units), sort: n(row.realized_units) },
              {
                text: row.error_pct != null ? `${row.error_pct > 0 ? "+" : ""}${dec(row.error_pct, 1)}%` : "—",
                sort: row.error_pct ?? null
              },
              {
                text: row.within_range ? "Sim" : "Não",
                sort: row.within_range ? 1 : 0,
                badge: row.within_range ? "status-pill signal-good" : "status-pill signal-warning"
              }
            ])}
          />
        </section>
      )}
    </AppShell>
  );
}
