// Curadoria de apresentação do dicionário: nome legível de cada domínio e a
// classificação de sensibilidade de cada objeto.
//
// Vive em TS, não no banco, porque é decisão editorial da tela — o texto
// equivalente também entra como COMMENT ON TABLE, para o aviso aparecer dentro
// do Metabase e do DBeaver, não só aqui.

export type DomainKey =
  | "oraculo"
  | "olist"
  | "shopee"
  | "mercadolivre"
  | "importacao"
  | "logistica"
  | "bip"
  | "dim"
  | "outros";

export const DOMAINS: { key: DomainKey; label: string; description: string }[] = [
  {
    key: "oraculo",
    label: "Oráculo (camada unificada)",
    description:
      "Views, caches e parâmetros derivados que falam a mesma língua entre canais. É o que o BI deve consumir na maioria dos casos."
  },
  {
    key: "olist",
    label: "Olist (ERP)",
    description:
      "Pedidos, produtos, estoque e notas fiscais do ERP. É a fonte primária de receita: a Olist emite a NF de todos os canais."
  },
  {
    key: "shopee",
    label: "Shopee",
    description: "Pedidos, produtos, estoque SBS, take rate e Ads das 4 lojas, cada uma com seu app parceiro."
  },
  {
    key: "mercadolivre",
    label: "Mercado Livre",
    description: "Anúncios, variações, vendas diárias, estoque Full e a caixa de notificações."
  },
  {
    key: "importacao",
    label: "Importações",
    description: "Faturas de comex, itens, navios e posições AIS do rastreamento marítimo."
  },
  { key: "logistica", label: "Logística", description: "Paletes e itens de palete da expedição." },
  { key: "bip", label: "Bip (fulfillment)", description: "Eventos de bipagem da expedição." },
  { key: "dim", label: "Dimensões", description: "Tabelas de apoio: canais e status de pedido." },
  { key: "outros", label: "Outros", description: "Objetos que não se encaixam nos domínios acima." }
];

export function domainOf(domainKey: string): DomainKey {
  const known = DOMAINS.find((d) => d.key === domainKey);
  return known ? known.key : "outros";
}

export function domainLabel(domainKey: string) {
  return DOMAINS.find((d) => d.key === domainOf(domainKey))?.label ?? "Outros";
}

// --- sensibilidade ---------------------------------------------------------

export type Sensitivity = "credencial" | "dado_pessoal" | "interno" | "normal";

const CREDENCIAIS = new Set([
  "olist_oauth_tokens",
  "mercadolivre_tokens",
  "mercadolivre_oauth_states",
  "shopee_tokens",
  "shopee_app_config"
]);

const DADO_PESSOAL = new Set([
  "oraculo_rpa_issuers",
  "oraculo_rpa_batches",
  "oraculo_rpa_items",
  "shopee_order_escrow",
  "olist_orders",
  "olist_invoices",
  "shopee_orders",
  "oraculo_returns"
]);

const INTERNO = new Set([
  "oraculo_agenda_tasks",
  "oraculo_agenda_subtasks",
  "oraculo_agenda_task_participants"
]);

export function sensitivityOf(objectName: string): Sensitivity {
  if (CREDENCIAIS.has(objectName)) return "credencial";
  if (DADO_PESSOAL.has(objectName)) return "dado_pessoal";
  if (INTERNO.has(objectName)) return "interno";
  return "normal";
}

export const SENSITIVITY_LABEL: Record<Sensitivity, string> = {
  credencial: "Credenciais — nunca conecte o BI aqui",
  dado_pessoal: "Dado pessoal de terceiros — não use em relatório compartilhado",
  interno: "Uso interno — acesso por linha (RLS)",
  normal: ""
};

// Mostramos todos os objetos, inclusive os sensíveis. Esconder cria a pior
// situação: o Metabase lista o schema inteiro de qualquer jeito, e a pessoa
// encontra `oraculo_rpa_items` sozinha sem nenhum aviso. Documentar é o
// controle. A página nunca renderiza uma linha de dado — só nomes e descrições.

// --- camada ----------------------------------------------------------------

export type Layer = "bruto" | "derivado" | "cache" | "operacional";

export function layerOf(objectName: string, kind: string): Layer {
  if (/_(sync_runs|runs|queue|state|errors|oauth_states|notifications)$/.test(objectName)) {
    return "operacional";
  }
  if (objectName.endsWith("_cache")) return "cache";
  if (kind === "view" || kind === "materialized_view") return "derivado";
  if (objectName.startsWith("oraculo_")) return "derivado";
  return "bruto";
}

export const LAYER_LABEL: Record<Layer, string> = {
  bruto: "Dado bruto da fonte",
  derivado: "Camada derivada",
  cache: "Cache (refresh por cron)",
  operacional: "Operacional / sync"
};
