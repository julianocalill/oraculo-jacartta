// Shopee products sync — anúncios e estoque local por item/modelo (variação).
// Popula shopee_products (get_item_list → get_item_base_info → get_model_list),
// grava o snapshot diário e recalcula a série de vendas + agregados via RPC.
//
// NÃO renova token: renovação é exclusiva do shopee-sync (refresh rotativo,
// renovador único). Token a <2min de expirar → loja adiada para a próxima.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPEE_HOST = "https://partner.shopeemobile.com";
const LIST_PAGE_SIZE = 100;
const BASE_INFO_BATCH = 50;
const MAX_ITEMS_PER_RUN = 1500;

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

function tsToIso(v: unknown): string | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

// deno-lint-ignore no-explicit-any
function stockOf(node: any): number {
  // stock_info_v2.summary_info.total_available_stock (fallbacks defensivos)
  return Number(
    node?.stock_info_v2?.summary_info?.total_available_stock ??
    node?.stock_info_v2?.seller_stock?.[0]?.stock ??
    node?.normal_stock ?? node?.current_stock ?? 0
  );
}

// deno-lint-ignore no-explicit-any
async function syncShopProducts(supabase: any, shop: Shop, partnerKey: string) {
  const { data: token } = await supabase
    .from("shopee_tokens")
    .select("access_token, access_token_expires_at")
    .eq("shop_id", shop.shop_id)
    .maybeSingle();
  const expiresAt = token?.access_token_expires_at ? Date.parse(token.access_token_expires_at) : 0;
  if (!token?.access_token || expiresAt - Date.now() < 2 * 60 * 1000) {
    return { deferred: true, items: 0, models: 0, capped: false };
  }
  const accessToken = token.access_token;

  // 1) IDs dos anúncios (NORMAL + UNLIST; pausado/banido fica fora do estoque)
  const itemIds: number[] = [];
  let capped = false;
  for (const status of ["NORMAL", "UNLIST"]) {
    let offset = 0;
    for (let page = 0; page < 100; page++) {
      const list = await shopGet(
        "/api/v2/product/get_item_list",
        shop.partner_id, partnerKey, shop.shop_id, accessToken,
        { offset: String(offset), page_size: String(LIST_PAGE_SIZE), item_status: status }
      );
      // deno-lint-ignore no-explicit-any
      const ids = (list.response?.item ?? []).map((i: any) => Number(i.item_id));
      itemIds.push(...ids);
      if (!list.response?.has_next_page) break;
      offset = Number(list.response?.next_offset ?? offset + LIST_PAGE_SIZE);
      if (itemIds.length >= MAX_ITEMS_PER_RUN) { capped = true; break; }
    }
    if (capped) break;
  }

  const nowIso = new Date().toISOString();
  const snapshotDate = nowIso.slice(0, 10);
  // deno-lint-ignore no-explicit-any
  const productRows: any[] = [];

  // 2) Detalhe em lotes + modelos por item quando houver variação
  for (let i = 0; i < itemIds.length; i += BASE_INFO_BATCH) {
    const batch = itemIds.slice(i, i + BASE_INFO_BATCH);
    const info = await shopGet(
      "/api/v2/product/get_item_base_info",
      shop.partner_id, partnerKey, shop.shop_id, accessToken,
      { item_id_list: batch.join(","), need_tax_info: "false", need_complaint_policy: "false" }
    );
    for (const item of info.response?.item_list ?? []) {
      const base = {
        shop_id: shop.shop_id,
        item_id: String(item.item_id),
        item_name: item.item_name ?? null,
        item_sku: item.item_sku || null,
        item_status: item.item_status ?? null,
        category_id: item.category_id != null ? String(item.category_id) : null,
        brand_name: item.brand?.original_brand_name ?? null,
        price_min: item.price_info?.[0]?.current_price ?? null,
        price_max: item.price_info?.[0]?.current_price ?? null,
        weight: item.weight != null ? String(item.weight) : null,
        create_time: tsToIso(item.create_time),
        update_time: tsToIso(item.update_time),
        image_url: item.image?.image_url_list?.[0] ?? null,
        synced_at: nowIso
      };

      if (item.has_model) {
        const models = await shopGet(
          "/api/v2/product/get_model_list",
          shop.partner_id, partnerKey, shop.shop_id, accessToken,
          { item_id: String(item.item_id) }
        );
        // deno-lint-ignore no-explicit-any
        const tierNames = (models.response?.tier_variation ?? []).map((t: any) =>
          // deno-lint-ignore no-explicit-any
          (t.option_list ?? []).map((o: any) => o.option ?? "")
        );
        for (const model of models.response?.model ?? []) {
          const modelName =
            model.model_name ??
            (model.tier_index ?? [])
              .map((ti: number, level: number) => tierNames[level]?.[ti] ?? "")
              .filter(Boolean)
              .join(" · ") ?? null;
          productRows.push({
            ...base,
            id: `${shop.shop_id}-${item.item_id}-${model.model_id}`,
            model_id: String(model.model_id),
            model_name: modelName,
            model_sku: model.model_sku || null,
            model_status: model.model_status ?? null,
            model_price: model.price_info?.[0]?.current_price ?? null,
            model_stock: stockOf(model),
            stock_total: stockOf(model),
            raw_json: model
          });
        }
      } else {
        productRows.push({
          ...base,
          id: `${shop.shop_id}-${item.item_id}-0`,
          model_id: "0",
          model_name: null,
          model_sku: null,
          model_status: null,
          model_price: base.price_min,
          model_stock: stockOf(item),
          stock_total: stockOf(item),
          raw_json: item
        });
      }
    }
  }

  // 3) Upsert + snapshot diário
  for (let i = 0; i < productRows.length; i += 200) {
    const { error } = await supabase.from("shopee_products").upsert(productRows.slice(i, i + 200), { onConflict: "id" });
    if (error) throw new Error(`upsert products ${shop.shop_id}: ${error.message}`);
  }
  const snapRows = productRows.map((r) => ({
    shop_id: r.shop_id, item_id: r.item_id, model_id: r.model_id ?? "0",
    snapshot_date: snapshotDate, stock: r.model_stock ?? 0
  }));
  for (let i = 0; i < snapRows.length; i += 200) {
    const { error } = await supabase
      .from("shopee_product_snapshots")
      .upsert(snapRows.slice(i, i + 200), { onConflict: "shop_id,item_id,model_id,snapshot_date" });
    if (error) throw new Error(`snapshot products ${shop.shop_id}: ${error.message}`);
  }

  const models = productRows.filter((r) => r.model_id !== "0").length;
  return { deferred: false, items: itemIds.length, models, capped };
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
      const r = await syncShopProducts(supabase, shop, partnerKey);
      await supabase.from("shopee_sync_runs").insert({
        source: `shopee-sync-products:${shop.shop_id}`,
        started_at: startedAt, finished_at: new Date().toISOString(),
        status: "success", records_fetched: r.items, records_upserted: r.items + r.models,
        meta: { shop_id: shop.shop_id, shop_name: shop.shop_name, deferred: r.deferred, capped: r.capped }
      });
      results.push({ shop_id: shop.shop_id, ...r, status: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase.from("shopee_sync_runs").insert({
        source: `shopee-sync-products:${shop.shop_id}`,
        started_at: startedAt, finished_at: new Date().toISOString(),
        status: "error", error_message: message,
        meta: { shop_id: shop.shop_id, shop_name: shop.shop_name }
      });
      results.push({ shop_id: shop.shop_id, status: "error", error: message });
    }
  }

  // Série de vendas + agregados (uma vez por invocação, cobre todas as lojas)
  try {
    await supabase.rpc("shopee_refresh_sales_daily");
    await supabase.rpc("shopee_refresh_product_aggregates");
  } catch (err) {
    console.error("refresh RPCs:", err instanceof Error ? err.message : String(err));
  }

  return new Response(JSON.stringify({ ran_at: new Date().toISOString(), results }, null, 2), {
    headers: { "Content-Type": "application/json" }
  });
});
