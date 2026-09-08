import type { FullChannel, FullExternalStatus, FullProductionStatus, FullWorkflowStatus } from "./data";

export const CHANNEL_LABEL: Record<FullChannel, string> = {
  mercadolivre: "Mercado Livre Full",
  shopee: "Shopee FBS",
  amazon: "Amazon Onsite"
};

export const WORKFLOW_LABEL: Record<FullWorkflowStatus, string> = {
  rascunho: "Rascunho",
  aguardando_logistica: "Aguardando logística",
  aguardando_criador: "Aguardando criador",
  aguardando_agendamento: "Aguardando agendamento",
  monitorando: "Monitorando",
  concluido: "Concluído",
  cancelado: "Cancelado",
  excecao: "Exceção"
};

export const PRODUCTION_LABEL: Record<FullProductionStatus, string> = {
  nao_iniciada: "Não iniciada",
  em_producao: "Em produção",
  pronta: "Pronta",
  com_falta: "Com falta"
};

export const EXTERNAL_LABEL: Record<FullExternalStatus, string> = {
  nao_vinculado: "Não vinculado",
  agendado: "Agendado",
  coletado: "Coletado",
  em_transito: "Em trânsito",
  recebendo: "Recebendo",
  recebido: "Recebido",
  recebido_com_divergencia: "Recebido com divergência",
  cancelado: "Cancelado externamente",
  desconhecido: "Status desconhecido"
};

export function fullCode(number: number) {
  return `FULL-${String(number).padStart(6, "0")}`;
}
