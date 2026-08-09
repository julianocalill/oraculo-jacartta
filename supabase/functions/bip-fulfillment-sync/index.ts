// Espelha os bipes Shopee do Bip no Oráculo para a conciliação de expedição.
// O Bip continua sendo a fonte de verdade; esta função apenas lê sua API
// interna protegida e faz upsert idempotente no espelho analítico.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_LOOKBACK_HOURS = 48;
const OVERLAP_MINUTES = 10;

type BipEvent = {
  id: string;
  marketplace: string;
  scan_code: string;
  commercial_scanned_at: string | null;
  commercial_operator_name: string | null;
  logistics_received_at: string | null;
  logistics_operator_name: string | null;
  source_updated_at: string;
};

function validIso(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

Deno.serve(async (req) => {
  const expectedJobSecret = Deno.env.get("SHOPEE_SYNC_SECRET");
  if (expectedJobSecret && req.headers.get("x-sync-secret") !== expectedJobSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const bipUrl = Deno.env.get("BIP_FULFILLMENT_EXPORT_URL");
  const bipSecret = Deno.env.get("BIP_FULFILLMENT_EXPORT_SECRET");
  if (!bipUrl || !bipSecret) {
    return new Response(JSON.stringify({ error: "missing Bip fulfillment configuration" }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const startedAt = new Date().toISOString();
  const { data: run, error: runError } = await supabase
    .from("bip_fulfillment_sync_runs")
    .insert({ started_at: startedAt, status: "running" })
    .select("id")
    .single();
  if (runError) {
    return new Response(JSON.stringify({ error: runError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const requestUrl = new URL(req.url);
    let since = validIso(requestUrl.searchParams.get("since"));
    if (!since) {
      const { data: latest } = await supabase
        .from("bip_fulfillment_events")
        .select("source_updated_at")
        .order("source_updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const base = latest?.source_updated_at
        ? new Date(latest.source_updated_at).getTime() - OVERLAP_MINUTES * 60 * 1000
        : Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000;
      since = new Date(base).toISOString();
    }

    const exportUrl = new URL(bipUrl);
    exportUrl.searchParams.set("since", since);
    exportUrl.searchParams.set("limit", "5000");
    const response = await fetch(exportUrl, {
      headers: { "x-integration-secret": bipSecret, Accept: "application/json" }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) {
      throw new Error(`Bip export HTTP ${response.status}: ${body.error ?? "resposta inválida"}`);
    }

    const events = (body.events ?? []) as BipEvent[];
    const nowIso = new Date().toISOString();
    const rows = events.map((event) => ({
      id: event.id,
      marketplace: event.marketplace,
      scan_code: String(event.scan_code).trim().toUpperCase(),
      commercial_scanned_at: event.commercial_scanned_at,
      commercial_operator_name: event.commercial_operator_name,
      logistics_received_at: event.logistics_received_at,
      logistics_operator_name: event.logistics_operator_name,
      source_updated_at: event.source_updated_at,
      synced_at: nowIso,
      raw_json: event
    }));

    let upserted = 0;
    for (let index = 0; index < rows.length; index += 500) {
      const chunk = rows.slice(index, index + 500);
      const { error } = await supabase
        .from("bip_fulfillment_events")
        .upsert(chunk, { onConflict: "id" });
      if (error) throw new Error(`upsert Bip events: ${error.message}`);
      upserted += chunk.length;
    }

    await supabase
      .from("bip_fulfillment_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        records_fetched: events.length,
        records_upserted: upserted,
        source_since: since,
        meta: { has_more: Boolean(body.has_more), next_since: body.next_since ?? null }
      })
      .eq("id", run.id);

    return new Response(JSON.stringify({
      ok: true,
      since,
      fetched: events.length,
      upserted,
      has_more: Boolean(body.has_more)
    }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from("bip_fulfillment_sync_runs")
      .update({ finished_at: new Date().toISOString(), status: "failed", error_message: message })
      .eq("id", run.id);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
