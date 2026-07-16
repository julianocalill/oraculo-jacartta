// Sincroniza anúncios, estoque Full e vendas do Mercado Livre para as tabelas
// de ingestão. Esta é a ÚNICA função autorizada a renovar o refresh token
// rotativo em mercadolivre_tokens (ver docs/mercadolivre-integration.md).
// Somente GET na API do ML; nada é alterado na conta do seller.
import { createClient } from "npm:@supabase/supabase-js@2";

const ML_API = "https://api.mercadolibre.com";

const env = {
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  supabaseServiceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  appId: Deno.env.get("MERCADOLIVRE_APP_ID") ?? "",
  clientSecret: Deno.env.get("MERCADOLIVRE_CLIENT_SECRET") ?? "",
  syncJobSecret: Deno.env.get("MERCADOLIVRE_SYNC_JOB_SECRET") ?? ""
};

type Supabase = ReturnType<typeof createClient>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function requireEnv(name: string, value: string) {
  if (!value) throw new Error(`Configuração ausente: ${name}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJson(response: Response, context: string) {
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${context}: resposta inválida (${response.status})`);
  }
  if (!response.ok) {
    const description =
      payload.error_description ?? payload.message ?? payload.error ?? `HTTP ${response.status}`;
    throw new Error(`${context}: ${String(description)}`);
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Token: leitura + renovação centralizada (refresh token é ROTATIVO).
// Atualização otimista: só grava se o refresh_token no banco ainda for o que
// lemos; se outra execução rotacionou primeiro, relê e usa o novo.
// ---------------------------------------------------------------------------
async function getValidAccessToken(supabase: Supabase, sellerId: number): Promise<string> {
  const { data: row, error } = await supabase
    .from("mercadolivre_tokens")
    .select("access_token, refresh_token, expires_at")
    .eq("seller_id", sellerId)
    .single();
  if (error || !row) throw new Error(`Tokens não encontrados para o seller ${sellerId}`);

  const marginMs = 5 * 60 * 1000;
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (expiresAt - marginMs > Date.now()) return row.access_token as string;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.appId,
    client_secret: env.clientSecret,
    refresh_token: row.refresh_token as string
  });
  const response = await fetch(`${ML_API}/oauth/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const token = await parseJson(response, "Falha ao renovar token Mercado Livre");

  const accessToken = typeof token.access_token === "string" ? token.access_token : "";
  const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token : "";
  if (!accessToken || !refreshToken) throw new Error("Renovação não retornou tokens válidos.");
  const expiresIn = Number(token.expires_in ?? 0);
  const now = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("mercadolivre_tokens")
    .update({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: typeof token.token_type === "string" ? token.token_type : null,
      scope: typeof token.scope === "string" ? token.scope : null,
      expires_at: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
      raw_response: {
        token_type: token.token_type ?? null,
        expires_in: token.expires_in ?? null,
        scope: token.scope ?? null,
        user_id: token.user_id ?? null
      },
      updated_at: now
    })
    .eq("seller_id", sellerId)
    .eq("refresh_token", row.refresh_token) // otimista: não sobrescreve rotação concorrente
    .select("seller_id");
  if (updateError) throw updateError;

  if (!updated || updated.length === 0) {
    // Outra execução rotacionou primeiro; usa o token dela.
    const { data: fresh, error: freshError } = await supabase
      .from("mercadolivre_tokens")
      .select("access_token")
      .eq("seller_id", sellerId)
      .single();
    if (freshError || !fresh) throw new Error("Tokens indisponíveis após rotação concorrente.");
    return fresh.access_token as string;
  }
  return accessToken;
}

async function mlGet(accessToken: string, path: string) {
  const response = await fetch(`${ML_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  return parseJson(response, `GET ${path}`);
}

// ---------------------------------------------------------------------------
// Coleta
// ---------------------------------------------------------------------------
async function listItemIds(accessToken: string, sellerId: number): Promise<string[]> {
  const ids: string[] = [];
  let scrollId = "";
  for (let page = 0; page < 200; page++) {
    const qs = new URLSearchParams({ search_type: "scan", limit: "100" });
    if (scrollId) qs.set("scroll_id", scrollId);
    const data = await mlGet(accessToken, `/users/${sellerId}/items/search?${qs}`) as {
      results?: string[];
      scroll_id?: string;
    };
    if (!data.results?.length) break;
    ids.push(...data.results);
    scrollId = data.scroll_id ?? "";
    if (!scrollId) break;
  }
  return ids;
}

type MlVariation = {
  id: number | string;
  price?: number;
  available_quantity?: number;
  seller_custom_field?: string | null;
  inventory_id?: string | null;
  attribute_combinations?: Array<{ name?: string; value_name?: string }>;
};

type MlItem = {
  id: string;
  title?: string;
  price?: number;
  status?: string;
  sub_status?: string[];
  available_quantity?: number;
  permalink?: string;
  thumbnail?: string;
  seller_custom_field?: string | null;
  inventory_id?: string | null;
  shipping?: { logistic_type?: string };
  variations?: MlVariation[];
};

async function fetchItemDetails(accessToken: string, ids: string[], delayMs: number) {
  const attrs =
    "id,title,price,status,sub_status,available_quantity,permalink,thumbnail,seller_custom_field,inventory_id,shipping,variations";
  const items: MlItem[] = [];
  for (let index = 0; index < ids.length; index += 20) {
    const batch = ids.slice(index, index + 20);
    const data = await mlGet(accessToken, `/items?ids=${batch.join(",")}&attributes=${attrs}`) as
      Array<{ code: number; body: MlItem }>;
    for (const entry of data) {
      if (entry.code === 200 && entry.body?.id) items.push(entry.body);
    }
    if (delayMs > 0 && index + 20 < ids.length) await sleep(delayMs);
  }
  return items;
}

async function fetchFullStock(accessToken: string, inventoryId: string): Promise<number> {
  try {
    const data = await mlGet(accessToken, `/inventories/${inventoryId}/stock/fulfillment`) as {
      available_quantity?: number;
    };
    return Number(data.available_quantity ?? 0);
  } catch {
    return 0; // item sem estoque consultável não derruba o sync
  }
}

type MlOrder = {
  status?: string;
  date_created?: string;
  date_closed?: string;
  order_items?: Array<{
    item?: { id?: string; variation_id?: number | string | null };
    quantity?: number;
    unit_price?: number;
  }>;
};

async function fetchPaidOrders(
  accessToken: string,
  sellerId: number,
  lookbackDays: number,
  maxPages: number,
  toDaysAgo = 0
) {
  // Janela [agora - toDaysAgo - lookbackDays, agora - toDaysAgo] — o offset do
  // /orders/search satura em ~10k; períodos longos são buscados em fatias.
  const from = new Date(Date.now() - (toDaysAgo + lookbackDays) * 86_400_000).toISOString();
  const to = new Date(Date.now() - toDaysAgo * 86_400_000).toISOString();
  const orders: MlOrder[] = [];
  let offset = 0;
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({
      seller: String(sellerId),
      "order.date_created.from": from,
      "order.date_created.to": to,
      limit: "50",
      offset: String(offset),
      sort: "date_desc"
    });
    const data = await mlGet(accessToken, `/orders/search?${qs}`) as {
      results?: MlOrder[];
      paging?: { total?: number };
    };
    if (!data.results?.length) break;
    orders.push(...data.results.filter((order) => order.status === "paid"));
    offset += data.results.length;
    if (offset >= Number(data.paging?.total ?? 0)) break;
  }
  return orders;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  try {
    requireEnv("SUPABASE_URL", env.supabaseUrl);
    requireEnv("SUPABASE_SERVICE_ROLE_KEY", env.supabaseServiceRoleKey);
    requireEnv("MERCADOLIVRE_APP_ID", env.appId);
    requireEnv("MERCADOLIVRE_CLIENT_SECRET", env.clientSecret);
    requireEnv("MERCADOLIVRE_SYNC_JOB_SECRET", env.syncJobSecret);
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error) }, 500);
  }

  if (req.headers.get("x-sync-secret") !== env.syncJobSecret) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }
  const lookbackDays = Math.min(Number(payload.lookbackDays ?? 30) || 30, 120);
  const maxOrderPages = Math.min(Number(payload.maxOrderPages ?? 40) || 40, 200);
  const toDaysAgo = Math.min(Math.max(Number(payload.toDaysAgo ?? 0) || 0, 0), 120);
  const detailDelayMs = Number(payload.detailDelayMs ?? 150) || 0;

  let runId: string | null = null;
  try {
    // Conta ativa (payload.sellerId opcional para multi-conta futura)
    const accountQuery = supabase.from("mercadolivre_accounts").select("seller_id").eq("is_active", true);
    const { data: accounts, error: accountsError } = payload.sellerId
      ? await accountQuery.eq("seller_id", Number(payload.sellerId))
      : await accountQuery;
    if (accountsError) throw accountsError;
    if (!accounts?.length) return jsonResponse({ ok: false, error: "nenhuma conta ativa" }, 404);

    const results: Record<string, unknown>[] = [];
    for (const account of accounts) {
      const sellerId = Number(account.seller_id);
      const { data: run, error: runError } = await supabase
        .from("mercadolivre_sync_runs")
        .insert({ seller_id: sellerId, status: "running", meta: { lookbackDays, maxOrderPages } })
        .select("id")
        .single();
      if (runError) throw runError;
      runId = run.id as string;

      const accessToken = await getValidAccessToken(supabase, sellerId);

      // 1) Anúncios
      const ids = await listItemIds(accessToken, sellerId);
      const items = await fetchItemDetails(accessToken, ids, detailDelayMs);

      // 2) Estoque Full por inventory_id
      const fullStocks = new Map<string, number>();
      for (const item of items) {
        if (item.shipping?.logistic_type === "fulfillment" && item.inventory_id) {
          fullStocks.set(item.id, await fetchFullStock(accessToken, item.inventory_id));
        }
      }

      // 2b) Estoque Full por variação (anúncios fulfillment com variações)
      const variationFullStocks = new Map<string, number>(); // `${mlb}|${varId}` → qty
      for (const item of items) {
        if (item.shipping?.logistic_type !== "fulfillment" || !item.variations?.length) continue;
        for (const variation of item.variations) {
          if (!variation.inventory_id) continue;
          variationFullStocks.set(
            `${item.id}|${String(variation.id)}`,
            await fetchFullStock(accessToken, variation.inventory_id)
          );
        }
      }

      // 3) Pedidos pagos → agregação por anúncio/dia e por variação/dia
      // Os agregados 30d dos itens NÃO são calculados aqui: a janela do sync
      // pode ser curta (cron usa 2 dias). A fonte da verdade é a série
      // mercadolivre_sales_daily; o RPC ao final recalcula os 30 dias.
      const orders = await fetchPaidOrders(accessToken, sellerId, lookbackDays, maxOrderPages, toDaysAgo);
      const daily = new Map<string, { qty: number; revenue: number }>();
      const variationDaily = new Map<string, { qty: number; revenue: number }>();
      for (const order of orders) {
        const when = order.date_closed ?? order.date_created ?? "";
        const saleDate = when.slice(0, 10);
        if (!saleDate) continue;
        for (const line of order.order_items ?? []) {
          const mlbId = line.item?.id ?? "";
          const qty = Number(line.quantity ?? 0);
          const unit = Number(line.unit_price ?? 0);
          if (!mlbId || qty <= 0) continue;
          const dayKey = `${mlbId}|${saleDate}`;
          const day = daily.get(dayKey) ?? { qty: 0, revenue: 0 };
          day.qty += qty;
          day.revenue += qty * unit;
          daily.set(dayKey, day);

          const variationId = line.item?.variation_id;
          if (variationId != null && String(variationId) !== "") {
            const varKey = `${mlbId}|${String(variationId)}|${saleDate}`;
            const varDay = variationDaily.get(varKey) ?? { qty: 0, revenue: 0 };
            varDay.qty += qty;
            varDay.revenue += qty * unit;
            variationDaily.set(varKey, varDay);
          }
        }
      }

      // 4) Upsert de anúncios (sem tocar nos agregados 30d)
      const nowIso = new Date().toISOString();
      const itemRows = items.map((item) => ({
        seller_id: sellerId,
        mlb_id: item.id,
        title: item.title ?? null,
        sku: item.seller_custom_field ?? null,
        status: item.status ?? null,
        sub_status: item.sub_status?.join(",") || null,
        price: Number(item.price ?? 0),
        permalink: item.permalink ?? null,
        thumbnail: item.thumbnail ?? null,
        logistic_type: item.shipping?.logistic_type ?? null,
        inventory_id: item.inventory_id ?? null,
        available_qty: Number(item.available_quantity ?? 0),
        full_stock: fullStocks.get(item.id) ?? 0,
        raw_json: item,
        synced_at: nowIso
      }));
      for (let index = 0; index < itemRows.length; index += 200) {
        const { error: upsertError } = await supabase
          .from("mercadolivre_items")
          .upsert(itemRows.slice(index, index + 200), { onConflict: "seller_id,mlb_id" });
        if (upsertError) throw upsertError;
      }

      // 4b) Upsert de variações (SKU, atributos e estoque por variação)
      const variationRows = items.flatMap((item) =>
        (item.variations ?? []).map((variation) => ({
          seller_id: sellerId,
          mlb_id: item.id,
          variation_id: String(variation.id),
          sku: variation.seller_custom_field ?? null,
          attrs:
            variation.attribute_combinations
              ?.map((combo) => `${combo.name ?? ""}: ${combo.value_name ?? ""}`)
              .join(" · ") || null,
          price: Number(variation.price ?? item.price ?? 0),
          available_qty: Number(variation.available_quantity ?? 0),
          full_stock: variationFullStocks.get(`${item.id}|${String(variation.id)}`) ?? 0,
          inventory_id: variation.inventory_id ?? null,
          synced_at: nowIso
        }))
      );
      for (let index = 0; index < variationRows.length; index += 200) {
        const { error: variationError } = await supabase
          .from("mercadolivre_variations")
          .upsert(variationRows.slice(index, index + 200), {
            onConflict: "seller_id,mlb_id,variation_id"
          });
        if (variationError) throw variationError;
      }

      // 5) Série diária de vendas
      const knownIds = new Set(items.map((item) => item.id));
      const salesRows = [...daily.entries()].map(([key, value]) => {
        const [mlbId, saleDate] = key.split("|");
        return {
          seller_id: sellerId,
          mlb_id: mlbId,
          sale_date: saleDate,
          qty_sold: value.qty,
          revenue: value.revenue,
          updated_at: nowIso
        };
      }).filter((row) => knownIds.has(row.mlb_id)); // respeita a FK
      for (let index = 0; index < salesRows.length; index += 200) {
        const { error: salesError } = await supabase
          .from("mercadolivre_sales_daily")
          .upsert(salesRows.slice(index, index + 200), { onConflict: "seller_id,mlb_id,sale_date" });
        if (salesError) throw salesError;
      }

      // 5a) Série diária de vendas por variação
      const variationSalesRows = [...variationDaily.entries()].map(([key, value]) => {
        const [mlbId, variationId, saleDate] = key.split("|");
        return {
          seller_id: sellerId,
          mlb_id: mlbId,
          variation_id: variationId,
          sale_date: saleDate,
          qty_sold: value.qty,
          revenue: value.revenue,
          updated_at: nowIso
        };
      }).filter((row) => knownIds.has(row.mlb_id));
      for (let index = 0; index < variationSalesRows.length; index += 200) {
        const { error: variationSalesError } = await supabase
          .from("mercadolivre_variation_sales_daily")
          .upsert(variationSalesRows.slice(index, index + 200), {
            onConflict: "seller_id,mlb_id,variation_id,sale_date"
          });
        if (variationSalesError) throw variationSalesError;
      }

      // 5b) Recalcula agregados 30d a partir da série acumulada (fonte da verdade)
      const { error: aggregateError } = await supabase.rpc(
        "mercadolivre_refresh_item_aggregates",
        { p_seller_id: sellerId }
      );
      if (aggregateError) throw aggregateError;

      // 6) Snapshot diário de estoque (idempotente por dia)
      const snapshotDate = nowIso.slice(0, 10);
      const snapshotRows = itemRows.map((row) => ({
        seller_id: sellerId,
        mlb_id: row.mlb_id,
        snapshot_date: snapshotDate,
        full_stock: row.full_stock,
        available_qty: row.available_qty
      }));
      for (let index = 0; index < snapshotRows.length; index += 200) {
        const { error: snapshotError } = await supabase
          .from("mercadolivre_inventory_snapshots")
          .upsert(snapshotRows.slice(index, index + 200), {
            onConflict: "seller_id,mlb_id,snapshot_date"
          });
        if (snapshotError) throw snapshotError;
      }

      await supabase.from("mercadolivre_sync_runs").update({
        finished_at: new Date().toISOString(),
        status: "success",
        items_count: items.length,
        orders_count: orders.length
      }).eq("id", runId);
      runId = null;

      results.push({ sellerId, items: items.length, orders: orders.length });
    }

    return jsonResponse({ ok: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("mercadolivre-sync", message);
    if (runId) {
      await supabase.from("mercadolivre_sync_runs").update({
        finished_at: new Date().toISOString(),
        status: "failed",
        error_message: message
      }).eq("id", runId);
    }
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
