// Processa a inbox mercadolivre_notifications (gravada pelo webhook) para
// manter os anúncios quase em tempo real entre os syncs horários.
//
// Regras:
// - Somente GET na API do ML.
// - NÃO renova token: essa responsabilidade é exclusiva do mercadolivre-sync.
//   Se o token estiver a <2min de expirar, o lote é adiado para a próxima rodada.
// - Tópicos de anúncio/estoque atualizam o item direto; orders_v2 é marcado
//   como ignorado (vendas agregadas ficam com o sync horário).
import { createClient } from "npm:@supabase/supabase-js@2";

const ML_API = "https://api.mercadolibre.com";
const BATCH_LIMIT = 200;

const env = {
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  supabaseServiceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  syncJobSecret: Deno.env.get("MERCADOLIVRE_SYNC_JOB_SECRET") ?? ""
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function mlGet(accessToken: string, path: string) {
  const response = await fetch(`${ML_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`GET ${path}: resposta inválida (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`GET ${path}: ${String(payload.message ?? payload.error ?? response.status)}`);
  }
  return payload;
}

// Tópicos que conseguimos resolver para um item específico
const ITEM_TOPICS = new Set(["items", "items_prices"]);

function extractMlbId(resource: string): string | null {
  const match = resource.match(/MLB\d+/);
  return match ? match[0] : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  if (req.headers.get("x-sync-secret") !== env.syncJobSecret || !env.syncJobSecret) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    // 1) Lote de notificações pendentes
    const { data: pending, error: pendingError } = await supabase
      .from("mercadolivre_notifications")
      .select("id, topic, resource, seller_id")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (pendingError) throw pendingError;
    if (!pending?.length) return jsonResponse({ ok: true, processed: 0, note: "inbox vazia" });

    // 2) Token (somente leitura — renovação é exclusiva do mercadolivre-sync)
    const sellerIds = [...new Set(pending.map((n) => Number(n.seller_id)).filter(Number.isSafeInteger))];
    const tokens = new Map<number, string>();
    for (const sellerId of sellerIds) {
      const { data: tokenRow } = await supabase
        .from("mercadolivre_tokens")
        .select("access_token, expires_at")
        .eq("seller_id", sellerId)
        .single();
      const expiresAt = tokenRow?.expires_at ? new Date(tokenRow.expires_at).getTime() : 0;
      if (tokenRow && expiresAt - 2 * 60 * 1000 > Date.now()) {
        tokens.set(sellerId, tokenRow.access_token as string);
      }
    }
    if (tokens.size === 0) {
      return jsonResponse({ ok: true, processed: 0, note: "token perto de expirar; lote adiado" });
    }

    const nowIso = new Date().toISOString();
    let processed = 0;
    let ignored = 0;
    let failed = 0;

    // 3) Deduplica itens a atualizar (várias notificações do mesmo anúncio)
    const itemTargets = new Map<string, { sellerId: number; notificationIds: string[] }>();
    const toIgnore: { id: string; note: string }[] = [];

    for (const notification of pending) {
      const sellerId = Number(notification.seller_id);
      const token = tokens.get(sellerId);
      if (!token) {
        toIgnore.push({ id: notification.id, note: "sem token válido nesta rodada" });
        continue;
      }
      const mlbId = extractMlbId(notification.resource ?? "");
      if (ITEM_TOPICS.has(notification.topic) && mlbId) {
        const target = itemTargets.get(mlbId) ?? { sellerId, notificationIds: [] };
        target.notificationIds.push(notification.id);
        itemTargets.set(mlbId, target);
      } else if (notification.topic === "orders_v2") {
        toIgnore.push({ id: notification.id, note: "vendas agregadas pelo sync horário" });
      } else {
        toIgnore.push({ id: notification.id, note: `tópico não tratado: ${notification.topic}` });
      }
    }

    // 4) Atualiza cada anúncio notificado (detalhe + estoque Full)
    for (const [mlbId, target] of itemTargets) {
      const token = tokens.get(target.sellerId)!;
      try {
        const item = await mlGet(token, `/items/${mlbId}`) as Record<string, unknown>;
        const shipping = (item.shipping ?? {}) as Record<string, unknown>;
        const inventoryId = typeof item.inventory_id === "string" ? item.inventory_id : null;
        let fullStock = 0;
        if (shipping.logistic_type === "fulfillment" && inventoryId) {
          try {
            const stock = await mlGet(token, `/inventories/${inventoryId}/stock/fulfillment`) as {
              available_quantity?: number;
            };
            fullStock = Number(stock.available_quantity ?? 0);
          } catch {
            fullStock = 0;
          }
        }
        const subStatus = Array.isArray(item.sub_status) ? item.sub_status.join(",") : null;
        const { error: upsertError } = await supabase.from("mercadolivre_items").upsert({
          seller_id: target.sellerId,
          mlb_id: mlbId,
          title: item.title ?? null,
          sku: item.seller_custom_field ?? null,
          status: item.status ?? null,
          sub_status: subStatus || null,
          price: Number(item.price ?? 0),
          permalink: item.permalink ?? null,
          thumbnail: item.thumbnail ?? null,
          logistic_type: (shipping.logistic_type as string | undefined) ?? null,
          inventory_id: inventoryId,
          available_qty: Number(item.available_quantity ?? 0),
          full_stock: fullStock,
          raw_json: item,
          synced_at: nowIso
        }, { onConflict: "seller_id,mlb_id" });
        if (upsertError) throw upsertError;

        await supabase
          .from("mercadolivre_notifications")
          .update({ status: "processed", processed_at: nowIso })
          .in("id", target.notificationIds);
        processed += target.notificationIds.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await supabase
          .from("mercadolivre_notifications")
          .update({ status: "failed", processed_at: nowIso, error_message: message })
          .in("id", target.notificationIds);
        failed += target.notificationIds.length;
      }
    }

    // 5) Marca ignoradas
    for (const entry of toIgnore) {
      await supabase
        .from("mercadolivre_notifications")
        .update({ status: "ignored", processed_at: nowIso, error_message: entry.note })
        .eq("id", entry.id);
      ignored += 1;
    }

    return jsonResponse({ ok: true, processed, ignored, failed, itemsRefreshed: itemTargets.size });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("mercadolivre-process-notifications", message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
