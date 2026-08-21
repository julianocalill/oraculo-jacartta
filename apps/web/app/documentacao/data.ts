import { createSupabaseUserClient } from "../../lib/supabase/user";

// Leitores do catálogo do Postgres (migration 20260821120000_oraculo_catalog_rpcs).
//
// A fonte da verdade do dicionário é o catálogo do banco, não um markdown
// paralelo: as migrations descrevem objetos que não existem em produção
// (product_fiscal_rules, a família tiktok_*), então um dicionário derivado
// delas nasceria mentindo. Aqui lemos o schema real.
//
// Sem cache de propósito: as consultas percorrem catálogos residentes em
// memória e as páginas já são force-dynamic. `unstable_cache` exigiria trocar
// o user client pelo admin (não pode chamar cookies()), pondo a service-role
// no caminho de leitura sem necessidade — e é o user client que valida o grant
// de verdade.

export type ObjectKind = "table" | "view" | "materialized_view";

export type CatalogObject = {
  object_name: string;
  object_kind: ObjectKind;
  domain_key: string;
  object_comment: string | null;
  column_count: number;
  documented_columns: number;
  approx_rows: number | null;
  total_bytes: number | null;
  readable_by_authenticated: boolean;
  has_rls: boolean;
};

export type CatalogColumn = {
  object_name: string;
  object_kind: ObjectKind;
  ordinal: number;
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  column_default: string | null;
  is_primary_key: boolean;
  references_to: string | null;
  column_comment: string | null;
};

export type CatalogFunction = {
  function_name: string;
  identity_arguments: string;
  arguments: string;
  return_type: string;
  volatility: string;
  is_security_definer: boolean;
  callable_by_authenticated: boolean;
  function_comment: string | null;
};

export async function loadCatalogObjects(): Promise<CatalogObject[]> {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase.rpc("oraculo_catalog_objects");
  if (error) {
    console.error("[documentacao] oraculo_catalog_objects", error.message);
    return [];
  }
  return (data ?? []) as CatalogObject[];
}

/**
 * Colunas de UM objeto. Nunca chame sem `objectName` nem sem `search`: o schema
 * inteiro tem 1.456 colunas e o PostgREST corta em 1.000.
 */
export async function loadCatalogColumns(objectName: string): Promise<CatalogColumn[]> {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase.rpc("oraculo_catalog_columns", {
    p_object: objectName,
    p_search: null,
    p_limit: 400
  });
  if (error) {
    console.error("[documentacao] oraculo_catalog_columns", error.message);
    return [];
  }
  return (data ?? []) as CatalogColumn[];
}

/** Busca de coluna por nome/descrição em todo o schema — "onde fica o faturamento?". */
export async function searchCatalogColumns(term: string, limit = 60): Promise<CatalogColumn[]> {
  if (term.trim().length < 3) return [];
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase.rpc("oraculo_catalog_columns", {
    p_object: null,
    p_search: term.trim(),
    p_limit: limit
  });
  if (error) {
    console.error("[documentacao] busca de colunas", error.message);
    return [];
  }
  return (data ?? []) as CatalogColumn[];
}

export async function loadCatalogFunctions(): Promise<CatalogFunction[]> {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase.rpc("oraculo_catalog_functions");
  if (error) {
    console.error("[documentacao] oraculo_catalog_functions", error.message);
    return [];
  }
  return (data ?? []) as CatalogFunction[];
}

export async function loadViewSql(objectName: string): Promise<string | null> {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase.rpc("oraculo_catalog_view_sql", { p_object: objectName });
  if (error) {
    console.error("[documentacao] oraculo_catalog_view_sql", error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

// --- formatação ------------------------------------------------------------

const numberFormat = new Intl.NumberFormat("pt-BR");

export function formatRows(rows: number | null) {
  if (rows == null || rows < 0) return "—";
  return numberFormat.format(Math.round(rows));
}

export function formatBytes(bytes: number | null) {
  if (bytes == null) return "—";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function kindLabel(kind: ObjectKind) {
  if (kind === "view") return "view";
  if (kind === "materialized_view") return "matview";
  return "tabela";
}

export function coveragePct(object: Pick<CatalogObject, "column_count" | "documented_columns">) {
  if (!object.column_count) return 0;
  return Math.round((object.documented_columns / object.column_count) * 100);
}
