// Shopee SBS sync — inventário FBS (armazéns da Shopee) por SKU × armazém.
// A Shopee entrega prontos: estoque vendável/reservado, trânsito, cobertura,
// velocidade de venda e janelas 7/15/30/60/90d — este sync só materializa.
//
// NÃO renova token: a renovação é exclusiva do shopee-sync (refresh rotativo,
// renovador único). Se o token estiver a <2min de expirar, a loja é adiada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPEE_HOST = "https://partner.shopeemobile.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

type Shop = { shop_id: number; partner_id: number; shop_name: string | null };

const enc = new TextEncoder();

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function shopGet(
  path: string, partnerId: number, partnerKey: string, shopId: number,
  accessToken: string, params: Record<string, string>
) {
  const ts = Math.floor(Date.now() / 1000);
  const sign = await hmacSha256Hex(partnerKey, `${partnerId}${path}${ts}${accessToken}${shopId}`);
  const qs = new URLSearchParams({
    partner_id: String(partnerId), timestamp: String(ts),
    access_token: accessToken, shop_id: String(shopId), sign, ...params
  });
  const res = await fetch(`${SHOPEE_HOST}${path}?${qs.toString()}`);
  const json = await res.json();
  if (json.error && json.error !== "-") throw new Error(`${path} ${shopId}: ${json.error} ${json.message}`);
  return json;
}

// deno-lint-ignore no-explicit-any
async function syncShopSbs(supabase: any, shop: Shop, partnerKey: string) {
  const { data: token } = await supabase
    .from("shopee_tokens")
    .select("access_token, access_token_expires_at")
    .eq("shop_id", shop.shop_id)
    .maybeSingle();
  const expiresAt = token?.access_token_expires_at ? Date.parse(token.access_token_expires_at) : 0;
  if (!token?.access_token || expiresAt - Date.now() < 2 * 60 * 1000) {
    return { deferred: true, rows: 0 };
  }

  const nowIso = new Date().toISOString();
  const snapshotDate = nowIso.slice(0, 10);
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const inv = await shopGet(
      "/api/v2/sbs/get_current_inventory",
      shop.partner_id, partnerKey, shop.shop_id, token.access_token,
      { page_no: String(page), page_size: String(PAGE_SIZE), whs_region: "BR" }
    );
    const items = inv.response?.item_list ?? [];
    if (!items.length) break;

    for (const item of items) {
      for (const sku of item.sku_list ?? []) {
        const shopSku = sku.shop_sku_list?.[0] ?? {};
        for (const whs of sku.whs_list ?? []) {
          const modelId = String(sku.model_id ?? "0") || "0";
          rows.push({
            id: `${shop.shop_id}-${whs.whs_id}-${item.item_id}-${modelId}`,
            shop_id: shop.shop_id,
            whs_id: String(whs.whs_id ?? ""),
            item_id: String(item.item_id ?? ""),
            model_id: modelId,
            mtsku_id: sku.mtsku_id != null ? String(sku.mtsku_id) : null,
            item_name: item.item_name ?? null,
            model_name: sku.model_name ?? null,
            shop_item_id: shopSku.shop_item_id != null ? String(shopSku.shop_item_id) : null,
            shop_model_id: shopSku.shop_model_id != null ? String(shopSku.shop_model_id) : null,
            sellable_qty: Number(whs.sellable_qty ?? 0),
            reserved_qty: Number(whs.reserved_qty ?? 0),
            unsellable_qty: Number(whs.unsellable_qty ?? 0),
            in_transit_qty: Number(whs.in_transit_pending_putaway_qty ?? 0) + Number(whs.ir_approval_qty ?? 0),
            excess_stock: Number(whs.excess_stock ?? 0),
            coverage_days: whs.coverage_days ?? null,
            in_whs_coverage_days: whs.in_whs_coverage_days ?? null,
            selling_speed: Number(whs.selling_speed ?? 0),
            last_7_sold: Number(whs.last_7_sold ?? 0),
            last_15_sold: Number(whs.last_15_sold ?? 0),
            last_30_sold: Number(whs.last_30_sold ?? 0),
            last_60_sold: Number(whs.last_60_sold ?? 0),
            last_90_sold: Number(whs.last_90_sold ?? 0),
            stock_level: whs.stock_level ?? null,
            not_moving_tag: sku.not_moving_tag ?? null,
            raw_json: whs,
            synced_at: nowIso
          });
        }
      }
    }
    if (items.length < PAGE_SIZE) break;
  }

  // Estado atual: substitui o retrato da loja (itens que saíram do FBS somem)
  const { error: delErr } = await supabase.from("shopee_sbs_inventory").delete().eq("shop_id", shop.shop_id);
  if (delErr) throw new Error(`limpar sbs ${shop.shop_id}: ${delErr.message}`);
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("shopee_sbs_inventory").upsert(rows.slice(i, i + 200), { onConflict: "id" });
    if (error) throw new Error(`upsert sbs ${shop.shop_id}: ${error.message}`);
  }

  // Snapshot diário (idempotente por dia)
  const snapRows = rows.map((r) => ({
    shop_id: r.shop_id, whs_id: r.whs_id, item_id: r.item_id, model_id: r.model_id,
    snapshot_date: snapshotDate, sellable_qty: r.sellable_qty,
    in_transit_qty: r.in_transit_qty, selling_speed: r.selling_speed
  }));
  for (let i = 0; i < snapRows.length; i += 200) {
    const { error } = await supabase
      .from("shopee_sbs_snapshots")
      .upsert(snapRows.slice(i, i + 200), { onConflict: "shop_id,whs_id,item_id,model_id,snapshot_date" });
    if (error) throw new Error(`snapshot sbs ${shop.shop_id}: ${error.message}`);
  }

  return { deferred: false, rows: rows.length };
}

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get("SHOPEE_SYNC_SECRET");
  if (expectedSecret && req.headers.get("x-sync-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const url = new URL(req.url);
  const onlyShop = url.searchParams.get("shop_id");

  const { data: configs } = await supabase
    .from("shopee_app_config").select("partner_id, partner_key").eq("is_active", true);
  const keyByPartner = new Map<number, string>();
  for (const c of configs ?? []) keyByPartner.set(Number(c.partner_id), c.partner_key);

  let shopQuery = supabase.from("shopee_shops").select("shop_id, partner_id, shop_name").eq("is_active", true);
  if (onlyShop) shopQuery = shopQuery.eq("shop_id", Number(onlyShop));
  const { data: shops } = await shopQuery;

  const results: Record<string, unknown>[] = [];
  for (const shop of (shops ?? []) as Shop[]) {
    const startedAt = new Date().toISOString();
    try {
      const partnerKey = keyByPartner.get(Number(shop.partner_id));
      if (!partnerKey) throw new Error(`sem partner_key para partner ${shop.partner_id}`);
      const r = await syncShopSbs(supabase, shop, partnerKey);
      await supabase.from("shopee_sync_runs").insert({
        source: `shopee-sync-sbs:${shop.shop_id}`,
        started_at: startedAt, finished_at: new Date().toISOString(),
        status: "success", records_fetched: r.rows, records_upserted: r.rows,
        meta: { shop_id: shop.shop_id, shop_name: shop.shop_name, deferred: r.deferred }
      });
      results.push({ shop_id: shop.shop_id, ...r, status: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase.from("shopee_sync_runs").insert({
        source: `shopee-sync-sbs:${shop.shop_id}`,
        started_at: startedAt, finished_at: new Date().toISOString(),
        status: "error", error_message: message,
        meta: { shop_id: shop.shop_id, shop_name: shop.shop_name }
      });
      results.push({ shop_id: shop.shop_id, status: "error", error: message });
    }
  }

  return new Response(JSON.stringify({ ran_at: new Date().toISOString(), results }, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
});
