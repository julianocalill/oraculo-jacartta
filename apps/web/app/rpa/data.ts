// Leitura da aba RPA — Afiliados Shopee.
//
// Tudo aqui usa o cliente service_role, e não o de usuário como o resto do app.
// Não é atalho: as três tabelas de RPA guardam CPF, data de nascimento e
// endereço de centenas de pessoas físicas e por isso não têm grant para
// `authenticated` (ver migration 20260812170000). A autorização acontece em
// TypeScript, com `requireTabAccess("rpa")` na página, antes de chamar
// qualquer coisa deste arquivo.

import { createSupabaseAdminClient } from "../../lib/supabase/admin";

export type RpaIssuerRow = {
  id: string;
  razao_social: string;
  cnpj: string;
  endereco: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
  inscricao_municipal: string | null;
  descricao_servico: string;
};

export type RpaBatchRow = {
  id: string;
  issuer_id: string;
  loja: string;
  competencia: string;
  file_name: string;
  status: "rascunho" | "aprovado";
  aplica_inss: boolean;
  aplica_irrf: boolean;
  aplica_iss: boolean;
  iss_rate: number;
  piso_cents: number;
  irrf_table_version: string | null;
  rows_read: number;
  rows_rejected: number;
  errors: { row: number; field: string; message: string }[];
  total_bruto_cents: number;
  total_inss_cents: number;
  total_irrf_cents: number;
  total_iss_cents: number;
  total_liquido_cents: number;
  emitidos: number;
  uploaded_at: string;
  approved_at: string | null;
  generated_at: string | null;
};

export type RpaItemRow = {
  id: number;
  numero: number;
  recibo_numero: string;
  nome: string;
  cpf: string;
  cpf_valido: boolean;
  nascimento: string | null;
  email: string | null;
  telefone: string | null;
  endereco_raw: string | null;
  logradouro: string | null;
  numero_endereco: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  bruto_cents: number;
  inss_cents: number;
  irrf_cents: number;
  iss_cents: number;
  liquido_cents: number;
  emitido: boolean;
};

const ISSUER_FIELDS =
  "id, razao_social, cnpj, endereco, municipio, uf, cep, inscricao_municipal, descricao_servico";

const BATCH_FIELDS =
  "id, issuer_id, loja, competencia, file_name, status, aplica_inss, aplica_irrf, aplica_iss, " +
  "iss_rate, piso_cents, irrf_table_version, rows_read, rows_rejected, errors, " +
  "total_bruto_cents, total_inss_cents, total_irrf_cents, total_iss_cents, total_liquido_cents, " +
  "emitidos, uploaded_at, approved_at, generated_at";

const ITEM_FIELDS =
  "id, numero, recibo_numero, nome, cpf, cpf_valido, nascimento, email, telefone, endereco_raw, " +
  "logradouro, numero_endereco, complemento, bairro, cidade, uf, cep, bruto_cents, inss_cents, " +
  "irrf_cents, iss_cents, liquido_cents, emitido";

export async function loadIssuers(): Promise<RpaIssuerRow[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("oraculo_rpa_issuers")
    .select(ISSUER_FIELDS)
    .order("razao_social");
  if (error) throw new Error(`emitentes: ${error.message}`);
  return (data ?? []) as RpaIssuerRow[];
}

export async function loadBatches(limit = 24): Promise<RpaBatchRow[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("oraculo_rpa_batches")
    .select(BATCH_FIELDS)
    .order("competencia", { ascending: false })
    .order("uploaded_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`lotes: ${error.message}`);
  return (data ?? []) as unknown as RpaBatchRow[];
}

export async function loadBatch(id: string): Promise<RpaBatchRow | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("oraculo_rpa_batches")
    .select(BATCH_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`lote: ${error.message}`);
  return (data as RpaBatchRow | null) ?? null;
}

/**
 * Itens do lote. PostgREST devolve no máximo 1.000 linhas por requisição
 * (armadilha já documentada no AGENTS.md) e um lote real tem 772 — está perto
 * demais do teto para confiar, então pagina explicitamente.
 */
export async function loadBatchItems(
  batchId: string,
  options: { onlyEmitidos?: boolean } = {}
): Promise<RpaItemRow[]> {
  const supabase = createSupabaseAdminClient();
  const PAGE = 1000;
  const rows: RpaItemRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from("oraculo_rpa_items")
      .select(ITEM_FIELDS)
      .eq("batch_id", batchId)
      .order("numero")
      .range(from, from + PAGE - 1);
    if (options.onlyEmitidos) query = query.eq("emitido", true);
    const { data, error } = await query;
    if (error) throw new Error(`itens do lote: ${error.message}`);
    const page = (data ?? []) as unknown as RpaItemRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

export async function loadIssuer(id: string): Promise<RpaIssuerRow | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("oraculo_rpa_issuers")
    .select(ISSUER_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`emitente: ${error.message}`);
  return (data as RpaIssuerRow | null) ?? null;
}

/** Lojas já usadas, para o datalist do formulário de upload. */
export async function loadLojasConhecidas(): Promise<string[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("oraculo_rpa_batches").select("loja").limit(500);
  if (error) return [];
  return [...new Set((data ?? []).map((row) => row.loja as string))].sort();
}

/** "2026-07-01" -> "jul/2026", curto o bastante para caber na listagem. */
export function competenciaCurta(iso: string): string {
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const match = iso.match(/^(\d{4})-(\d{2})/);
  if (!match) return iso;
  return `${meses[Number(match[2]) - 1]}/${match[1]}`;
}

export function dateTimeBR(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}
