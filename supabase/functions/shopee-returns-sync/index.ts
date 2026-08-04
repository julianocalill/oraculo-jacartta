// Shopee returns sync — devoluções/reembolsos por loja via returns.get_return_list.
//
// Alimenta a camada canônica oraculo_returns (ver docs/plano-devolucoes.md).
// Não existe tabela intermediária por canal: a resposta da Shopee já é uma
// devolução por linha, então o upsert vai direto para a canônica com o payload
// completo em `raw`.
//
// ⚠️ Regra de ouro — esta função NUNCA renova token. O único renovador é o
// shopee-sync (a Shopee rotaciona o refresh_token; dois renovadores em corrida
// quebram a autenticação). Loja com token perto de expirar é pulada; o
// shopee-sync roda a cada 15 min e renova antes.
//
// ⚠️ A Shopee limita a janela create_time a 15 DIAS. Medido na marra: pedir
// 16 dias devolve `error_param ... must not more than 15 days` e a janela
// inteira volta vazia, sem falhar o processo — ou seja, o dado some em
// silêncio. Por isso a janela pedida é sempre quebrada em blocos de 14 dias.
//
// A cada invocação, para cada loja ativa (ou uma só via ?shop_id=):
//   1. lê o access_token vigente (pula a loja se faltar < 5 min de validade);
//   2. varre a janela (?days=N, default 3; ?from=&?to= para backfill) em
//      blocos de 14 dias, paginando page_no/page_size até `more=false`;
//   3. upsert em oraculo_returns (channel 'shopee', return_id = return_sn);
//   4. registra a execução em shopee_sync_runs (source shopee-returns-sync:<id>).
//
// Idempotente: reprocessar a mesma janela atualiza as mesmas linhas.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPEE_HOST = "https://partner.shopeemobile.com";
const PAGE_SIZE = 50;
const MAX_PAGES = 60;
const CHUNK_DAYS = 14;            // teto da Shopee é 15; 14 dá folga de fuso
const TOKEN_MIN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_DAYS = 3;

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
  if (json.error && json.error !== "-" && json.error !== "") {
    throw new Error(`${path} ${shopId}: ${json.error} ${json.message}`);
  }
  return json;
}

// status da Shopee -> vocabulário canônico.
// REQUESTED/PROCESSING = ainda em decisão; ACCEPTED = reembolso concedido;
// CANCELLED = pedido de devolução cancelado (não houve reembolso);
// JUDGING/SELLER_DISPUTE = em disputa, ainda em aberto.
const STATUS_MAP: Record<string, string> = {
  REQUESTED: "aberta",
  PROCESSING: "aberta",
  JUDGING: "aberta",
  SELLER_DISPUTE: "aberta",
  ACCEPTED: "aceita",
  SELLER_DISPUTE_SUCCESS: "recusada",
  REFUND_PAID: "aceita",
  CLOSED: "recusada",
  CANCELLED: "cancelada"
};

// return_solution: 1 = devolução com produto, 0 = só reembolso.
function returnType(solution: unknown): string | null {
  const n = Number(solution);
  if (!Number.isFinite(n)) return null;
  return n === 1 ? "return_and_refund" : "refund_only";
}

function isoOrNull(epochSeconds: unknown): string | null {
  const n = Number(epochSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// deno-lint-ignore no-explicit-any
function mapReturn(shop: Shop, r: any, reasonMap: Map<string, string>) {
  // A Shopee entrega os itens da devolução em `item[]`. A canônica é uma linha
  // por devolução, então o SKU e o nome saem do item principal (ou do primeiro)
  // e a lista completa fica em `raw` — nenhum dado é perdido.
  const items: any[] = Array.isArray(r.item) ? r.item : [];
  const main = items.find((i) => i.is_main_item) ?? items[0] ?? null;
  const qty = items.reduce((sum, i) => sum + (num(i.amount) ?? 0), 0);
  const status = STATUS_MAP[String(r.status)] ?? "aberta";

  return {
    channel: "shopee",
    return_id: String(r.return_sn),
    account_ref: shop.shop_name ?? String(shop.shop_id),
    order_ref: r.order_sn ? String(r.order_sn) : null,
    sku_channel: main?.item_sku ? String(main.item_sku) : null,
    sku_olist: null,
    product_name: main?.name ? String(main.name) : null,
    qty: qty > 0 ? qty : 1,
    qty_assumed: !(qty > 0),
    opened_at: isoOrNull(r.create_time),
    closed_at: status === "aberta" ? null : isoOrNull(r.update_time),
    status,
    return_type: returnType(r.return_solution),
    reason_raw: r.reason ? String(r.reason) : null,
    reason_group: reasonMap.get(String(r.reason)) ?? "outros",
    refund_amount: num(r.refund_amount),
    order_amount: num(r.amount_before_discount),
    buyer_note: r.text_reason ? String(r.text_reason) : null,
    source: "api",
    raw: {
      shop_id: shop.shop_id,
      status_raw: r.status,
      return_solution: r.return_solution,
      return_refund_type: r.return_refund_type,
      negotiation_status: r.negotiation_status,
      seller_proof_status: r.seller_proof_status,
      seller_compensation_status: r.seller_compensation_status,
      needs_logistics: r.needs_logistics,
      tracking_number: r.tracking_number,
      due_date: isoOrNull(r.due_date),
      items
    }
  };
}

// deno-lint-ignore no-explicit-any
async function syncShop(
  supabase: any, shop: Shop, partnerKey: string,
  fromSec: number, toSec: number, reasonMap: Map<string, string>
) {
  const { data: tokenRow } = await supabase
    .from("shopee_tokens")
    .select("access_token, access_token_expires_at")
    .eq("shop_id", shop.shop_id)
    .maybeSingle();
  const accessToken: string = tokenRow?.access_token ?? "";
  const expiresAt = tokenRow?.access_token_expires_at ? Date.parse(tokenRow.access_token_expires_at) : 0;
  if (!accessToken || expiresAt - Date.now() < TOKEN_MIN_TTL_MS) {
    return { upserted: 0, skipped: "token ausente ou perto de expirar; shopee-sync renova" };
  }

  let upserted = 0;
  const chunk = CHUNK_DAYS * 24 * 3600;

  for (let start = fromSec; start < toSec; start += chunk) {
    const end = Math.min(start + chunk, toSec);
    for (let page = 0; page < MAX_PAGES; page++) {
      const json = await shopGet(
        "/api/v2/returns/get_return_list",
        shop.partner_id, partnerKey, shop.shop_id, accessToken,
        {
          page_no: String(page),
          page_size: String(PAGE_SIZE),
          create_time_from: String(start),
          create_time_to: String(end)
        }
      );
      const list = json.response?.return ?? [];
      if (list.length > 0) {
        const rows = list.map((r: unknown) => mapReturn(shop, r, reasonMap));
        const { error } = await supabase
          .from("oraculo_returns")
          .upsert(rows, { onConflict: "channel,return_id" });
        if (error) throw new Error(`upsert loja ${shop.shop_id}: ${error.message}`);
        upserted += rows.length;
      }
      if (!json.response?.more) break;
    }
  }

  return { upserted };
}

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get("SHOPEE_SYNC_SECRET");
  if (expectedSecret && req.headers.get("x-sync-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const url = new URL(req.url);
  const onlyShop = url.searchParams.get("shop_id");
  const days = Number(url.searchParams.get("days") ?? DEFAULT_DAYS);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const toSec = toParam ? Math.floor(Date.parse(toParam) / 1000) : Math.floor(Date.now() / 1000);
  const fromSec = fromParam
    ? Math.floor(Date.parse(fromParam) / 1000)
    : toSec - Math.max(days, 1) * 24 * 3600;

  const startedAt = new Date().toISOString();
  const results: Record<string, unknown>[] = [];

  try {
    const { data: reasonRows } = await supabase
      .from("oraculo_return_reason_map")
      .select("reason_raw, reason_group")
      .eq("channel", "shopee");
    const reasonMap = new Map<string, string>(
      (reasonRows ?? []).map((r: { reason_raw: string; reason_group: string }) => [r.reason_raw, r.reason_group])
    );

    const { data: configs } = await supabase
      .from("shopee_app_config").select("partner_id, partner_key").eq("is_active", true);
    const keyByPartner = new Map<number, string>(
      (configs ?? []).map((c: { partner_id: number; partner_key: string }) => [Number(c.partner_id), c.partner_key])
    );

    let shopQuery = supabase
      .from("shopee_shops").select("shop_id, partner_id, shop_name").eq("is_active", true);
    if (onlyShop) shopQuery = shopQuery.eq("shop_id", Number(onlyShop));
    const { data: shops } = await shopQuery;

    for (const shop of (shops ?? []) as Shop[]) {
      const partnerKey = keyByPartner.get(Number(shop.partner_id));
      if (!partnerKey) {
        results.push({ shop_id: shop.shop_id, error: `sem partner_key para partner_id ${shop.partner_id}` });
        continue;
      }
      try {
        const out = await syncShop(supabase, shop, partnerKey, fromSec, toSec, reasonMap);
        results.push({ shop_id: shop.shop_id, shop_name: shop.shop_name, ...out });
      } catch (error) {
        results.push({ shop_id: shop.shop_id, error: String((error as Error).message ?? error) });
      }
    }

    const totalUpserted = results.reduce((sum, r) => sum + (Number(r.upserted) || 0), 0);
    const failed = results.filter((r) => r.error).length;

    await supabase.from("shopee_sync_runs").insert({
      source: `shopee-returns-sync${onlyShop ? `:${onlyShop}` : ""}`,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: failed === 0 ? "success" : (totalUpserted > 0 ? "partial" : "error"),
      records_upserted: totalUpserted,
      error_message: failed > 0 ? JSON.stringify(results.filter((r) => r.error)) : null
    });

    return new Response(
      JSON.stringify({
        window: { from: new Date(fromSec * 1000).toISOString(), to: new Date(toSec * 1000).toISOString() },
        upserted: totalUpserted,
        shops: results
      }, null, 2),
      { headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: String((error as Error).message ?? error), shops: results }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
});
