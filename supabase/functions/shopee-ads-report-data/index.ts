// Coleta read-only de Shopee Ads para o relatório periódico do n8n.
//
// Regra crítica: esta função NUNCA renova token. O único renovador é o
// shopee-sync. Se o token tiver menos de 10 minutos, a coleta é adiada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPEE_HOST = "https://partner.shopeemobile.com";
const CAMPAIGN_PAGE_SIZE = 100;
const MAX_CAMPAIGN_PAGES = 100;
const API_BATCH_SIZE = 100;
const PERFORMANCE_WINDOW_DAYS = 28;
const TOKEN_MIN_TTL_MS = 10 * 60 * 1000;
const MAX_RETRIES = 3;

type Shop = { shop_id: number; partner_id: number; shop_name: string | null };

const enc = new TextEncoder();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function shopGet(
  path: string,
  partnerId: number,
  partnerKey: string,
  shopId: number,
  accessToken: string,
  params: Record<string, string>
) {
  let lastError = "tentativas esgotadas";
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = await hmacSha256Hex(
      partnerKey,
      `${partnerId}${path}${timestamp}${accessToken}${shopId}`
    );
    const query = new URLSearchParams({
      partner_id: String(partnerId),
      timestamp: String(timestamp),
      access_token: accessToken,
      shop_id: String(shopId),
      sign,
      ...params
    });
    const response = await fetch(`${SHOPEE_HOST}${path}?${query.toString()}`);
    const body = await response.json().catch(() => ({}));
    const apiError = body?.error && body.error !== "-" && body.error !== "" ? body.error : null;
    const retryable = response.status === 429 || response.status >= 500 || apiError === "error_too_many_requests";
    if (response.ok && !apiError) return body.response ?? {};

    lastError = `${path}: HTTP ${response.status}, ${apiError ?? "erro_http"}, ${body?.message ?? "sem mensagem"}`;
    if (!retryable || attempt === MAX_RETRIES) break;
    await delay(attempt * 1500);
  }
  throw new Error(lastError);
}

function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!year || !month || !day || Number.isNaN(date.getTime())) throw new Error(`data inválida: ${value}`);
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function apiDate(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${date.getUTCFullYear()}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function brToday(): Date {
  const br = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  return parseIsoDate(br);
}

function windows(start: Date, end: Date): Array<{ start: Date; end: Date }> {
  const result: Array<{ start: Date; end: Date }> = [];
  let cursor = start;
  while (cursor <= end) {
    const windowEnd = new Date(Math.min(addDays(cursor, PERFORMANCE_WINDOW_DAYS - 1).getTime(), end.getTime()));
    result.push({ start: cursor, end: windowEnd });
    cursor = addDays(windowEnd, 1);
  }
  return result;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricDate(value: unknown): string | null {
  const parts = String(value ?? "").split("-");
  if (parts.length !== 3) return null;
  const [day, month, year] = parts;
  return `${year}-${month}-${day}`;
}

// deno-lint-ignore no-explicit-any
async function upsertInChunks(supabase: any, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (const batch of chunks(rows, 500)) {
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`upsert ${table}: ${error.message}`);
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
  const days = Math.max(6, Math.min(Number(url.searchParams.get("days") ?? 30), 180));
  const periodEnd = url.searchParams.get("end_date")
    ? parseIsoDate(String(url.searchParams.get("end_date")))
    : addDays(brToday(), -1);
  const periodStart = addDays(periodEnd, -(days - 1));

  if (!Number.isFinite(shopId) || shopId <= 0) return jsonResponse({ error: "shop_id obrigatório" }, 400);

  const startedAt = new Date().toISOString();
  const { data: run, error: runError } = await supabase
    .from("shopee_ads_collection_runs")
    .insert({
      shop_id: shopId,
      period_start: isoDate(periodStart),
      period_end: isoDate(periodEnd),
      status: "running",
      started_at: startedAt
    })
    .select("id")
    .single();
  if (runError) return jsonResponse({ error: `criar run: ${runError.message}` }, 500);

  try {
    const { data: shopRow, error: shopError } = await supabase
      .from("shopee_shops")
      .select("shop_id, partner_id, shop_name")
      .eq("shop_id", shopId)
      .eq("is_active", true)
      .maybeSingle();
    if (shopError || !shopRow) throw new Error(`loja ativa não encontrada: ${shopId}`);
    const shop = shopRow as Shop;

    const [{ data: token }, { data: app }] = await Promise.all([
      supabase.from("shopee_tokens")
        .select("access_token, access_token_expires_at")
        .eq("shop_id", shopId).maybeSingle(),
      supabase.from("shopee_app_config")
        .select("partner_key")
        .eq("partner_id", String(shop.partner_id)).eq("is_active", true).maybeSingle()
    ]);

    const accessToken = String(token?.access_token ?? "");
    const expiresAt = Date.parse(token?.access_token_expires_at ?? "");
    if (!accessToken || !app?.partner_key || !Number.isFinite(expiresAt)) {
      throw new Error("credencial Shopee ausente");
    }
    if (expiresAt - Date.now() < TOKEN_MIN_TTL_MS) {
      await supabase.from("shopee_ads_collection_runs").update({
        status: "deferred",
        finished_at: new Date().toISOString(),
        error_message: "token perto de expirar; shopee-sync fará a renovação"
      }).eq("id", run.id);
      return jsonResponse({
        ok: false, deferred: true, shop_id: shopId,
        message: "token perto de expirar; coleta adiada sem renovar"
      }, 409);
    }

    const campaignList: Record<string, unknown>[] = [];
    for (let page = 0; page < MAX_CAMPAIGN_PAGES; page += 1) {
      const response = await shopGet(
        "/api/v2/ads/get_product_level_campaign_id_list",
        shop.partner_id, app.partner_key, shopId, accessToken,
        { ad_type: "all", offset: String(page * CAMPAIGN_PAGE_SIZE), limit: String(CAMPAIGN_PAGE_SIZE) }
      );
      campaignList.push(...(Array.isArray(response?.campaign_list) ? response.campaign_list : []));
      if (!response?.has_next_page) break;
      await delay(100);
    }

    const campaignIds = [...new Set(campaignList.map((row) => String(row.campaign_id ?? "")).filter(Boolean))];
    const settings: Record<string, unknown>[] = [];
    for (const ids of chunks(campaignIds, API_BATCH_SIZE)) {
      const response = await shopGet(
        "/api/v2/ads/get_product_level_campaign_setting_info",
        shop.partner_id, app.partner_key, shopId, accessToken,
        { campaign_id_list: ids.join(","), info_type_list: "1,2,3,4" }
      );
      settings.push(...(Array.isArray(response?.campaign_list) ? response.campaign_list : []));
      await delay(100);
    }

    const now = new Date().toISOString();
    const listedById = new Map(campaignList.map((row) => [String(row.campaign_id), row]));
    const campaignRows = settings.map((setting) => {
      // deno-lint-ignore no-explicit-any
      const value = setting as any;
      const common = value.common_info ?? {};
      const auto = value.auto_bidding_info ?? {};
      const id = String(value.campaign_id);
      const status = String(common.campaign_status ?? "").toLowerCase();
      return {
        shop_id: shopId,
        campaign_id: id,
        ad_name: common.ad_name ?? null,
        campaign_status: status || null,
        is_active: status === "ongoing",
        ad_type: common.ad_type ?? listedById.get(id)?.ad_type ?? null,
        bidding_method: common.bidding_method ?? null,
        campaign_placement: common.campaign_placement ?? null,
        daily_budget: numberValue(common.campaign_budget),
        roas_target: numberValue(auto.roas_target),
        item_ids: (common.item_id_list ?? []).map(String),
        raw_settings: value,
        last_seen_at: now,
        updated_at: now
      };
    });

    // Só desativa o snapshot anterior depois que listagem + settings terminaram.
    const { error: deactivateError } = await supabase
      .from("shopee_ads_campaigns")
      .update({ is_active: false, updated_at: now })
      .eq("shop_id", shopId);
    if (deactivateError) throw new Error(`desativar snapshot anterior: ${deactivateError.message}`);
    await upsertInChunks(supabase, "shopee_ads_campaigns", campaignRows, "shop_id,campaign_id");

    const activeIds = campaignRows.filter((row) => row.is_active).map((row) => String(row.campaign_id));
    const dailyRows: Record<string, unknown>[] = [];
    for (const ids of chunks(activeIds, API_BATCH_SIZE)) {
      for (const window of windows(periodStart, periodEnd)) {
        const response = await shopGet(
          "/api/v2/ads/get_product_campaign_daily_performance",
          shop.partner_id, app.partner_key, shopId, accessToken,
          {
            campaign_id_list: ids.join(","),
            start_date: apiDate(window.start),
            end_date: apiDate(window.end)
          }
        );
        // deno-lint-ignore no-explicit-any
        for (const campaign of (response?.campaign_list ?? []) as any[]) {
          // deno-lint-ignore no-explicit-any
          for (const metric of (campaign.metrics_list ?? []) as any[]) {
            const date = metricDate(metric.date);
            if (!date) continue;
            dailyRows.push({
              shop_id: shopId,
              campaign_id: String(campaign.campaign_id),
              metric_date: date,
              impressions: numberValue(metric.impression),
              clicks: numberValue(metric.clicks),
              expense: numberValue(metric.expense),
              direct_orders: numberValue(metric.direct_order),
              direct_gmv: numberValue(metric.direct_gmv),
              broad_orders: numberValue(metric.broad_order),
              broad_gmv: numberValue(metric.broad_gmv),
              synced_at: now
            });
          }
        }
        await delay(150);
      }
    }
    await upsertInChunks(supabase, "shopee_ads_daily", dailyRows, "shop_id,campaign_id,metric_date");

    await supabase.from("shopee_ads_collection_runs").update({
      status: "success",
      campaigns_found: campaignIds.length,
      active_campaigns: activeIds.length,
      daily_rows_upserted: dailyRows.length,
      finished_at: new Date().toISOString(),
      meta: { shop_name: shop.shop_name, endpoint_count: 3 }
    }).eq("id", run.id);

    return jsonResponse({
      ok: true,
      run_id: run.id,
      shop_id: shopId,
      shop_name: shop.shop_name,
      period: { start: isoDate(periodStart), end: isoDate(periodEnd) },
      campaigns_found: campaignIds.length,
      active_campaigns: activeIds.length,
      daily_rows_upserted: dailyRows.length
    });
  } catch (error) {
    const message = String((error as Error).message ?? error);
    await supabase.from("shopee_ads_collection_runs").update({
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: message.slice(0, 2000)
    }).eq("id", run.id);
    return jsonResponse({ error: message, run_id: run.id, shop_id: shopId }, 500);
  }
});
