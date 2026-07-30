// TikTok Shop sync — traz pedidos da(s) loja(s) TikTok (Donacor) para o Oráculo.
//
// Mesmo desenho do shopee-sync: fonte única de verdade dos tokens são as
// tabelas tiktok_app_config / tiktok_tokens / tiktok_shops. Esta função é o
// ÚNICO renovador de token (access_token dura ~7 dias; renova quando faltar
// menos de 12h).
//
// A cada invocação, para cada loja ativa (ou uma só via ?shop_id=):
//   1. renova o access_token se necessário (refresh_token, auth.tiktok-shops.com);
//   2. busca pedidos alterados na janela via /order/202309/orders/search
//      (POST, paginado por page_token; o retorno já vem com detalhe completo,
//      incluindo line_items — não há chamada de detalhe separada);
//   3. upsert em tiktok_orders / tiktok_order_items (line_items agregados por
//      SKU: no TikTok cada line_item é 1 unidade);
//   4. registra a execução em tiktok_sync_runs.
//
// Protegida por x-sync-secret (env TIKTOK_SYNC_SECRET). Agendada por
// pg_cron + pg_net. Idempotente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const AUTH_HOST = "https://auth.tiktok-shops.com";
const API_HOST = "https://open-api.tiktokglobalshop.com";
const REFRESH_SKEW_SECONDS = 12 * 60 * 60; // renova se faltar menos de 12h
const DEFAULT_WINDOW_MINUTES = 45;
const MAX_ORDERS_PER_RUN = 500;
const PAGE_SIZE = 50;

type Shop = { shop_id: string; open_id: string; shop_name: string | null; cipher: string | null };
type TokenRow = {
  open_id: string;
  access_token: string | null;
  refresh_token: string | null;
  access_token_expires_at: string | null;
};

const enc = new TextEncoder();

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Assinatura padrão do Open API: secret + path + params ordenados (chave+valor,
// exceto sign/access_token) + body JSON + secret, HMAC-SHA256 hex.
async function signRequest(appSecret: string, path: string, params: Record<string, string>, body = "") {
  const sorted = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  return hmacSha256Hex(appSecret, `${appSecret}${path}${sorted}${body}${appSecret}`);
}

// deno-lint-ignore no-explicit-any
async function tiktokJson(res: Response, context: string): Promise<any> {
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`${context}: resposta não-JSON (HTTP ${res.status})`);
  if (json.code !== 0) throw new Error(`${context}: ${json.code} ${json.message}`);
  return json.data;
}

async function refreshAccessToken(appKey: string, appSecret: string, refreshToken: string) {
  const qs = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  const res = await fetch(`${AUTH_HOST}/api/v2/token/refresh?${qs}`);
  return tiktokJson(res, "Falha ao renovar access_token");
}

async function searchOrders(
  appKey: string,
  appSecret: string,
  accessToken: string,
  cipher: string,
  bodyObj: Record<string, unknown>,
  pageToken: string
) {
  const path = "/order/202309/orders/search";
  const body = JSON.stringify(bodyObj);
  const params: Record<string, string> = {
    app_key: appKey,
    timestamp: String(Math.floor(Date.now() / 1000)),
    shop_cipher: cipher,
    page_size: String(PAGE_SIZE),
    sort_field: "update_time",
    sort_order: "ASC"
  };
  if (pageToken) params.page_token = pageToken;
  params.sign = await signRequest(appSecret, path, params, body);
  const res = await fetch(`${API_HOST}${path}?${new URLSearchParams(params)}`, {
    method: "POST",
    headers: { "x-tts-access-token": accessToken, "Content-Type": "application/json" },
    body
  });
  return tiktokJson(res, `orders/search`);
}

function tsToIso(v: unknown): string | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// deno-lint-ignore no-explicit-any
async function upsertOrders(supabase: any, shop: Shop, orders: any[]): Promise<number> {
  if (!orders.length) return 0;
  const nowIso = new Date().toISOString();

  // deno-lint-ignore no-explicit-any
  const orderRows = orders.map((o: any) => ({
    id: `${shop.shop_id}-${o.id}`,
    shop_id: shop.shop_id,
    shop_name: shop.shop_name,
    order_id: String(o.id),
    order_status: o.status ?? null,
    create_time: tsToIso(o.create_time),
    update_time: tsToIso(o.update_time),
    paid_time: tsToIso(o.paid_time),
    total_amount: toNum(o.payment?.total_amount),
    sub_total: toNum(o.payment?.sub_total),
    platform_discount: toNum(o.payment?.platform_discount),
    seller_discount: toNum(o.payment?.seller_discount),
    shipping_fee: toNum(o.payment?.shipping_fee),
    currency: o.payment?.currency ?? null,
    buyer_user_id: o.user_id != null ? String(o.user_id) : null,
    buyer_email: o.buyer_email ?? null,
    recipient_name: o.recipient_address?.name ?? null,
    recipient_phone: o.recipient_address?.phone_number ?? null,
    recipient_city:
      // deno-lint-ignore no-explicit-any
      (o.recipient_address?.district_info ?? []).find((d: any) => d.address_level_name === "City")?.address_name ??
      null,
    recipient_state:
      // deno-lint-ignore no-explicit-any
      (o.recipient_address?.district_info ?? []).find((d: any) => d.address_level_name === "State")?.address_name ??
      null,
    fulfillment_type: o.fulfillment_type ?? null,
    delivery_option_name: o.delivery_option_name ?? null,
    raw_json: o,
    synced_at: nowIso
  }));

  // Cada line_item do TikTok é 1 unidade → agrega por SKU.
  // deno-lint-ignore no-explicit-any
  const itemRows = orders.flatMap((o: any) => {
    // deno-lint-ignore no-explicit-any
    const bySku = new Map<string, { items: any[] }>();
    for (const it of o.line_items ?? []) {
      const key = String(it.sku_id ?? it.product_id ?? "unknown");
      if (!bySku.has(key)) bySku.set(key, { items: [] });
      bySku.get(key)!.items.push(it);
    }
    return [...bySku.entries()].map(([skuId, { items }]) => {
      const first = items[0];
      return {
        id: `${shop.shop_id}-${o.id}-${skuId}`,
        order_id: `${shop.shop_id}-${o.id}`,
        shop_id: shop.shop_id,
        tiktok_order_id: String(o.id),
        product_id: first.product_id != null ? String(first.product_id) : null,
        product_name: first.product_name ?? null,
        sku_id: first.sku_id != null ? String(first.sku_id) : null,
        sku_name: first.sku_name ?? null,
        seller_sku: first.seller_sku || null,
        quantity: items.length,
        original_price: toNum(first.original_price),
        sale_price: toNum(first.sale_price),
        raw_json: { line_items: items },
        synced_at: nowIso
      };
    });
  });

  const { error: oErr } = await supabase.from("tiktok_orders").upsert(orderRows, { onConflict: "id" });
  if (oErr) throw new Error(`upsert orders ${shop.shop_id}: ${oErr.message}`);
  if (itemRows.length) {
    const { error: iErr } = await supabase.from("tiktok_order_items").upsert(itemRows, { onConflict: "id" });
    if (iErr) throw new Error(`upsert items ${shop.shop_id}: ${iErr.message}`);
  }
  return orderRows.length;
}

// deno-lint-ignore no-explicit-any
async function syncShop(
  supabase: any,
  shop: Shop,
  appKey: string,
  appSecret: string,
  windowMinutes: number
): Promise<{ fetched: number; upserted: number; capped: boolean }> {
  if (!shop.cipher) throw new Error(`loja ${shop.shop_id} sem cipher — refaça a autorização`);

  const { data: tokenRow } = await supabase
    .from("tiktok_tokens")
    .select("open_id, access_token, refresh_token, access_token_expires_at")
    .eq("open_id", shop.open_id)
    .maybeSingle();
  const token = tokenRow as TokenRow | null;
  if (!token?.refresh_token) throw new Error(`sem refresh_token para open_id ${shop.open_id}`);

  // 1) Renova access_token se necessário.
  let accessToken = token.access_token ?? "";
  const expiresAt = token.access_token_expires_at ? Date.parse(token.access_token_expires_at) : 0;
  if (!accessToken || expiresAt - Date.now() < REFRESH_SKEW_SECONDS * 1000) {
    const r = await refreshAccessToken(appKey, appSecret, token.refresh_token);
    accessToken = r.access_token;
    await supabase
      .from("tiktok_tokens")
      .update({
        access_token: r.access_token,
        refresh_token: r.refresh_token ?? token.refresh_token,
        access_token_expires_at: tsToIso(r.access_token_expire_in),
        refresh_token_expires_at: tsToIso(r.refresh_token_expire_in),
        updated_at: new Date().toISOString()
      })
      .eq("open_id", shop.open_id);
  }

  // 2) Página por página: search já traz o detalhe completo → upsert.
  const timeTo = Math.floor(Date.now() / 1000);
  const timeFrom = timeTo - windowMinutes * 60;
  let pageToken = "";
  let fetched = 0;
  let upserted = 0;
  let capped = false;
  do {
    const data = await searchOrders(appKey, appSecret, accessToken, shop.cipher, {
      update_time_ge: timeFrom,
      update_time_lt: timeTo
    }, pageToken);
    // deno-lint-ignore no-explicit-any
    const orders: any[] = data?.orders ?? [];
    if (orders.length) {
      upserted += await upsertOrders(supabase, shop, orders);
      fetched += orders.length;
    }
    pageToken = data?.next_page_token ?? "";
    if (fetched >= MAX_ORDERS_PER_RUN) {
      capped = true;
      break;
    }
  } while (pageToken);

  return { fetched, upserted, capped };
}

Deno.serve(async (req) => {
  // Mesmo esquema do shopee-sync: com TIKTOK_SYNC_SECRET setado, exige o
  // header x-sync-secret (o pg_cron envia). Sem o segredo, libera (setup).
  const expectedSecret = Deno.env.get("TIKTOK_SYNC_SECRET");
  if (expectedSecret && req.headers.get("x-sync-secret") !== expectedSecret) {
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
  const onlyShop = url.searchParams.get("shop_id");
  const windowMinutes = Number(url.searchParams.get("minutes")) || DEFAULT_WINDOW_MINUTES;

  const { data: config } = await supabase
    .from("tiktok_app_config")
    .select("app_key, app_secret")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!config?.app_key) {
    return new Response(JSON.stringify({ error: "tiktok_app_config vazio" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  let shopQuery = supabase.from("tiktok_shops").select("shop_id, open_id, shop_name, cipher").eq("is_active", true);
  if (onlyShop) shopQuery = shopQuery.eq("shop_id", onlyShop);
  const { data: shops } = await shopQuery;

  const results: Record<string, unknown>[] = [];
  for (const shop of (shops ?? []) as Shop[]) {
    const startedAt = new Date().toISOString();
    try {
      const { fetched, upserted, capped } = await syncShop(supabase, shop, config.app_key, config.app_secret, windowMinutes);
      await supabase.from("tiktok_sync_runs").insert({
        source: `tiktok-sync:${shop.shop_id}`,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: "success",
        records_fetched: fetched,
        records_upserted: upserted,
        meta: { shop_id: shop.shop_id, shop_name: shop.shop_name, window_minutes: windowMinutes, capped }
      });
      results.push({ shop_id: shop.shop_id, shop_name: shop.shop_name, fetched, upserted, capped, status: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase.from("tiktok_sync_runs").insert({
        source: `tiktok-sync:${shop.shop_id}`,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: "failed",
        error_message: message,
        meta: { shop_id: shop.shop_id, shop_name: shop.shop_name }
      });
      results.push({ shop_id: shop.shop_id, shop_name: shop.shop_name, status: "failed", error: message });
    }
  }

  return new Response(JSON.stringify({ ran_at: new Date().toISOString(), results }, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
});
