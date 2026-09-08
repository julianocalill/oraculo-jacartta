// Monitoramento inbound do módulo Full.
//
// Contrato único: cada adapter recebe loja + código da remessa e devolve uma
// observação com status, quantidades, horário e evidência bruta. Esta função
// NUNCA cria remessa, NUNCA infere coleta por aumento de estoque e NUNCA renova
// tokens. Os três adapters começam fechados pelos gates da tabela
// oraculo_full_store_configs e só devem ser implementados/liberados depois de
// uma prova real do agendamento ao recebimento.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Channel = "mercadolivre" | "shopee" | "amazon";
type CanonicalStatus = "agendado" | "coletado" | "em_transito" | "recebendo" | "recebido" | "recebido_com_divergencia" | "cancelado" | "desconhecido";

type ShipmentObservation = {
  eventKey: string;
  rawStatus: string;
  canonicalStatus: CanonicalStatus;
  shippedQty: number | null;
  receivedQty: number | null;
  observedAt: string;
  evidence: Record<string, unknown>;
};

type FullRow = {
  id: string;
  channel: Channel;
  store_key: string;
  external_shipment_id: string;
  external_status: CanonicalStatus;
  current_revision: number;
};

const STATUS_RANK: Record<CanonicalStatus, number> = {
  agendado: 10,
  coletado: 20,
  em_transito: 30,
  recebendo: 40,
  recebido: 50,
  recebido_com_divergencia: 50,
  cancelado: 90,
  desconhecido: 90
};

async function readShipment(channel: Channel, storeKey: string, shipmentId: string): Promise<ShipmentObservation> {
  // Ativação deliberadamente bloqueada. Implementar por canal somente após a
  // remessa piloto provar ID, estados e quantidades. Tokens existentes devem
  // ser apenas lidos pelos adapters; renovação continua nos sincronizadores.
  throw new Error(`Adapter ${channel} ainda não validado para ${storeKey}/${shipmentId}`);
}

function accepts(current: CanonicalStatus, next: CanonicalStatus) {
  if (current === "cancelado" || current === "recebido" || current === "recebido_com_divergencia") return false;
  if (next === "desconhecido") return current === "agendado";
  if (current === "desconhecido") return true;
  if (next === "cancelado") return true;
  return STATUS_RANK[next] >= STATUS_RANK[current];
}

Deno.serve(async (request) => {
  const expected = Deno.env.get("FULL_INBOUND_SYNC_JOB_SECRET");
  if (!expected || request.headers.get("x-sync-secret") !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const url = new URL(request.url);
  const requestedChannel = url.searchParams.get("channel") as Channel | null;
  const requestedStore = url.searchParams.get("store_key");
  let configQuery = supabase.from("oraculo_full_store_configs")
    .select("channel,store_key")
    .eq("collection_sync_validated", true)
    .eq("receipt_sync_validated", true);
  if (requestedChannel) configQuery = configQuery.eq("channel", requestedChannel);
  if (requestedStore) configQuery = configQuery.eq("store_key", requestedStore);
  const { data: configs, error: configError } = await configQuery;
  if (configError) return new Response(JSON.stringify({ error: configError.message }), { status: 500 });

  const results: Record<string, unknown>[] = [];
  for (const config of configs ?? []) {
    const runStart = new Date().toISOString();
    const { data: run, error: runError } = await supabase.from("oraculo_full_sync_runs").insert({
      channel: config.channel,
      store_key: config.store_key,
      metadata: { trigger: "full-inbound-sync", adapter_contract: 1 }
    }).select("id").single();
    if (runError) {
      results.push({ channel: config.channel, store_key: config.store_key, error: runError.message });
      continue;
    }

    let checked = 0;
    let written = 0;
    const errors: string[] = [];
    const { data: fulls, error: fullError } = await supabase.from("oraculo_fulls")
      .select("id,channel,store_key,external_shipment_id,external_status,current_revision")
      .eq("channel", config.channel)
      .eq("store_key", config.store_key)
      .eq("workflow_status", "monitorando")
      .not("external_shipment_id", "is", null)
      .limit(100);
    if (fullError) errors.push(fullError.message);

    for (const full of (fulls ?? []) as FullRow[]) {
      checked += 1;
      try {
        const observation = await readShipment(full.channel, full.store_key, full.external_shipment_id);
        const canonical = observation.canonicalStatus === "recebido" && observation.shippedQty != null && observation.receivedQty != null && observation.receivedQty < observation.shippedQty
          ? "recebido_com_divergencia"
          : observation.canonicalStatus;
        const { data: event, error: eventError } = await supabase.from("oraculo_full_external_events").upsert({
          full_id: full.id,
          channel: full.channel,
          external_event_key: observation.eventKey,
          raw_status: observation.rawStatus,
          canonical_status: canonical,
          shipped_qty: observation.shippedQty,
          received_qty: observation.receivedQty,
          observed_at: observation.observedAt,
          payload: observation.evidence
        }, { onConflict: "full_id,external_event_key", ignoreDuplicates: true }).select("id").maybeSingle();
        if (eventError) throw eventError;
        if (!event || !accepts(full.external_status, canonical)) continue;
        written += 1;

        const terminal = canonical === "recebido" || canonical === "recebido_com_divergencia";
        const exceptional = canonical === "cancelado" || canonical === "desconhecido";
        const patch: Record<string, unknown> = {
          external_status: canonical,
          last_external_sync_at: new Date().toISOString(),
          last_external_error: exceptional ? `Marketplace informou ${observation.rawStatus}` : null,
          updated_at: new Date().toISOString()
        };
        if (canonical === "coletado") patch.external_collected_at = observation.observedAt;
        if (terminal) {
          patch.external_received_at = observation.observedAt;
          patch.workflow_status = "concluido";
        } else if (exceptional) {
          patch.workflow_status = "excecao";
        }
        const { error: updateError } = await supabase.from("oraculo_fulls").update(patch).eq("id", full.id);
        if (updateError) throw updateError;
        await supabase.from("oraculo_full_events").insert({
          full_id: full.id,
          revision_no: full.current_revision,
          event_type: terminal ? "recebimento_confirmado" : exceptional ? "excecao_externa" : "status_externo_atualizado",
          actor_type: "sistema",
          from_status: full.external_status,
          to_status: canonical,
          payload: { external_event_key: observation.eventKey, shipped_qty: observation.shippedQty, received_qty: observation.receivedQty }
        });
        if (canonical === "coletado" || terminal) {
          await supabase.from("oraculo_agenda_tasks").update({
            status: "concluida", completed_at: new Date().toISOString(), completed_by: null, updated_at: new Date().toISOString()
          }).contains("metadata", { full_id: full.id }).eq("status", "pendente");
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        errors.push(`${full.external_shipment_id}: ${message}`);
        await supabase.from("oraculo_fulls").update({ last_external_sync_at: new Date().toISOString(), last_external_error: message, updated_at: new Date().toISOString() }).eq("id", full.id);
      }
    }

    const status = errors.length === 0 ? "success" : checked > errors.length ? "partial" : "failed";
    await supabase.from("oraculo_full_sync_runs").update({
      finished_at: new Date().toISOString(), status, records_checked: checked, events_written: written,
      error_message: errors.join(" · ").slice(0, 4000) || null,
      metadata: { trigger: "full-inbound-sync", adapter_contract: 1, started_at: runStart }
    }).eq("id", run.id);
    results.push({ channel: config.channel, store_key: config.store_key, status, checked, written, errors: errors.length });
  }

  return new Response(JSON.stringify({ ok: true, active_configs: configs?.length ?? 0, results }), {
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
});
