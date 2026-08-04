// Ingestão de um arquivo de devoluções: parse -> registro do lote -> upsert.
//
// O upsert usa a PK (channel, return_id), então reimportar o mesmo arquivo
// ATUALIZA as linhas em vez de duplicar — é assim que a planilha semanal do
// TikTok funciona (ela reexporta o histórico inteiro a cada extração).
//
// O relatório de erros é por linha e volta para a tela: linha com status
// desconhecido ou data inválida é descartada e aparece no relatório, nunca
// entra pela metade nem falha o arquivo inteiro.

import { createSupabaseAdminClient } from "./supabase/admin";
import { parseTikTokReturnsWorkbook, type ReturnRow } from "./returns-import";

const CHUNK_SIZE = 500; // PostgREST não gosta de payloads gigantes num único POST

export type UploadReport = {
  batchId: string | null;
  fileName: string;
  sheets: string[];
  rowsRead: number;
  rowsWritten: number;
  rowsRejected: number;
  duplicates: number;
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  qtyAssumed: number;
  unknownReasons: string[];
  errors: { sheet: string; row: number; field: string; message: string }[];
  failure?: string;
};

async function loadReasonMap(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  channel: string
) {
  const { data, error } = await supabase
    .from("oraculo_return_reason_map")
    .select("reason_raw, reason_group")
    .eq("channel", channel);
  if (error) throw new Error(`de-para de motivos: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.reason_raw as string, row.reason_group as string]));
}

export async function importTikTokReturns(
  file: File,
  userId: string | null
): Promise<UploadReport> {
  const supabase = createSupabaseAdminClient();
  const reasonMap = await loadReasonMap(supabase, "tiktok");
  const buffer = await file.arrayBuffer();
  const parsed = await parseTikTokReturnsWorkbook(buffer, reasonMap);

  const report: UploadReport = {
    batchId: null,
    fileName: file.name,
    sheets: parsed.sheets,
    rowsRead: parsed.stats.rowsRead,
    rowsWritten: 0,
    rowsRejected: parsed.stats.rowsRead - parsed.rows.length,
    duplicates: parsed.stats.duplicates,
    byStatus: parsed.stats.byStatus,
    byType: parsed.stats.byType,
    qtyAssumed: parsed.rows.filter((row) => row.qty_assumed).length,
    unknownReasons: parsed.unknownReasons,
    errors: parsed.errors
  };

  if (parsed.rows.length === 0) {
    report.failure = "nenhuma linha válida encontrada — nada foi gravado";
    return report;
  }

  const { data: batch, error: batchError } = await supabase
    .from("oraculo_returns_upload_batches")
    .insert({
      channel: "tiktok",
      file_name: file.name,
      uploaded_by: userId,
      sheet_names: parsed.sheets,
      rows_read: report.rowsRead,
      rows_rejected: report.rowsRejected,
      errors: parsed.errors.length > 0 ? parsed.errors : null,
      notes:
        parsed.unknownReasons.length > 0
          ? `motivos novos (classificados como 'outros'): ${parsed.unknownReasons.join(" | ")}`
          : null
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    report.failure = `não foi possível registrar o lote: ${batchError?.message ?? "sem id"}`;
    return report;
  }
  report.batchId = batch.id as string;

  const rows: (ReturnRow & { upload_batch_id: string })[] = parsed.rows.map((row) => ({
    ...row,
    upload_batch_id: batch.id as string
  }));

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);
    const { error } = await supabase
      .from("oraculo_returns")
      .upsert(chunk, { onConflict: "channel,return_id" });
    if (error) {
      report.failure = `falha ao gravar a partir da linha ${start + 1}: ${error.message}`;
      break;
    }
    report.rowsWritten += chunk.length;
  }

  await supabase
    .from("oraculo_returns_upload_batches")
    .update({
      rows_inserted: report.rowsWritten,
      notes: report.failure
        ? `${report.failure}`
        : (parsed.unknownReasons.length > 0
            ? `motivos novos (classificados como 'outros'): ${parsed.unknownReasons.join(" | ")}`
            : null)
    })
    .eq("id", batch.id);

  return report;
}
