// Monitor consolidado de vendas Shopee, uma loja por invocação.
//
// A função consulta somente a Open Platform oficial. Não usa cookies nem
// endpoints internos da Central do Vendedor e nunca renova refresh_token: o
// workflow primário do n8n continua sendo o único proprietário da rotação.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aggregateShopeeLiveOrders, saoPauloDateHour } from "../_shared/shopee-live-monitor.js";

const SHOPEE_HOST = "https://partner.shopeemobile.com";
const LIST_PAGE_SIZE = 100;
const DETAIL_BATCH_SIZE = 50;
const MAX_ORDERS = 5_000;
const MAX_RETRIES = 3;
const TOKEN_MIN_TTL_MS = 5 * 60 * 1000;
const ORDER_FIELDS =
  "order_status,create_time,pay_time,total_amount,currency,buyer_user_id,buyer_username,item_list";

type Shop = { shop_id: number; partner_id: number; shop_name: string | null };

const encoder = new TextEncoder();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function shopGet(
  path: string,
  shop: Shop,
  partnerKey: string,
  accessToken: string,
  params: Record<string, string>
) {
  let lastError = "tentativas esgotadas";
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = await hmacSha256Hex(
      partnerKey,
      `${shop.partner_id}${path}${timestamp}${accessToken}${shop.shop_id}`
    );
    const query = new URLSearchParams({
      partner_id: String(shop.partner_id),
      timestamp: String(timestamp),
      access_token: accessToken,
      shop_id: String(shop.shop_id),
      sign,
      ...params
    });
    const response = await fetch(`${SHOPEE_HOST}${path}?${query.toString()}`);
    const body = await response.json().catch(() => ({}));
    const apiError = body?.error && body.error !== "-" ? String(body.error) : null;
    if (response.ok && !apiError) return body.response ?? {};

    const retryable = response.status === 429 || response.status >= 500 || apiError === "error_too_many_requests";
    lastError = `${path}: HTTP ${response.status}, ${apiError ?? "erro_http"}, ${body?.message ?? "sem mensagem"}`;
    if (!retryable || attempt === MAX_RETRIES) break;
    await delay(attempt * 1_500);
  }
  throw new Error(lastError);
}

function addIsoDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

// deno-lint-ignore no-explicit-any
async function fetchOrders(shop: Shop, partnerKey: string, accessToken: string, from: number, to: number): Promise<{ orders: any[]; listed: number; capped: boolean }> {
  const orderSns: string[] = [];
  const seen = new Set<string>();
  let cursor = "";
  let capped = false;

  do {
    const list = await shopGet("/api/v2/order/get_order_list", shop, partnerKey, accessToken, {
      time_range_field: "create_time",
      time_from: String(from),
      time_to: String(to),
      page_size: String(LIST_PAGE_SIZE),
      cursor,
      response_optional_fields: "order_status"
    });
    for (const row of list?.order_list ?? []) {
      const orderSn = String(row?.order_sn ?? "");
      if (orderSn && !seen.has(orderSn)) {
        seen.add(orderSn);
        orderSns.push(orderSn);
      }
    }
    cursor = list?.more ? String(list?.next_cursor ?? "") : "";
    if (orderSns.length >= MAX_ORDERS) {
      capped = true;
      orderSns.length = MAX_ORDERS;
      break;
    }
  } while (cursor);

  // deno-lint-ignore no-explicit-any
  const orders: any[] = [];
  const batches = chunks(orderSns, DETAIL_BATCH_SIZE);
  // Duas chamadas paralelas mantêm a função curta sem martelar a API.
  for (let index = 0; index < batches.length; index += 2) {
    const responses = await Promise.all(
      batches.slice(index, index + 2).map((batch) =>
        shopGet("/api/v2/order/get_order_detail", shop, partnerKey, accessToken, {
          order_sn_list: batch.join(","),
          response_optional_fields: ORDER_FIELDS
        })
      )
    );
    for (const response of responses) orders.push(...(response?.order_list ?? []));
    if (index + 2 < batches.length) await delay(100);
  }

  return { orders, listed: orderSns.length, capped };
}

// deno-lint-ignore no-explicit-any
async function recordFailure(supabase: any, shopId: number, shopName: string | null, attemptedAt: string, message: string) {
  const { data: existing } = await supabase
    .from("shopee_live_monitor_snapshots")
    .select("shop_id")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (existing) {
    await supabase.from("shopee_live_monitor_snapshots").update({
      shop_name: shopName,
      status: "failed",
      is_complete: false,
      last_attempt_at: attemptedAt,
      error_message: message,
      updated_at: new Date().toISOString()
    }).eq("shop_id", shopId);
  } else {
    await supabase.from("shopee_live_monitor_snapshots").insert({
      shop_id: shopId,
      shop_name: shopName,
      status: "failed",
      is_complete: false,
      last_attempt_at: attemptedAt,
      error_message: message
    });
  }
}

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get("SHOPEE_SYNC_SECRET");
  if (!expectedSecret || req.headers.get("x-sync-secret") !== expectedSecret) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const url = new URL(req.url);
  const shopId = Number(url.searchParams.get("shop_id"));
  if (!Number.isFinite(shopId) || shopId <= 0) return jsonResponse({ error: "shop_id obrigatório" }, 400);

  const attemptedAt = new Date().toISOString();
  let shopName: string | null = null;
  try {
    const { data: shopRow, error: shopError } = await supabase
      .from("shopee_shops")
      .select("shop_id, partner_id, shop_name")
      .eq("shop_id", shopId)
      .eq("is_active", true)
      .maybeSingle();
    if (shopError || !shopRow) throw new Error(`loja ativa não encontrada: ${shopId}`);
    const shop = shopRow as Shop;
    shopName = shop.shop_name;

    const [{ data: token }, { data: app }] = await Promise.all([
      supabase.from("shopee_tokens")
        .select("access_token, access_token_expires_at")
        .eq("shop_id", shopId)
        .maybeSingle(),
      supabase.from("shopee_app_config")
        .select("partner_key")
        .eq("partner_id", String(shop.partner_id))
        .eq("is_active", true)
        .maybeSingle()
    ]);

    const accessToken = String(token?.access_token ?? "");
    const partnerKey = String(app?.partner_key ?? "");
    const expiresAt = Date.parse(String(token?.access_token_expires_at ?? ""));
    if (!accessToken || !partnerKey || !Number.isFinite(expiresAt)) throw new Error("credencial Shopee ausente");
    if (expiresAt - Date.now() < TOKEN_MIN_TTL_MS) {
      throw new Error("token perto de expirar; a renovação continua pertencendo ao n8n");
    }

    const todayParts = saoPauloDateHour(Date.now());
    if (!todayParts) throw new Error("não foi possível determinar a data em America/Sao_Paulo");
    const today = todayParts.date;
    const previous = addIsoDays(today, -1);
    const from = Math.floor(Date.parse(`${previous}T00:00:00-03:00`) / 1000);
    const to = Math.floor(Date.now() / 1000);
    const fetched = await fetchOrders(shop, partnerKey, accessToken, from, to);
    const summary = aggregateShopeeLiveOrders(fetched.orders, { today, previous });
    const completedAt = new Date().toISOString();
    const status = fetched.capped ? "partial" : "success";

    const { error: snapshotError } = await supabase.from("shopee_live_monitor_snapshots").upsert({
      shop_id: shop.shop_id,
      shop_name: shop.shop_name,
      today_date: today,
      previous_date: previous,
      status,
      is_complete: !fetched.capped,
      current_metrics: summary.current,
      previous_metrics: summary.previous,
      hourly: summary.hourly,
      products: summary.products,
      source_orders: fetched.listed,
      api_through_at: completedAt,
      last_attempt_at: attemptedAt,
      last_success_at: completedAt,
      error_message: fetched.capped ? `limite de ${MAX_ORDERS} pedidos atingido` : null,
      updated_at: completedAt
    }, { onConflict: "shop_id" });
    if (snapshotError) throw new Error(`gravar snapshot: ${snapshotError.message}`);

    await supabase.from("shopee_sync_runs").insert({
      source: `shopee-live-monitor:${shop.shop_id}`,
      started_at: attemptedAt,
      finished_at: completedAt,
      status,
      records_fetched: fetched.listed,
      records_upserted: 1,
      error_message: fetched.capped ? `limite de ${MAX_ORDERS} pedidos atingido` : null,
      meta: {
        shop_id: shop.shop_id,
        shop_name: shop.shop_name,
        today,
        previous,
        accepted_orders: summary.accepted_orders
      }
    });

    return jsonResponse({
      ok: !fetched.capped,
      status,
      shop_id: shop.shop_id,
      shop_name: shop.shop_name,
      collected_at: completedAt,
      source_orders: fetched.listed,
      metrics: summary.current
    }, fetched.capped ? 206 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordFailure(supabase, shopId, shopName, attemptedAt, message);
    await supabase.from("shopee_sync_runs").insert({
      source: `shopee-live-monitor:${shopId}`,
      started_at: attemptedAt,
      finished_at: new Date().toISOString(),
      status: "failed",
      records_fetched: 0,
      records_upserted: 0,
      error_message: message,
      meta: { shop_id: shopId, shop_name: shopName }
    });
    return jsonResponse({ ok: false, shop_id: shopId, error: message }, 500);
  }
});
