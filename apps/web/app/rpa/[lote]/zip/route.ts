// Download do ZIP com os RPAs de um lote aprovado.
//
// Segue o padrão dos outros exports do repo (GET + Response com
// Content-Disposition, nunca blob montado no cliente), com duas diferenças:
// só serve lote APROVADO, e lê pelo cliente service_role porque as tabelas de
// RPA não têm grant para `authenticated` — elas guardam CPF e endereço.

import { getCurrentUser } from "../../../../lib/auth/session";
import { canAccess } from "../../../../lib/auth/access";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { fileStamp } from "../../../../lib/xlsx";
import { buildRpaZip } from "../../../../lib/rpa-zip";
import { loadBatch, loadBatchItems, loadIssuer } from "../../data";

export const dynamic = "force-dynamic";
// Centenas de PDFs numa requisição. Na prática leva segundos, mas o default da
// plataforma não é um número que valha a pena descobrir em produção.
export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ lote: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!canAccess(user, "rpa")) return new Response("Sem acesso a esta aba", { status: 403 });

  const { lote } = await params;
  const batch = await loadBatch(lote);
  if (!batch) return new Response("Lote não encontrado", { status: 404 });
  if (batch.status !== "aprovado") {
    return new Response("Aprove o lote antes de gerar os recibos", { status: 409 });
  }

  const issuer = await loadIssuer(batch.issuer_id);
  if (!issuer) return new Response("Emitente do lote não encontrado", { status: 409 });

  const items = await loadBatchItems(lote, { onlyEmitidos: true });
  if (items.length === 0) {
    return new Response("Nenhum afiliado elegível neste lote", { status: 409 });
  }

  const { bytes, fileCount, failures } = await buildRpaZip(items, issuer, {
    competencia: batch.competencia,
    loja: batch.loja,
    file_name: batch.file_name,
    aplica_inss: batch.aplica_inss,
    aplica_irrf: batch.aplica_irrf,
    aplica_iss: batch.aplica_iss,
    iss_rate: batch.iss_rate
  });

  // Marca quando o lote virou documento de verdade. Falha parcial não é
  // silenciada: vai no manifesto dentro do ZIP e num header inspecionável.
  const supabase = createSupabaseAdminClient();
  await supabase
    .from("oraculo_rpa_batches")
    .update({ generated_at: new Date().toISOString() })
    .eq("id", lote);

  const nome = `RPA_${batch.loja.replace(/[^\w-]+/g, "-")}_${batch.competencia.slice(0, 7)}_${fileStamp()}.zip`;

  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${nome}"`,
      "Content-Length": String(bytes.byteLength),
      "X-Rpa-Recibos": String(fileCount),
      "X-Rpa-Falhas": String(failures.length),
      "Cache-Control": "no-store"
    }
  });
}
