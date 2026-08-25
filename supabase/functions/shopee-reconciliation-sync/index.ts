// Reconciliação financeira Shopee — pedido, NF, escrow e carteira.
//
// ⚠️ Esta função NUNCA renova token. O shopee-sync é o único dono da renovação.
// O cron chama uma loja por invocação porque quatro lojas juntas podem estourar
// o tempo da Edge Function.
//
// Fontes e significados:
//   * shopee_orders: data/status/valor bruto do pedido;
//   * oraculo_fiscal_invoices_valid: total da NF de venda (olist_invoices.total_amount);
//   * shopee_order_escrow: líquido que a Shopee informou como a receber;
//   * payment.get_wallet_transaction_list: crédito realmente lançado na carteira;
//   * payment.get_income_detail status=2: rendas ainda pendentes e previsão.
//
// A carteira limita cada janela de create_time a 15 dias; usamos blocos de 14.
// get_income_detail ignora as datas para pendências, então ele é sempre varrido
// por cursor e as datas da tela vêm de shopee_orders.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SHOPEE_HOST = "https://partner.shopeemobile.com";
const TOKEN_MIN_TTL_MS = 5 * 60 * 1000;
const CHUNK_SECONDS = 14 * 24 * 60 * 60;
const WALLET_PAGE_SIZE = 100;
const INCOME_PAGE_SIZE = 100;
const MAX_PAGES = 200;
const PENDING_PAGES_PER_RUN = 4;
const WALLET_PAGES_PER_RUN = 4;
const DEFAULT_DAYS = 45;
const DB_BATCH_SIZE = 150;

type Shop = { shop_id: number; partner_id: number; shop_name: string | null };
type WalletTransaction = {
  transaction_id?: string | number;
  order_sn?: string;
  amount?: number | string;
  current_balance?: number | string;
  create_time?: number | string;
  status?: string;
  transaction_type?: string;
  money_flow?: string;
};
type PendingIncome = {
  order_sn?: string;
  status?: string;
  estimated_escrow_amount?: number | string;
  estimated_payout_time?: number | string;
  payment_method?: string;
  currency?: string;
};

const encoder = new TextEncoder();

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

// Permite backfill manual com uma service-role válida mesmo quando o projeto já
// rotacionou a chave injetada na Edge Function. A validação acontece no próprio
// PostgREST contra esta tabela service_role-only; JWT forjado ou usuário comum
// recebe 401/403 e não passa.
async function validatesServiceRoleToken(supabaseUrl: string, token: string) {
  if (!supabaseUrl || !token) return false;
  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/shopee_order_reconciliation?select=id&limit=0`,
      { headers: { apikey: token, authorization: `Bearer ${token}` } }
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function shopPost(
  path: string,
  shop: Shop,
  partnerKey: string,
  accessToken: string,
  body: Record<string, unknown>
) {
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
    sign
  });
  const response = await fetch(`${SHOPEE_HOST}${path}?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  const apiError = json?.error;
  if (!response.ok || (apiError && apiError !== "-")) {
    throw new Error(`${path} ${shop.shop_id}: HTTP ${response.status} ${apiError ?? ""} ${json?.message ?? ""}`.trim());
  }
  return json;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function epochIso(value: unknown): string | null {
  const parsed = num(value);
  if (parsed == null || parsed <= 0) return null;
  return new Date(parsed * 1000).toISOString();
}

function dateOnly(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function chunks<T>(values: T[], size = DB_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

// deno-lint-ignore no-explicit-any
async function fetchByOrderSn(
  supabase: any,
  table: string,
  select: string,
  orderSns: string[],
  shopId?: number,
  orderColumn = "order_sn"
) {
  const rows: Record<string, unknown>[] = [];
  for (const batch of chunks(orderSns)) {
    let query = supabase.from(table).select(select).in(orderColumn, batch);
    if (shopId != null) query = query.eq("shop_id", shopId);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

async function fetchWalletBatch(
  shop: Shop,
  partnerKey: string,
  accessToken: string,
  initialFromSec: number,
  toSec: number,
  initialPage: number
) {
  const byTransaction = new Map<string, WalletTransaction>();
  let nextFromSec = initialFromSec;
  let nextPage = Math.max(initialPage, 1);
  let pages = 0;
  let complete = nextFromSec > toSec;
  while (!complete && pages < WALLET_PAGES_PER_RUN) {
    const end = Math.min(nextFromSec + CHUNK_SECONDS - 1, toSec);
    const json = await shopPost(
      "/api/v2/payment/get_wallet_transaction_list",
      shop,
      partnerKey,
      accessToken,
      {
        create_time_from: nextFromSec,
        create_time_to: end,
        money_flow: "MONEY_IN",
        page_no: nextPage,
        page_size: WALLET_PAGE_SIZE,
        transaction_tab_type: "wallet_order_income",
        transaction_type: "101"
      }
    );
    const list = (json?.response?.transaction_list ?? []) as WalletTransaction[];
    for (const transaction of list) {
      if (
        transaction.order_sn &&
        transaction.status === "COMPLETED" &&
        transaction.transaction_type === "ESCROW_VERIFIED_ADD" &&
        transaction.money_flow === "MONEY_IN"
      ) {
        const key = String(transaction.transaction_id ?? `${transaction.order_sn}-${transaction.create_time}`);
        byTransaction.set(key, transaction);
      }
    }
    pages += 1;
    if (json?.response?.more) {
      nextPage += 1;
      if (nextPage > MAX_PAGES) throw new Error(`carteira ${shop.shop_id}: paginação excedeu ${MAX_PAGES} páginas`);
    } else {
      nextFromSec = end + 1;
      nextPage = 1;
      complete = nextFromSec > toSec;
    }
  }
  return { transactions: [...byTransaction.values()], nextFromSec, nextPage, complete, pages };
}

async function fetchPending(
  shop: Shop,
  partnerKey: string,
  accessToken: string,
  fromSec: number,
  toSec: number,
  initialCursor: string
) {
  const byOrder = new Map<string, PendingIncome>();
  let cursor = initialCursor;
  let pages = 0;
  let complete = false;
  for (let page = 1; page <= PENDING_PAGES_PER_RUN; page += 1) {
    const json = await shopPost(
      "/api/v2/payment/get_income_detail",
      shop,
      partnerKey,
      accessToken,
      {
        cursor,
        date_from: dateOnly(fromSec),
        date_to: dateOnly(toSec),
        income_status: 2,
        page_size: INCOME_PAGE_SIZE
      }
    );
    const list = (json?.response?.list ?? []) as PendingIncome[];
    for (const income of list) if (income.order_sn) byOrder.set(String(income.order_sn), income);
    const nextCursor = String(json?.response?.next_page?.cursor ?? "");
    pages += 1;
    if (!nextCursor || nextCursor === cursor || list.length === 0) {
      cursor = "";
      complete = true;
      break;
    }
    cursor = nextCursor;
  }
  return { incomes: [...byOrder.values()], nextCursor: cursor, complete, pages };
}

// deno-lint-ignore no-explicit-any
async function syncShop(
  supabase: any,
  shop: Shop,
  partnerKey: string,
  fromSec: number,
  toSec: number,
  forceCycle: boolean
) {
  const [{ data: tokenRow, error: tokenError }, { data: state, error: stateError }] = await Promise.all([
    supabase
      .from("shopee_tokens")
      .select("access_token, access_token_expires_at")
      .eq("shop_id", shop.shop_id)
      .maybeSingle(),
    supabase
      .from("shopee_reconciliation_sync_state")
      .select("pending_cursor,cycle_started_at,cycle_window_from,cycle_window_to,pages_processed,records_processed,last_completed_at,cycle_active,pending_complete,wallet_next_from,wallet_next_page,wallet_complete,wallet_pages_processed,wallet_records_processed")
      .eq("shop_id", shop.shop_id)
      .maybeSingle()
  ]);
  if (tokenError) throw new Error(`token ${shop.shop_id}: ${tokenError.message}`);
  if (stateError) throw new Error(`estado ${shop.shop_id}: ${stateError.message}`);
  const accessToken = String(tokenRow?.access_token ?? "");
  const expiresAt = tokenRow?.access_token_expires_at ? Date.parse(tokenRow.access_token_expires_at) : 0;
  if (!accessToken || expiresAt - Date.now() < TOKEN_MIN_TTL_MS) {
    throw new Error("token ausente ou perto de expirar; o shopee-sync fará a renovação");
  }

  const cycleActive = Boolean(state?.cycle_active);
  const lastCompletedAt = state?.last_completed_at ? Date.parse(state.last_completed_at) : 0;
  if (!cycleActive && !forceCycle && lastCompletedAt > Date.now() - 20 * 60 * 60 * 1000) {
    return {
      skipped: "ciclo semanal já concluído",
      walletFetched: 0,
      pendingFetched: 0,
      upserted: 0,
      cycleComplete: true,
      duplicateWalletOrders: 0
    };
  }

  const newCycle = !cycleActive;
  const pendingCursor = newCycle ? "" : String(state?.pending_cursor ?? "");
  const pendingAlreadyComplete = !newCycle && Boolean(state?.pending_complete);
  const walletAlreadyComplete = !newCycle && Boolean(state?.wallet_complete);
  const cycleStartedAt = newCycle ? new Date().toISOString() : String(state?.cycle_started_at ?? new Date().toISOString());
  const cycleFromSec = !newCycle && state?.cycle_window_from
    ? Math.floor(Date.parse(state.cycle_window_from) / 1000)
    : fromSec;
  const cycleToSec = !newCycle && state?.cycle_window_to
    ? Math.floor(Date.parse(state.cycle_window_to) / 1000)
    : toSec;

  const walletStartSec = newCycle ? cycleFromSec : Number(state?.wallet_next_from ?? cycleFromSec);
  const walletPage = newCycle ? 1 : Number(state?.wallet_next_page ?? 1);
  // As duas paginações avançam juntas em lotes pequenos. Quando uma termina,
  // os lotes restantes continuam somente a outra.
  const [walletBatch, pendingBatch] = await Promise.all([
    walletAlreadyComplete
      ? Promise.resolve({ transactions: [] as WalletTransaction[], nextFromSec: walletStartSec, nextPage: walletPage, complete: true, pages: 0 })
      : fetchWalletBatch(shop, partnerKey, accessToken, walletStartSec, cycleToSec, walletPage),
    pendingAlreadyComplete
      ? Promise.resolve({ incomes: [] as PendingIncome[], nextCursor: "", complete: true, pages: 0 })
      : fetchPending(shop, partnerKey, accessToken, cycleFromSec, cycleToSec, pendingCursor)
  ]);
  const walletTransactions = walletBatch.transactions;
  const pendingIncomes = pendingBatch.incomes;

  // Uma transação ESCROW_VERIFIED_ADD representa um crédito de pedido. Se a
  // API devolver mais de uma, preservamos a mais recente e registramos a
  // ocorrência no meta do run para investigação.
  const walletByOrder = new Map<string, WalletTransaction>();
  let duplicateWalletOrders = 0;
  for (const transaction of walletTransactions) {
    const orderSn = String(transaction.order_sn);
    const previous = walletByOrder.get(orderSn);
    if (previous) duplicateWalletOrders += 1;
    if (!previous || (num(transaction.create_time) ?? 0) > (num(previous.create_time) ?? 0)) {
      walletByOrder.set(orderSn, transaction);
    }
  }
  const pendingByOrder = new Map(
    pendingIncomes.filter((income) => income.order_sn).map((income) => [String(income.order_sn), income])
  );
  // Crédito efetivo prevalece sobre uma pendência eventualmente defasada na API.
  for (const orderSn of walletByOrder.keys()) pendingByOrder.delete(orderSn);

  const orderSns = [...new Set([...walletByOrder.keys(), ...pendingByOrder.keys()])];
  const [orders, escrows, invoices] = orderSns.length > 0 ? await Promise.all([
    fetchByOrderSn(
      supabase,
      "shopee_orders",
      "order_sn,create_time,order_status,total_amount,currency",
      orderSns,
      shop.shop_id
    ),
    fetchByOrderSn(
      supabase,
      "shopee_order_escrow",
      "order_sn,escrow_amount,buyer_total_amount",
      [...walletByOrder.keys()],
      shop.shop_id
    ),
    fetchByOrderSn(
      supabase,
      "oraculo_fiscal_invoices_valid",
      "order_number,invoice_number,total_amount,issued_at",
      orderSns,
      undefined,
      "order_number"
    )
  ]) : [[], [], []];

  const orderBySn = new Map(orders.map((row) => [String(row.order_sn), row]));
  const escrowBySn = new Map(escrows.map((row) => [String(row.order_sn), row]));
  const invoicesBySn = new Map<string, Record<string, unknown>[]>();
  for (const invoice of invoices) {
    const orderSn = String(invoice.order_number ?? "");
    const group = invoicesBySn.get(orderSn) ?? [];
    group.push(invoice);
    invoicesBySn.set(orderSn, group);
  }

  const syncedAt = new Date().toISOString();
  const rows = orderSns.map((orderSn) => {
    const order = orderBySn.get(orderSn) ?? {};
    const escrow = escrowBySn.get(orderSn) ?? {};
    const wallet = walletByOrder.get(orderSn);
    const pending = pendingByOrder.get(orderSn);
    const matchedInvoices = invoicesBySn.get(orderSn) ?? [];
    const invoiceAmounts = matchedInvoices.map((invoice) => num(invoice.total_amount)).filter((value): value is number => value != null);
    const invoiceTotal = invoiceAmounts.length > 0
      ? Math.round(invoiceAmounts.reduce((sum, value) => sum + value, 0) * 100) / 100
      : null;
    const invoiceDates = matchedInvoices
      .map((invoice) => String(invoice.issued_at ?? ""))
      .filter(Boolean)
      .sort();
    const released = wallet != null;
    return {
      id: `${shop.shop_id}-${orderSn}`,
      shop_id: shop.shop_id,
      shop_name: shop.shop_name,
      order_sn: orderSn,
      order_created_at: order.create_time ?? null,
      order_status: order.order_status ?? null,
      gross_order_amount: released
        ? (num(escrow.buyer_total_amount) ?? num(order.total_amount))
        : num(order.total_amount),
      invoice_total_amount: invoiceTotal,
      invoice_numbers: matchedInvoices.map((invoice) => String(invoice.invoice_number ?? "")).filter(Boolean),
      invoice_count: matchedInvoices.length,
      invoice_issued_at: invoiceDates[0] ?? null,
      amount_to_receive: released ? num(escrow.escrow_amount) : num(pending?.estimated_escrow_amount),
      wallet_paid_amount: released ? num(wallet.amount) : null,
      wallet_balance_after: released ? num(wallet.current_balance) : null,
      wallet_credit_at: released ? epochIso(wallet.create_time) : null,
      wallet_transaction_id: released ? String(wallet.transaction_id ?? "") || null : null,
      income_status: released ? "released" : "pending",
      income_status_label: released ? "Liberado na carteira" : String(pending?.status ?? "Pendente"),
      estimated_release_at: released ? null : epochIso(pending?.estimated_payout_time),
      payment_method: released ? null : (pending?.payment_method ?? null),
      currency: String(pending?.currency ?? order.currency ?? "BRL"),
      source_synced_at: syncedAt,
      updated_at: syncedAt
    };
  });

  for (const batch of chunks(rows, 500)) {
    const { error } = await supabase
      .from("shopee_order_reconciliation")
      .upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`upsert reconciliação ${shop.shop_id}: ${error.message}`);
  }

  let closed = 0;
  const cycleComplete = pendingBatch.complete && walletBatch.complete;
  // Somente o fim do ciclo conhece todas as páginas. Linhas pendentes que não
  // foram tocadas no ciclo e cujo pedido está cancelado podem ser encerradas.
  if (cycleComplete) {
    const { data: stalePending, error: staleError } = await supabase
      .from("shopee_order_reconciliation")
      .select("id,order_sn,source_synced_at")
      .eq("shop_id", shop.shop_id)
      .eq("income_status", "pending")
      .lt("source_synced_at", cycleStartedAt);
    if (staleError) throw new Error(`pendências anteriores ${shop.shop_id}: ${staleError.message}`);
    const absentPending = stalePending ?? [];
    const absentSns = absentPending.map((row: { order_sn: string }) => String(row.order_sn));
    const absentOrders = absentSns.length > 0 ? await fetchByOrderSn(
      supabase,
      "shopee_orders",
      "order_sn,order_status",
      absentSns,
      shop.shop_id
    ) : [];
    const cancelled = new Set(
      absentOrders
        .filter((row) => String(row.order_status ?? "").toUpperCase() === "CANCELLED")
        .map((row) => String(row.order_sn))
    );
    const idsToClose = absentPending
      .filter((row: { order_sn: string }) => cancelled.has(String(row.order_sn)))
      .map((row: { id: string }) => row.id);
    for (const batch of chunks(idsToClose)) {
      const { error } = await supabase
        .from("shopee_order_reconciliation")
        .update({ income_status: "closed", income_status_label: "Pedido cancelado", updated_at: syncedAt })
        .in("id", batch);
      if (error) throw new Error(`encerrar cancelados ${shop.shop_id}: ${error.message}`);
      closed += batch.length;
    }
  }

  const pagesProcessed = (newCycle ? 0 : Number(state?.pages_processed ?? 0)) + pendingBatch.pages;
  const recordsProcessed = (newCycle ? 0 : Number(state?.records_processed ?? 0)) + pendingIncomes.length;
  const walletPagesProcessed = (newCycle ? 0 : Number(state?.wallet_pages_processed ?? 0)) + walletBatch.pages;
  const walletRecordsProcessed = (newCycle ? 0 : Number(state?.wallet_records_processed ?? 0)) + walletTransactions.length;
  const { error: stateUpsertError } = await supabase
    .from("shopee_reconciliation_sync_state")
    .upsert({
      shop_id: shop.shop_id,
      cycle_active: !cycleComplete,
      pending_cursor: pendingBatch.complete ? null : pendingBatch.nextCursor,
      pending_complete: pendingBatch.complete,
      wallet_next_from: walletBatch.nextFromSec,
      wallet_next_page: walletBatch.nextPage,
      wallet_complete: walletBatch.complete,
      cycle_started_at: cycleStartedAt,
      cycle_window_from: new Date(cycleFromSec * 1000).toISOString(),
      cycle_window_to: new Date(cycleToSec * 1000).toISOString(),
      pages_processed: pagesProcessed,
      records_processed: recordsProcessed,
      wallet_pages_processed: walletPagesProcessed,
      wallet_records_processed: walletRecordsProcessed,
      last_completed_at: cycleComplete ? syncedAt : (state?.last_completed_at ?? null),
      updated_at: syncedAt
    }, { onConflict: "shop_id" });
  if (stateUpsertError) throw new Error(`salvar cursor ${shop.shop_id}: ${stateUpsertError.message}`);

  return {
    walletFetched: walletTransactions.length,
    pendingFetched: pendingIncomes.length,
    upserted: rows.length,
    closed,
    pendingPages: pendingBatch.pages,
    pendingPagesCycle: pagesProcessed,
    pendingRecordsCycle: recordsProcessed,
    pendingApiComplete: pendingBatch.complete,
    walletPages: walletBatch.pages,
    walletPagesCycle: walletPagesProcessed,
    walletRecordsCycle: walletRecordsProcessed,
    walletComplete: walletBatch.complete,
    cycleComplete,
    duplicateWalletOrders,
    missingOrder: rows.filter((row) => row.order_created_at == null).length,
    missingEscrow: rows.filter((row) => row.income_status === "released" && row.amount_to_receive == null).length,
    missingInvoice: rows.filter((row) => row.invoice_count === 0).length
  };
}

Deno.serve(async (request) => {
  const expectedSecret = Deno.env.get("SHOPEE_SYNC_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const hasSyncSecret = Boolean(expectedSecret) && request.headers.get("x-sync-secret") === expectedSecret;
  const hasServiceRole = (Boolean(serviceRoleKey) && bearer === serviceRoleKey)
    || await validatesServiceRoleToken(supabaseUrl, bearer);
  if (!hasSyncSecret && !hasServiceRole) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(
    supabaseUrl,
    serviceRoleKey
  );
  const url = new URL(request.url);
  const shopId = Number(url.searchParams.get("shop_id"));
  if (!Number.isFinite(shopId) || shopId <= 0) {
    return new Response(JSON.stringify({ error: "shop_id é obrigatório; execute uma loja por invocação" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const days = Math.max(Number(url.searchParams.get("days") ?? DEFAULT_DAYS), 1);
  const toParam = url.searchParams.get("to");
  const fromParam = url.searchParams.get("from");
  const forceCycle = Boolean(fromParam) || url.searchParams.get("force") === "1";
  const toSec = toParam ? Math.floor(Date.parse(toParam) / 1000) : Math.floor(Date.now() / 1000);
  const fromSec = fromParam ? Math.floor(Date.parse(fromParam) / 1000) : toSec - days * 24 * 60 * 60;
  if (!Number.isFinite(fromSec) || !Number.isFinite(toSec) || fromSec >= toSec) {
    return new Response(JSON.stringify({ error: "janela de datas inválida" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  const startedAt = new Date().toISOString();
  const source = `shopee-reconciliation-sync:${shopId}`;
  try {
    const [{ data: shop, error: shopError }, { data: config, error: configError }] = await Promise.all([
      supabase
        .from("shopee_shops")
        .select("shop_id,partner_id,shop_name")
        .eq("shop_id", shopId)
        .eq("is_active", true)
        .maybeSingle(),
      supabase
        .from("shopee_app_config")
        .select("partner_id,partner_key")
        .eq("is_active", true)
    ]);
    if (shopError || !shop) throw new Error(`loja ${shopId} não encontrada ou inativa: ${shopError?.message ?? ""}`);
    if (configError) throw new Error(`configuração de apps: ${configError.message}`);
    const partnerConfig = (config ?? []).find(
      (row: { partner_id: number }) => Number(row.partner_id) === Number(shop.partner_id)
    );
    if (!partnerConfig?.partner_key) throw new Error(`partner_key ausente para partner_id ${shop.partner_id}`);

    const result = await syncShop(
      supabase,
      shop as Shop,
      String(partnerConfig.partner_key),
      fromSec,
      toSec,
      forceCycle
    );
    if (result.skipped) {
      return new Response(
        JSON.stringify({ shop_id: shopId, shop_name: shop.shop_name, ...result }, null, 2),
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }
    const runSource = result.cycleComplete
      ? source
      : `shopee-reconciliation-batch:${shopId}`;
    await supabase.from("shopee_sync_runs").insert({
      source: runSource,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "success",
      records_fetched: result.walletFetched + result.pendingFetched,
      records_upserted: result.upserted,
      meta: {
        shop_id: shopId,
        shop_name: shop.shop_name,
        from: new Date(fromSec * 1000).toISOString(),
        to: new Date(toSec * 1000).toISOString(),
        ...result
      }
    });

    return new Response(
      JSON.stringify({
        shop_id: shopId,
        shop_name: shop.shop_name,
        window: { from: new Date(fromSec * 1000).toISOString(), to: new Date(toSec * 1000).toISOString() },
        ...result
      }, null, 2),
      { headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("shopee_sync_runs").insert({
      source,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "failed",
      error_message: message,
      meta: {
        shop_id: shopId,
        from: new Date(fromSec * 1000).toISOString(),
        to: new Date(toSec * 1000).toISOString()
      }
    });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
});
