export const FULL_WORKFLOW_STATUSES = Object.freeze([
  "rascunho",
  "aguardando_logistica",
  "aguardando_criador",
  "aguardando_agendamento",
  "monitorando",
  "concluido",
  "cancelado",
  "excecao"
]);

export const FULL_EXTERNAL_STATUSES = Object.freeze([
  "nao_vinculado",
  "agendado",
  "coletado",
  "em_transito",
  "recebendo",
  "recebido",
  "recebido_com_divergencia",
  "cancelado",
  "desconhecido"
]);

const EXTERNAL_RANK = Object.freeze({
  nao_vinculado: 0,
  agendado: 1,
  coletado: 2,
  em_transito: 3,
  recebendo: 4,
  recebido: 5,
  recebido_com_divergencia: 5,
  cancelado: 6,
  desconhecido: -1
});

export function nextBusinessDay(dateOnly) {
  const date = new Date(`${dateOnly}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Data inválida.");
  do date.setUTCDate(date.getUTCDate() + 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

export function canTransitionFull(from, to) {
  const allowed = {
    rascunho: ["aguardando_logistica", "cancelado"],
    aguardando_logistica: ["aguardando_criador", "cancelado", "excecao"],
    aguardando_criador: ["aguardando_logistica", "aguardando_agendamento", "cancelado", "excecao"],
    aguardando_agendamento: ["aguardando_logistica", "monitorando", "cancelado", "excecao"],
    monitorando: ["concluido", "cancelado", "excecao"],
    excecao: ["aguardando_logistica", "aguardando_agendamento", "monitorando", "cancelado"],
    concluido: [],
    cancelado: []
  };
  return Boolean(allowed[from]?.includes(to));
}

export function assertFullTransition(from, to) {
  if (!canTransitionFull(from, to)) {
    throw new Error(`Transição inválida do Full: ${from} → ${to}.`);
  }
}

export function productionStatus(lines) {
  if (!lines.length || lines.every((line) => line.readyQty === 0 && line.shortageQty === 0)) {
    return "nao_iniciada";
  }
  if (lines.some((line) => line.shortageQty > 0)) return "com_falta";
  if (lines.every((line) => line.readyQty >= line.requiredQty)) return "pronta";
  return "em_producao";
}

export function shouldAcceptExternalStatus(current, next) {
  if (!(current in EXTERNAL_RANK) || !(next in EXTERNAL_RANK)) return false;
  if (next === "desconhecido") return current === "nao_vinculado" || current === "agendado";
  if (current === "desconhecido") return true;
  if (current === "cancelado" || current === "recebido" || current === "recebido_com_divergencia") {
    return false;
  }
  return EXTERNAL_RANK[next] >= EXTERNAL_RANK[current];
}

export function fullNumber(value) {
  return `FULL-${String(value).padStart(6, "0")}`;
}
