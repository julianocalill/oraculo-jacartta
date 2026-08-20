// Camada de dados da Previsão de Vendas.
//
// Tudo vem das RPCs oraculo_sales_forecast_* (migration 20260819210000): as
// fórmulas vivem no banco, num lugar só; página e export consomem o MESMO
// builder (buildForecastView) — export nunca recalcula.
//
// As RPCs são globais (mesmo resultado para todo usuário) e mudam no ritmo dos
// caches horários, então 5min de unstable_cache compartilhado basta.
// unstable_cache não pode ler cookies(), por isso o client aqui é o admin.

import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

export type WeekDetail = {
  week_start: string;
  units: number;
  orders: number;
  items_coverage_pct: number | null;
  is_base: boolean;
};

export type ForecastWeek = {
  target_week_start: string;
  anchor_date: string;
  last_complete_week: string | null;
  n_base: number;
  n_prev: number;
  base_avg_units: number | null;
  prev_avg_units: number | null;
  trend_raw: number | null;
  trend: number | null;
  cv: number | null;
  forecast_units: number | null;
  forecast_low: number | null;
  forecast_high: number | null;
  weeks_detail: WeekDetail[] | null;
  calc_note: string | null;
};

export type ForecastDay = {
  day_date: string;
  isodow: number;
  weight_pct: number;
  avg_units_dow: number;
  forecast_units: number;
  forecast_low: number;
  forecast_high: number;
};

export type ForecastChannel = {
  channel_name: string;
  units_base: number;
  avg_units_week: number;
  share_pct: number;
  channel_trend: number | null;
  forecast_units: number;
  forecast_low: number;
  forecast_high: number;
};

export type ForecastSku = {
  sku: string;
  product_name: string | null;
  weeks_with_sales: number;
  weeks_considered: number;
  is_new: boolean;
  units_base: number;
  avg_units_week: number;
  forecast_units: number;
  forecast_low: number;
  forecast_high: number;
  available_stock: number | null;
  coverage_weeks: number | null;
  stock_status:
    | "sem_estoque_mapeado"
    | "ruptura"
    | "risco_alto"
    | "risco"
    | "atencao"
    | "ok";
  purchase_suggestion: number;
};

export type BacktestRow = {
  week_start: string;
  forecast_units: number;
  forecast_low: number;
  forecast_high: number;
  realized_units: number;
  error_pct: number | null;
  within_range: boolean;
};

export type DailyPoint = { date: string; units: number };

export type ForecastView = {
  week: ForecastWeek | null;
  daily: ForecastDay[];
  channels: ForecastChannel[];
  skus: ForecastSku[];
  backtest: BacktestRow[];
  // Série diária para o gráfico: marketplaces, do início da janela de 8
  // semanas até anchor-1 (dias após a última semana completa são a "semana em
  // andamento", ainda sujeitos a reescrita pelo importador).
  history: DailyPoint[];
  // Volume B2B (pedidos sem canal) nas semanas-base — fica FORA da previsão e
  // é exibido à parte para o número seguir auditável.
  offmarketUnitsBase: number;
};

type CacheRow = { order_date: string; channel_name: string; units: number };

async function loadForecastViewUncached(target: string | null): Promise<ForecastView> {
  const supabase = createSupabaseAdminClient();
  const args = { p_target_week_start: target };

  const [weekRes, dailyRes, channelsRes, skusRes, backtestRes] = await Promise.all([
    supabase.rpc("oraculo_sales_forecast_week", args),
    supabase.rpc("oraculo_sales_forecast_daily", args),
    supabase.rpc("oraculo_sales_forecast_channels", args),
    supabase.rpc("oraculo_sales_forecast_skus", args),
    supabase.rpc("oraculo_sales_forecast_backtest", { p_weeks: 4 })
  ]);

  for (const res of [weekRes, dailyRes, channelsRes, skusRes, backtestRes]) {
    if (res.error) throw res.error;
  }

  const week = ((weekRes.data ?? []) as ForecastWeek[])[0] ?? null;

  // Janela do gráfico: das 8 semanas do detalhe até o último dia com pedido.
  // ~60 dias × ~15 canais fica bem abaixo do corte de 1.000 linhas do
  // PostgREST; se um dia estourar, o gráfico perde a cauda — nada quebra.
  let history: DailyPoint[] = [];
  let offmarketUnitsBase = 0;
  const details = week?.weeks_detail ?? [];
  if (week && details.length > 0) {
    const from = details[0].week_start;
    const { data, error } = await supabase
      .from("oraculo_olist_qty_channel_daily_cache")
      .select("order_date, channel_name, units")
      .gte("order_date", from)
      .lte("order_date", week.anchor_date)
      .limit(1000);
    if (error) throw error;

    const baseWeeks = new Set(details.filter((d) => d.is_base).map((d) => d.week_start));
    const byDate = new Map<string, number>();
    for (const row of (data ?? []) as CacheRow[]) {
      if (row.channel_name === "Sem canal") {
        if (baseWeeks.has(weekStartOf(row.order_date))) {
          offmarketUnitsBase += row.units ?? 0;
        }
        continue;
      }
      byDate.set(row.order_date, (byDate.get(row.order_date) ?? 0) + (row.units ?? 0));
    }
    history = [...byDate.entries()]
      .map(([date, units]) => ({ date, units }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  return {
    week,
    daily: (dailyRes.data ?? []) as ForecastDay[],
    channels: (channelsRes.data ?? []) as ForecastChannel[],
    skus: (skusRes.data ?? []) as ForecastSku[],
    backtest: (backtestRes.data ?? []) as BacktestRow[],
    history,
    offmarketUnitsBase
  };
}

// Segunda-feira ISO da data (YYYY-MM-DD), sem depender de fuso: o truque do
// meio-dia UTC evita o off-by-one clássico (ver lib/date.ts).
function weekStartOf(isoDate: string) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  const dow = (date.getUTCDay() + 6) % 7; // 0 = segunda
  date.setUTCDate(date.getUTCDate() - dow);
  return date.toISOString().slice(0, 10);
}

// unstable_cache inclui os argumentos na chave: cada semana-alvo tem sua
// própria entrada de 5 minutos.
export const loadForecastView = unstable_cache(loadForecastViewUncached, ["sales-forecast"], {
  revalidate: 300
});

export function asTargetWeek(value: string | undefined | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return null;
  // A RPC normaliza para a segunda-feira da semana (date_trunc), então
  // qualquer dia da semana desejada serve.
  return value;
}
