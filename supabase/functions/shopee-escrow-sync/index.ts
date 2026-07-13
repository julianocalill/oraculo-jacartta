// Shopee escrow sync — extrato financeiro por pedido (comissão, taxas,
// vouchers, líquido a receber) via payment.get_escrow_detail.
//
// Papel: a Shopee direta é camada de double-check + insumos de ROI; o Olist
// segue como fonte primária de receita. O get_order_detail (shopee-sync) não
// traz comissão/escrow — por isso esta função existe.
//
// ⚠️ Regra de ouro — esta função NUNCA renova token. O único renovador é o
// shopee-sync (a Shopee rotaciona o refresh_token; dois renovadores em corrida
// quebram a autenticação). Se o access_token estiver perto de expirar, o run
// da loja é pulado — o shopee-sync roda a cada 15 min e renova antes.
//
// A cada invocação, para cada loja ativa (ou uma só via ?shop_id=):
//   1. lê o access_token vigente (pula a loja se faltar < 5 min de validade);
//   2. pega até `limit` pedidos COMPLETED sem escrow (rpc shopee_escrow_pending,
//      mais antigos primeiro; erros são retentados até 5x);
//   3. chama get_escrow_detail pedido a pedido e faz upsert em
//      shopee_order_escrow (status success/error por pedido);
//   4. registra a execução em shopee_sync_runs (source shopee-escrow-sync:<id>).
//
// Idempotente. Backlog limitado por `since` (default 2026-07-01 — decisão de
// negócio: sem backfill histórico; ampliar é mudar um parâmetro).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPEE_HOST = "https://partner.shopeemobile.com";
const DEFAULT_LIMIT = 80; // ~1 chamada/pedido; cabe com folga no tempo da edge function
const DEFAULT_SINCE = "2026-07-01T00:00:00Z";
const TOKEN_MIN_TTL_MS = 5 * 60 * 1000; // não competir com o renovador (shopee-sync)

type Shop = { shop_id: number; partner_id: number; shop_name: string | null };
type Pending = { order_sn: string; attempts: number };

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

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// deno-lint-ignore no-explicit-any
async function syncEscrow(
  supabase: any,
  shop: Shop,
  keyByPartner: Map<number, string>,
  limit: number,
  since: string
): Promise<{ pending: number; upserted: number; failed: number; skipped?: string }> {
  const partnerKey = keyByPartner.get(shop.partner_id);
  if (!partnerKey) throw new Error(`sem partner_key para partner_id ${shop.partner_id} (loja ${shop.shop_id})`);

  // Token vigente — sem renovação aqui (ver regra de ouro no topo).
  const { data: tokenRow } = await supabase
    .from("shopee_tokens")
    .select("access_token, access_token_expires_at")
    .eq("shop_id", shop.shop_id)
    .maybeSingle();
  const accessToken: string = tokenRow?.access_token ?? "";
  const expiresAt = tokenRow?.access_token_expires_at ? Date.parse(tokenRow.access_token_expires_at) : 0;
  if (!accessToken || expiresAt - Date.now() < TOKEN_MIN_TTL_MS) {
    return { pending: 0, upserted: 0, failed: 0, skipped: "token ausente ou perto de expirar; shopee-sync renova" };
  }

  const { data: pendingRows, error: pErr } = await supabase.rpc("shopee_escrow_pending", {
    p_shop_id: shop.shop_id,
    p_since: since,
    p_limit: limit
  });
  if (pErr) throw new Error(`shopee_escrow_pending ${shop.shop_id}: ${pErr.message}`);
  const pending = (pendingRows ?? []) as Pending[];
  if (!pending.length) return { pending: 0, upserted: 0, failed: 0 };

  const nowIso = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  let failed = 0;

  for (const p of pending) {
    const base = {
      id: `${shop.shop_id}-${p.order_sn}`,
      shop_id: shop.shop_id,
      order_sn: p.order_sn,
      attempts: p.attempts + 1,
      synced_at: nowIso
    };
    try {
      const res = await shopGet(
        "/api/v2/payment/get_escrow_detail",
        shop.partner_id,
        partnerKey,
        shop.shop_id,
        accessToken,
        { order_sn: p.order_sn }
      );
      const r = res.response ?? {};
      const oi = r.order_income ?? {};
      rows.push({
        ...base,
        status: "success",
        error_message: null,
        escrow_amount: num(oi.escrow_amount),
        buyer_total_amount: num(oi.buyer_total_amount),
        original_price: num(oi.original_price),
        seller_discount: num(oi.seller_discount),
        shopee_discount: num(oi.shopee_discount),
        voucher_from_seller: num(oi.voucher_from_seller),
        voucher_from_shopee: num(oi.voucher_from_shopee),
        commission_fee: num(oi.commission_fee),
        service_fee: num(oi.service_fee),
        seller_transaction_fee: num(oi.seller_transaction_fee),
        escrow_tax: num(oi.escrow_tax),
        actual_shipping_fee: num(oi.actual_shipping_fee),
        buyer_paid_shipping_fee: num(oi.buyer_paid_shipping_fee),
        final_shipping_fee: num(oi.final_shipping_fee),
        shopee_shipping_rebate: num(oi.shopee_shipping_rebate),
        shipping_fee_discount_from_3pl: num(oi.shipping_fee_discount_from_3pl),
        seller_shipping_discount: num(oi.seller_shipping_discount),
        drc_adjustable_refund: num(oi.drc_adjustable_refund),
        items: oi.items ?? null,
        raw_json: r
      });
    } catch (err) {
      failed += 1;
      rows.push({
        ...base,
        status: "error",
        error_message: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const { error: uErr } = await supabase.from("shopee_order_escrow").upsert(rows, { onConflict: "id" });
  if (uErr) throw new Error(`upsert escrow ${shop.shop_id}: ${uErr.message}`);

  return { pending: pending.length, upserted: rows.length - failed, failed };
}

Deno.serve(async (req) => {
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
  const limit = Number(url.searchParams.get("limit")) || DEFAULT_LIMIT;
  const since = url.searchParams.get("since") || DEFAULT_SINCE;

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
      const r = await syncEscrow(supabase, shop, keyByPartner, limit, since);
      await supabase.from("shopee_sync_runs").insert({
        source: `shopee-escrow-sync:${shop.shop_id}`,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: r.skipped ? "skipped" : "success",
        records_fetched: r.pending,
        records_upserted: r.upserted,
        meta: { shop_id: shop.shop_id, shop_name: shop.shop_name, failed: r.failed, since, limit, skipped: r.skipped ?? null }
      });
      results.push({ shop_id: shop.shop_id, shop_name: shop.shop_name, ...r, status: r.skipped ? "skipped" : "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase.from("shopee_sync_runs").insert({
        source: `shopee-escrow-sync:${shop.shop_id}`,
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
