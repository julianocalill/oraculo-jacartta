// Shopee sync — traz pedidos das lojas Shopee para dentro do Oráculo.
//
// Fonte única de verdade dos tokens: as tabelas shopee_app_config / shopee_shops
// / shopee_tokens deste projeto. Esta função é o ÚNICO renovador de token — o
// fluxo de renovação do n8n precisa estar DESLIGADO para estas lojas (a Shopee
// rotaciona o refresh_token a cada uso; dois renovadores quebram a autenticação).
//
// A cada invocação, para cada loja ativa (ou uma só via ?shop_id=):
//   1. renova o access_token se estiver perto de expirar (usa o refresh_token);
//   2. lista pedidos alterados na janela (get_order_list, paginado por cursor);
//   3. busca o detalhe em lotes de 50 (get_order_detail);
//   4. faz upsert em shopee_orders / shopee_order_items;
//   5. registra a execução em shopee_sync_runs.
//
// Agendada por pg_cron + pg_net (ver migration de schedule). Idempotente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPEE_HOST = "https://partner.shopeemobile.com";
const REFRESH_SKEW_SECONDS = 30 * 60; // renova se faltar menos de 30 min
const DEFAULT_WINDOW_MINUTES = 45; // janela incremental padrão (sobreposição de segurança)
const MAX_ORDERS_PER_RUN = 800; // teto por execução, respeita o limite de tempo da edge function
const PAGE_SIZE = 50;
const ORDER_FIELDS =
  "order_status,create_time,update_time,pay_time,total_amount,currency,buyer_user_id,buyer_username,recipient_address,item_list,estimated_shipping_fee,actual_shipping_fee,days_to_ship,note";

type Shop = { shop_id: number; partner_id: number; shop_name: string | null };
type TokenRow = {
  shop_id: number;
  partner_id: number;
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

// Assinatura de API pública (token get/refresh): partner_id + path + timestamp.
async function signPublic(partnerId: number, path: string, ts: number, partnerKey: string) {
  return hmacSha256Hex(partnerKey, `${partnerId}${path}${ts}`);
}

// Assinatura de API de loja: partner_id + path + timestamp + access_token + shop_id.
async function signShop(
  partnerId: number,
  path: string,
  ts: number,
  accessToken: string,
  shopId: number,
  partnerKey: string
) {
  return hmacSha256Hex(partnerKey, `${partnerId}${path}${ts}${accessToken}${shopId}`);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

async function refreshAccessToken(
  partnerId: number,
  partnerKey: string,
  shopId: number,
  refreshToken: string
): Promise<{ access_token: string; refresh_token: string; expire_in: number }> {
  const path = "/api/v2/auth/access_token/get";
  const ts = nowSec();
  const sign = await signPublic(partnerId, path, ts, partnerKey);
  const url = `${SHOPEE_HOST}${path}?partner_id=${partnerId}&timestamp=${ts}&sign=${sign}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partner_id: partnerId, shop_id: shopId, refresh_token: refreshToken })
  });
  const json = await res.json();
  if (json.error) throw new Error(`refresh ${shopId}: ${json.error} ${json.message}`);
  return { access_token: json.access_token, refresh_token: json.refresh_token, expire_in: json.expire_in };
}

async function shopGet(
  path: string,
  partnerId: number,
  partnerKey: string,
  shopId: number,
  accessToken: string,
  params: Record<string, string>
) {
  const ts = nowSec();
  const sign = await signShop(partnerId, path, ts, accessToken, shopId, partnerKey);
  const qs = new URLSearchParams({
    partner_id: String(partnerId),
    timestamp: String(ts),
    access_token: accessToken,
    shop_id: String(shopId),
    sign,
    ...params
  });
  const res = await fetch(`${SHOPEE_HOST}${path}?${qs.toString()}`);
  const json = await res.json();
  if (json.error) throw new Error(`${path} ${shopId}: ${json.error} ${json.message}`);
  return json;
}

function tsToIso(v: unknown): string | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

// deno-lint-ignore no-explicit-any
async function upsertOrders(supabase: any, shop: Shop, orders: any[]): Promise<number> {
  if (!orders.length) return 0;
  const nowIso = new Date().toISOString();

  // deno-lint-ignore no-explicit-any
  const orderRows = orders.map((o: any) => ({
    id: `${shop.shop_id}-${o.order_sn}`,
    shop_id: shop.shop_id,
    shop_name: shop.shop_name,
    order_sn: o.order_sn,
    order_status: o.order_status ?? null,
    create_time: tsToIso(o.create_time),
    update_time: tsToIso(o.update_time),
    pay_time: tsToIso(o.pay_time),
    total_amount: o.total_amount ?? null,
    estimated_shipping_fee: o.estimated_shipping_fee ?? null,
    actual_shipping_fee: o.actual_shipping_fee ?? null,
    currency: o.currency ?? null,
    buyer_user_id: o.buyer_user_id != null ? String(o.buyer_user_id) : null,
    buyer_username: o.buyer_username ?? null,
    recipient_name: o.recipient_address?.name ?? null,
    recipient_phone: o.recipient_address?.phone ?? null,
    recipient_city: o.recipient_address?.city ?? null,
    recipient_state: o.recipient_address?.state ?? null,
    days_to_ship: o.days_to_ship ?? null,
    note: o.note ?? null,
    raw_json: o,
    synced_at: nowIso
  }));

  // deno-lint-ignore no-explicit-any
  const itemRows = orders.flatMap((o: any) =>
    (o.item_list ?? []).map((it: any) => ({
      id: `${shop.shop_id}-${o.order_sn}-${it.item_id}-${it.model_id ?? 0}`,
      order_id: `${shop.shop_id}-${o.order_sn}`,
      shop_id: shop.shop_id,
      order_sn: o.order_sn,
      item_id: it.item_id != null ? String(it.item_id) : null,
      item_name: it.item_name ?? null,
      model_id: it.model_id != null ? String(it.model_id) : null,
      model_name: it.model_name ?? null,
      sku: it.model_sku || it.item_sku || null,
      quantity: it.model_quantity_purchased ?? it.quantity_purchased ?? null,
      raw_json: it,
      synced_at: nowIso
    }))
  );

  const { error: oErr } = await supabase.from("shopee_orders").upsert(orderRows, { onConflict: "id" });
  if (oErr) throw new Error(`upsert orders ${shop.shop_id}: ${oErr.message}`);
  if (itemRows.length) {
    const { error: iErr } = await supabase.from("shopee_order_items").upsert(itemRows, { onConflict: "id" });
    if (iErr) throw new Error(`upsert items ${shop.shop_id}: ${iErr.message}`);
  }
  return orderRows.length;
}

// deno-lint-ignore no-explicit-any
async function syncShop(
  supabase: any,
  shop: Shop,
  keyByPartner: Map<number, string>,
  windowMinutes: number
): Promise<{ fetched: number; upserted: number; capped: boolean }> {
  const partnerKey = keyByPartner.get(shop.partner_id);
  if (!partnerKey) throw new Error(`sem partner_key para partner_id ${shop.partner_id} (loja ${shop.shop_id})`);

  const { data: tokenRow } = await supabase
    .from("shopee_tokens")
    .select("shop_id, partner_id, access_token, refresh_token, access_token_expires_at")
    .eq("shop_id", shop.shop_id)
    .maybeSingle();
  const token = tokenRow as TokenRow | null;
  if (!token?.refresh_token) throw new Error(`sem refresh_token para loja ${shop.shop_id}`);

  // 1) Renova access_token se necessário.
  let accessToken = token.access_token ?? "";
  const expiresAt = token.access_token_expires_at ? Date.parse(token.access_token_expires_at) : 0;
  const needsRefresh = !accessToken || expiresAt - Date.now() < REFRESH_SKEW_SECONDS * 1000;
  if (needsRefresh) {
    const r = await refreshAccessToken(shop.partner_id, partnerKey, shop.shop_id, token.refresh_token);
    accessToken = r.access_token;
    await supabase
      .from("shopee_tokens")
      .update({
        access_token: r.access_token,
        refresh_token: r.refresh_token,
        access_token_expires_at: new Date(Date.now() + r.expire_in * 1000).toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("shop_id", shop.shop_id);
  }

  // 2) Página por página: lista → detalhe → upsert (progresso persiste a cada
  // página; teto por execução respeita o limite de tempo da edge function).
  const timeTo = nowSec();
  const timeFrom = timeTo - windowMinutes * 60;
  let cursor = "";
  let fetched = 0;
  let upserted = 0;
  let capped = false;
  do {
    const list = await shopGet("/api/v2/order/get_order_list", shop.partner_id, partnerKey, shop.shop_id, accessToken, {
      time_range_field: "update_time",
      time_from: String(timeFrom),
      time_to: String(timeTo),
      page_size: String(PAGE_SIZE),
      cursor,
      response_optional_fields: "order_status"
    });
    // deno-lint-ignore no-explicit-any
    const sns = (list.response?.order_list ?? []).map((o: any) => o.order_sn);
    if (sns.length) {
      const detail = await shopGet("/api/v2/order/get_order_detail", shop.partner_id, partnerKey, shop.shop_id, accessToken, {
        order_sn_list: sns.join(","),
        response_optional_fields: ORDER_FIELDS
      });
      upserted += await upsertOrders(supabase, shop, detail.response?.order_list ?? []);
      fetched += sns.length;
    }
    cursor = list.response?.more ? list.response?.next_cursor ?? "" : "";
    if (fetched >= MAX_ORDERS_PER_RUN) {
      capped = true;
      break;
    }
  } while (cursor);

  return { fetched, upserted, capped };
}

Deno.serve(async (req) => {
  // Proteção: uma vez que SHOPEE_SYNC_SECRET esteja setado, exige o header
  // x-sync-secret (o agendador pg_cron envia). Sem o segredo setado, libera
  // (fase de setup). Assim o endpoint não fica aberto em produção.
  const expectedSecret = Deno.env.get("SHOPEE_SYNC_SECRET");
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

  // Carrega partner_keys e lojas ativas.
  const { data: configs } = await supabase.from("shopee_app_config").select("partner_id, partner_key, is_active").eq("is_active", true);
  const keyByPartner = new Map<number, string>();
  for (const c of configs ?? []) keyByPartner.set(Number(c.partner_id), c.partner_key);

  let shopQuery = supabase.from("shopee_shops").select("shop_id, partner_id, shop_name").eq("is_active", true);
  if (onlyShop) shopQuery = shopQuery.eq("shop_id", Number(onlyShop));
  const { data: shops } = await shopQuery;

  const results: Record<string, unknown>[] = [];
  for (const shop of (shops ?? []) as Shop[]) {
    const startedAt = new Date().toISOString();
    try {
      const { fetched, upserted, capped } = await syncShop(supabase, shop, keyByPartner, windowMinutes);
      await supabase.from("shopee_sync_runs").insert({
        source: `shopee-sync:${shop.shop_id}`,
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
      await supabase.from("shopee_sync_runs").insert({
        source: `shopee-sync:${shop.shop_id}`,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: "error",
        error_message: message,
        meta: { shop_id: shop.shop_id, shop_name: shop.shop_name }
      });
      results.push({ shop_id: shop.shop_id, shop_name: shop.shop_name, status: "error", error: message });
    }
  }

  return new Response(JSON.stringify({ ran_at: new Date().toISOString(), results }, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
});
