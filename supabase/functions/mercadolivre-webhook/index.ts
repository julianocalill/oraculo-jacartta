import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const expectedApplicationId = Deno.env.get("MERCADOLIVRE_APP_ID") ?? "";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const payload = await req.json() as Record<string, unknown>;
    const topic = typeof payload.topic === "string" ? payload.topic : "";
    const resource = typeof payload.resource === "string" ? payload.resource : "";
    const applicationId = String(payload.application_id ?? "");
    if (!topic || !resource || !applicationId) return jsonResponse({ ok: true, ignored: "invalid_payload" });
    if (!expectedApplicationId || applicationId !== expectedApplicationId) return jsonResponse({ ok: true, ignored: "different_application" });

    const notificationId = typeof payload._id === "string" ? payload._id : null;
    const basis = notificationId || [applicationId, topic, resource, String(payload.sent ?? "")].join(":");
    const dedupeKey = await sha256(basis);
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const sellerId = Number(payload.user_id);
    const appIdNumber = Number(applicationId);
    const attempts = Number(payload.attempts);

    const { error } = await supabase.from("mercadolivre_notifications").upsert({
      dedupe_key: dedupeKey,
      notification_id: notificationId,
      topic,
      resource,
      seller_id: Number.isSafeInteger(sellerId) ? sellerId : null,
      application_id: Number.isSafeInteger(appIdNumber) ? appIdNumber : null,
      attempts: Number.isInteger(attempts) ? attempts : null,
      sent_at: typeof payload.sent === "string" ? payload.sent : null,
      received_at: typeof payload.received === "string" ? payload.received : null,
      payload
    }, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (error) throw error;

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("mercadolivre-webhook", error instanceof Error ? error.message : String(error));
    return jsonResponse({ ok: false, error: "temporary_failure" }, 503);
  }
});
