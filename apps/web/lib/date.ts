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

/** Data de hoje (YYYY-MM-DD) em America/Sao_Paulo. */
export function getSaoPauloToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Resolve o parâmetro ?mes=YYYY-MM da Agenda para os limites do mês.
 * Valor ausente ou inválido cai no mês corrente em America/Sao_Paulo.
 * `endExclusive` é o dia 1 do mês seguinte (janela [start, endExclusive)).
 */
export function parseMonthParam(mes?: string): {
  year: number;
  month: number;
  start: string;
  endExclusive: string;
} {
  let year: number;
  let month: number;

  if (mes && MONTH_PARAM.test(mes)) {
    year = Number(mes.slice(0, 4));
    month = Number(mes.slice(5, 7));
  } else {
    const today = getSaoPauloToday();
    year = Number(today.slice(0, 4));
    month = Number(today.slice(5, 7));
  }

  const mm = String(month).padStart(2, "0");
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    year,
    month,
    start: `${year}-${mm}-01`,
    endExclusive: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`
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
