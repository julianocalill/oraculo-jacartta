const BR_DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeZone: "America/Sao_Paulo"
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Formata datas para exibição em America/Sao_Paulo.
 *
 * Corrige o bug de fuso: `new Date("2026-06-01")` é interpretado como meia-noite
 * UTC, e ao renderizar em America/Sao_Paulo (UTC-3) volta para o dia anterior
 * (31/05). Datas "date-only" (YYYY-MM-DD) são ancoradas ao meio-dia UTC para que
 * o dia exibido seja sempre o dia correto, independente do fuso.
 *
 * Timestamps completos (com hora) são formatados como estão.
 */
/**
 * Retorna o intervalo (YYYY-MM-DD) do mês corrente em America/Sao_Paulo.
 * Usado para janelas fiscais ancoradas por data de emissão da NF.
 */
export function getSaoPauloMonthRange(now: Date = new Date()): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");

  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`
  };
}

export function formatBrDate(value: string | null | undefined, fallback = "-"): string {
  if (!value) return fallback;

  const raw = String(value).trim();
  if (!raw) return fallback;

  const anchored = DATE_ONLY.test(raw) ? `${raw}T12:00:00Z` : raw;
  const date = new Date(anchored);
  if (Number.isNaN(date.getTime())) return fallback;

  return BR_DATE_FORMAT.format(date);
}
