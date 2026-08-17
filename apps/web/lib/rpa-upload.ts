// Ingestão de um Relatório Mensal de Afiliados: parse -> lote -> itens.
//
// Ao contrário do upload de devoluções, aqui NÃO há upsert: cada arquivo é um
// lote novo e independente. O mesmo CPF pode aparecer em lotes de lojas
// diferentes na mesma competência, e são dois recibos legítimos — tomadores
// diferentes (CNPJs diferentes) pagaram valores diferentes ao mesmo afiliado.
//
// As retenções são calculadas no upload e gravadas na linha. O recibo é um
// documento: reabrir um lote de julho em dezembro tem que mostrar o que foi
// emitido em julho, não o que a tabela de dezembro diria.

import { createSupabaseAdminClient } from "./supabase/admin";
import {
  parseShopeeAffiliateCsv,
  type RpaImportError,
  type RpaRetentionConfig
} from "./rpa-import";
import { sumRetentions } from "@oraculo/domain/rpa.js";

const CHUNK_SIZE = 500; // PostgREST não gosta de payloads gigantes num único POST

export type RpaUploadReport = {
  batchId: string | null;
  fileName: string;
  competencia: string | null;
  rowsRead: number;
  rowsWritten: number;
  rowsRejected: number;
  emitidos: number;
  abaixoDoPiso: number;
  cpfInvalidos: number;
  errors: RpaImportError[];
  failure?: string;
};

export type RpaUploadInput = {
  file: File;
  issuerId: string;
  loja: string;
  config: RpaRetentionConfig;
  userId: string | null;
};

export async function importShopeeAffiliateReport({
  file,
  issuerId,
  loja,
  config,
  userId
}: RpaUploadInput): Promise<RpaUploadReport> {
  const supabase = createSupabaseAdminClient();
  const text = await file.text();
  const parsed = parseShopeeAffiliateCsv(text, config);

  const emitidos = parsed.rows.filter((row) => row.emitido);
  const totals = sumRetentions(
    emitidos.map((row) => ({
      grossCents: row.bruto_cents,
      inssCents: row.inss_cents,
      irrfCents: row.irrf_cents,
      issCents: row.iss_cents,
      netCents: row.liquido_cents
    }))
  );

  const report: RpaUploadReport = {
    batchId: null,
    fileName: file.name,
    competencia: parsed.competencia,
    rowsRead: parsed.rowsRead,
    rowsWritten: 0,
    rowsRejected: parsed.rowsRead - parsed.rows.length,
    emitidos: emitidos.length,
    abaixoDoPiso: parsed.rows.length - emitidos.length,
    cpfInvalidos: parsed.rows.filter((row) => !row.cpf_valido).length,
    errors: parsed.errors
  };

  if (parsed.rows.length === 0) {
    report.failure = "nenhuma linha válida encontrada — nada foi gravado";
    return report;
  }
  if (!parsed.competencia) {
    report.failure =
      'não foi possível ler a competência do arquivo (coluna "Mês de conclusão")';
    return report;
  }

  const { data: batch, error: batchError } = await supabase
    .from("oraculo_rpa_batches")
    .insert({
      issuer_id: issuerId,
      loja,
      competencia: parsed.competencia,
      file_name: file.name,
      aplica_inss: config.aplicaInss,
      aplica_irrf: config.aplicaIrrf,
      aplica_iss: config.aplicaIss,
      iss_rate: config.issRate,
      piso_cents: config.pisoCents,
      irrf_table_version: parsed.irrfTableVersion,
      rows_read: report.rowsRead,
      rows_rejected: report.rowsRejected,
      errors: parsed.errors,
      total_bruto_cents: totals.grossCents,
      total_inss_cents: totals.inssCents,
      total_irrf_cents: totals.irrfCents,
      total_iss_cents: totals.issCents,
      total_liquido_cents: totals.netCents,
      emitidos: emitidos.length,
      uploaded_by: userId
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    report.failure = `não foi possível registrar o lote: ${batchError?.message ?? "sem id"}`;
    return report;
  }
  report.batchId = batch.id as string;

  const competenciaTag = parsed.competencia.slice(0, 7); // 2026-07
  const items = parsed.rows.map((row, index) => ({
    ...row,
    batch_id: batch.id as string,
    numero: index + 1,
    recibo_numero: `RPA-${competenciaTag}-${String(index + 1).padStart(4, "0")}`
  }));

  for (let start = 0; start < items.length; start += CHUNK_SIZE) {
    const chunk = items.slice(start, start + CHUNK_SIZE);
    const { error } = await supabase.from("oraculo_rpa_items").insert(chunk);
    if (error) {
      report.failure = `falha ao gravar a partir da linha ${start + 1}: ${error.message}`;
      break;
    }
    report.rowsWritten += chunk.length;
  }

  // Um lote gravado pela metade não pode ser aprovado nem virar ZIP: o
  // consolidado prometeria recibos que não existem. Melhor apagá-lo e devolver
  // a falha do que deixar um lote mentiroso na listagem.
  if (report.failure) {
    await supabase.from("oraculo_rpa_batches").delete().eq("id", batch.id);
    report.batchId = null;
    return report;
  }

  return report;
}

/** Marca o lote como aprovado. A geração do ZIP só serve lote aprovado. */
export async function approveRpaBatch(batchId: string, userId: string | null) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("oraculo_rpa_batches")
    .update({
      status: "aprovado",
      approved_by: userId,
      approved_at: new Date().toISOString()
    })
    .eq("id", batchId)
    .eq("status", "rascunho");
  if (error) throw new Error(`não foi possível aprovar o lote: ${error.message}`);
}

export async function deleteRpaBatch(batchId: string) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("oraculo_rpa_batches").delete().eq("id", batchId);
  if (error) throw new Error(`não foi possível excluir o lote: ${error.message}`);
}
