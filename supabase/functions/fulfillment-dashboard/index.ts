// Endpoint enxuto e somente-leitura para as TVs do Bip.
// Não devolve cliente, endereço ou payload bruto da Shopee.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function brtDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function safeDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : brtDay();
}

function maskTracking(value: unknown) {
  const text = String(value ?? "");
  return text.length > 9 ? `${text.slice(0, 4)}••••${text.slice(-4)}` : text || null;
}

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get("FULFILLMENT_DASHBOARD_SECRET");
  if (!expectedSecret || req.headers.get("x-dashboard-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const url = new URL(req.url);
  const day = safeDate(url.searchParams.get("day"));
  const shopId = url.searchParams.get("shop_id");
  const shopArg = shopId && /^\d+$/.test(shopId) ? Number(shopId) : null;

  const [summaryResult, shopsResult, attentionResult, recentResult] = await Promise.all([
    supabase.rpc("oraculo_fulfillment_operational_summary", {
      p_day: day,
      p_shop_id: shopArg
    }),
    supabase.rpc("oraculo_fulfillment_operational_by_shop", { p_day: day }),
    (() => {
      let query = supabase
        .from("oraculo_fulfillment_pipeline")
        .select("shop_id,shop_name,tracking_number,pipeline_status,ship_by_at,commercial_scanned_at,logistics_received_at,carrier_collected_at")
        .lte("due_day", day)
        .eq("is_cancelled", false)
        .or(`due_day.eq.${day},is_carrier_collected.eq.false`)
        .in("pipeline_status", [
          "pending_commercial",
          "between_departments",
          "waiting_carrier",
          "divergence_carrier_without_logistics",
          "divergence_logistics_without_commercial"
        ])
        .order("ship_by_at", { ascending: true })
        .limit(30);
      if (shopArg) query = query.eq("shop_id", shopArg);
      return query;
    })(),
    (() => {
      let query = supabase
        .from("oraculo_fulfillment_pipeline")
        .select("shop_id,shop_name,tracking_number,pipeline_status,commercial_scanned_at,logistics_received_at,carrier_collected_at")
        .lte("due_day", day)
        .eq("is_cancelled", false)
        .or(`due_day.eq.${day},is_carrier_collected.eq.false`)
        .or("commercial_scanned_at.not.is.null,logistics_received_at.not.is.null,carrier_collected_at.not.is.null")
        .order("commercial_scanned_at", { ascending: false, nullsFirst: false })
        .limit(20);
      if (shopArg) query = query.eq("shop_id", shopArg);
      return query;
    })()
  ]);

  for (const result of [summaryResult, shopsResult, attentionResult, recentResult]) {
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    day,
    summary: summaryResult.data?.[0] ?? null,
    by_shop: shopsResult.data ?? [],
    attention: (attentionResult.data ?? []).map((row) => ({
      ...row,
      tracking_number: maskTracking(row.tracking_number)
    })),
    recent: (recentResult.data ?? []).map((row) => ({
      ...row,
      tracking_number: maskTracking(row.tracking_number)
    })),
    refreshed_at: new Date().toISOString()
  }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
});
