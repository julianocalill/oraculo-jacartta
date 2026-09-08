import { createClient } from 'npm:@supabase/supabase-js@2';

type JsonObject = Record<string, unknown>;

type Candidate = {
  queue_id: number;
  order_id: string;
  numero_pedido: string | null;
  order_data_criacao: string | null;
  order_payload: JsonObject | null;
  invoice_id: string | null;
  invoice_number: string | null;
  issued_at: string | null;
  billed_revenue: number | string | null;
  marketplace_order_number: string | null;
  attempts: number;
};

const env = {
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  supabaseServiceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  olistApiBaseUrl: Deno.env.get('OLIST_API_BASE_URL') ?? '',
  olistApiTokenUrl: Deno.env.get('OLIST_API_TOKEN_URL') ?? '',
  olistApiClientId: Deno.env.get('OLIST_API_CLIENT_ID') ?? '',
  olistApiClientSecret: Deno.env.get('OLIST_API_CLIENT_SECRET') ?? '',
  olistApiRefreshToken: Deno.env.get('OLIST_API_REFRESH_TOKEN') ?? '',
  olistApiBearerToken: Deno.env.get('OLIST_API_BEARER_TOKEN') ?? '',
  olistApiAuthHeader: Deno.env.get('OLIST_API_AUTH_HEADER') ?? 'Authorization',
  olistApiAuthPrefix: Deno.env.get('OLIST_API_AUTH_PREFIX') ?? 'Bearer',
  olistSyncJobSecret: Deno.env.get('OLIST_SYNC_JOB_SECRET') ?? ''
};

function requireValue(name: string, value: string) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithTimeout(url: string | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error(`HTTP timeout após ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      timeout
    ]);
    const text = await Promise.race([response.text(), timeout]);
    return { response, text };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function clampPositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function unwrapOrder(payload: unknown): JsonObject {
  if (!payload || typeof payload !== 'object') return {};
  const row = payload as JsonObject;
  if (row.pedido && typeof row.pedido === 'object') return row.pedido as JsonObject;
  if (row.data && !Array.isArray(row.data) && typeof row.data === 'object') return row.data as JsonObject;
  return row;
}

function orderItems(order: JsonObject | null | undefined): JsonObject[] {
  if (!order) return [];
  if (Array.isArray(order.itens)) return order.itens.filter((item): item is JsonObject => Boolean(item) && typeof item === 'object');
  if (Array.isArray(order.items)) return order.items.filter((item): item is JsonObject => Boolean(item) && typeof item === 'object');
  if (Array.isArray(order.produtos)) return order.produtos.filter((item): item is JsonObject => Boolean(item) && typeof item === 'object');
  return [];
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOrder(candidate: Candidate, rawOrder: unknown) {
  const order = unwrapOrder(rawOrder);
  return {
    id: String(order.id ?? candidate.order_id),
    data_criacao: order.data ?? order.dataCriacao ?? order.data_criacao ?? candidate.order_data_criacao ?? null,
    payload: order
  };
}

function normalizeItemRow(order: ReturnType<typeof normalizeOrder>, item: JsonObject, index: number) {
  const product = item.produto && typeof item.produto === 'object'
    ? item.produto as JsonObject
    : item.product && typeof item.product === 'object'
      ? item.product as JsonObject
      : {};
  const productId = product.id ?? item.idProduto ?? item.produtoId ?? null;
  const sku = product.sku ?? product.codigo ?? item.sku ?? item.codigo ?? null;
  const quantity = numberValue(item.quantidade ?? item.qtde ?? item.qtd) ?? 0;
  const unitValue = numberValue(item.valorUnitario ?? item.valor_unitario ?? item.preco ?? item.valor);
  const explicitTotal = numberValue(item.valorTotal ?? item.valor_total ?? item.total);
  const totalValue = explicitTotal ?? (unitValue == null ? null : quantity * unitValue);
  const lineNumber = index + 1;

  return {
    id: `${order.id}:${lineNumber}:${productId ?? sku ?? 'item'}`,
    order_id: String(order.id),
    line_number: lineNumber,
    produto_id: productId == null ? null : String(productId),
    sku: sku == null ? null : String(sku),
    tipo: product.tipo == null ? null : String(product.tipo),
    descricao: product.descricao ?? product.nome ?? item.descricao ?? item.nome ?? null,
    quantidade: quantity,
    valor_unitario: unitValue,
    valor_total: totalValue,
    info_adicional: item.infoAdicional ?? item.info_adicional ?? null,
    order_data_criacao: order.data_criacao,
    payload: item,
    synced_at: new Date().toISOString()
  };
}

function olistHeaders(accessToken: string) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  headers[env.olistApiAuthHeader] = env.olistApiAuthPrefix
    ? `${env.olistApiAuthPrefix} ${accessToken}`
    : accessToken;
  return headers;
}

async function getStoredToken(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from('olist_oauth_tokens')
    .select('access_token,refresh_token,expires_at')
    .eq('provider', 'olist')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getAccessToken(supabase: ReturnType<typeof createClient>) {
  if (env.olistApiBearerToken) return env.olistApiBearerToken;

  const stored = await getStoredToken(supabase);
  const expiresAt = stored?.expires_at ? Date.parse(String(stored.expires_at)) : 0;
  if (stored?.access_token && Number.isFinite(expiresAt) && expiresAt > Date.now() + 2 * 60 * 1000) {
    return String(stored.access_token);
  }

  const refreshToken = env.olistApiRefreshToken || stored?.refresh_token || '';
  requireValue('OLIST_API_REFRESH_TOKEN or stored token', refreshToken);

  const { response, text } = await fetchTextWithTimeout(env.olistApiTokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: env.olistApiClientId,
      client_secret: env.olistApiClientSecret
    })
  }, 15_000);
  const payload = JSON.parse(text) as JsonObject;
  if (!response.ok || typeof payload.access_token !== 'string') {
    throw new Error(`Falha ao renovar token da Olist (${response.status}): ${text.slice(0, 300)}`);
  }

  await supabase.from('olist_oauth_tokens').upsert({
    provider: 'olist',
    access_token: payload.access_token,
    refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : refreshToken,
    expires_at: payload.expires_in
      ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
      : null,
    scope: payload.scope ?? null,
    token_type: payload.token_type ?? null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'provider' });

  return payload.access_token;
}

async function fetchOrderDetail(accessToken: string, orderId: string) {
  const baseUrl = env.olistApiBaseUrl.replace(/\/?$/, '/');
  const url = new URL(`pedidos/${encodeURIComponent(orderId)}`, baseUrl);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response;
    let text: string;
    try {
      ({ response, text } = await fetchTextWithTimeout(url, {
        headers: olistHeaders(accessToken)
      }, 15_000));
    } catch (error) {
      if (attempt < 3) continue;
      throw new Error(
        `Olist pedidos/${orderId} não respondeu em 15s após ${attempt} tentativas: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (response.ok) return JSON.parse(text) as JsonObject;
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfter = Number(response.headers.get('retry-after') || '0');
      await sleep(retryAfter > 0 ? retryAfter * 1000 : Math.min(15000, 1500 * 2 ** (attempt - 1)));
      continue;
    }
    const error = new Error(`Olist pedidos/${orderId} falhou (${response.status}): ${text.slice(0, 300)}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
}

Deno.serve(async (req) => {
  let supabase: ReturnType<typeof createClient> | null = null;
  let runId: string | null = null;
  let runMetadata: JsonObject = {};

  try {
    requireValue('SUPABASE_URL', env.supabaseUrl);
    requireValue('SUPABASE_SERVICE_ROLE_KEY', env.supabaseServiceRoleKey);
    requireValue('OLIST_API_BASE_URL', env.olistApiBaseUrl);
    requireValue('OLIST_API_TOKEN_URL', env.olistApiTokenUrl);
    requireValue('OLIST_API_CLIENT_ID', env.olistApiClientId);
    requireValue('OLIST_API_CLIENT_SECRET', env.olistApiClientSecret);
    requireValue('OLIST_SYNC_JOB_SECRET', env.olistSyncJobSecret);

    if (req.headers.get('x-sync-secret') !== env.olistSyncJobSecret) {
      return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
    }

    const body = await req.json().catch(() => ({})) as JsonObject;
    const startDate = String(body.startDate ?? '2026-06-01');
    const endDate = String(body.endDate ?? '2026-06-19');
    const limit = clampPositiveInt(body.limit, 50, 100);
    const delayMs = clampPositiveInt(body.delayMs, 1500, 10000);
    const maxRuntimeMs = clampPositiveInt(body.maxRuntimeMs, 180000, 240000);
    const startedAt = Date.now();

    supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false }
    });

    // Uma Edge Function pode morrer no gateway/runtime sem executar o catch.
    // Fechamos runs antigos antes de começar e recusamos sobreposição fresca.
    const staleCutoff = new Date(Date.now() - (maxRuntimeMs + 15_000)).toISOString();
    const interruptedAt = new Date().toISOString();
    const { error: staleCleanupError } = await supabase
      .from('olist_order_items_backfill_runs')
      .update({
        status: 'failed',
        finished_at: interruptedAt,
        error_message: 'Execução interrompida sem fechamento; retomada automática no próximo ciclo.'
      })
      .eq('window_start', startDate)
      .eq('window_end', endDate)
      .eq('status', 'running')
      .lt('started_at', staleCutoff);
    if (staleCleanupError) throw staleCleanupError;

    const { data: activeRun, error: activeRunError } = await supabase
      .from('olist_order_items_backfill_runs')
      .select('id,started_at')
      .eq('window_start', startDate)
      .eq('window_end', endDate)
      .eq('status', 'running')
      .gte('started_at', staleCutoff)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (activeRunError) throw activeRunError;
    if (activeRun) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: 'run_already_active',
        active_run_id: activeRun.id,
        active_since: activeRun.started_at
      }, 202);
    }

    const { data: countData, error: countError } = await supabase.rpc(
      'oraculo_fiscal_order_item_backfill_candidate_count',
      { p_start_date: startDate, p_end_date: endDate }
    );
    if (countError) throw countError;

    runMetadata = {
      source: 'supabase/functions/olist-backfill-order-items',
      options: { startDate, endDate, limit, delayMs, maxRuntimeMs },
      stale_after_ms: maxRuntimeMs + 15_000,
      phase: 'run_created',
      updated_at: new Date().toISOString()
    };

    const { data: runRows, error: runError } = await supabase
      .from('olist_order_items_backfill_runs')
      .insert({
        window_start: startDate,
        window_end: endDate,
        candidates_total: Number(countData ?? 0),
        metadata: runMetadata
      })
      .select()
      .single();
    if (runError) throw runError;
    runId = runRows.id;

    const { data: candidates, error: candidatesError } = await supabase.rpc(
      'oraculo_fiscal_order_item_backfill_queue_candidates',
      { p_start_date: startDate, p_end_date: endDate, p_limit: limit }
    );
    if (candidatesError) throw candidatesError;

    runMetadata = { ...runMetadata, phase: 'candidates_loaded', updated_at: new Date().toISOString() };
    const { error: candidatesPhaseError } = await supabase
      .from('olist_order_items_backfill_runs')
      .update({ metadata: runMetadata })
      .eq('id', runRows.id);
    if (candidatesPhaseError) throw candidatesPhaseError;

    const accessToken = await getAccessToken(supabase);
    runMetadata = { ...runMetadata, phase: 'token_ready', updated_at: new Date().toISOString() };
    const { error: tokenPhaseError } = await supabase
      .from('olist_order_items_backfill_runs')
      .update({ metadata: runMetadata })
      .eq('id', runRows.id);
    if (tokenPhaseError) throw tokenPhaseError;
    let ordersProcessed = 0;
    let ordersWithItems = 0;
    let ordersWithoutItems = 0;
    let ordersWithError = 0;
    let itemsUpserted = 0;
    let rateLimitEvents = 0;

    for (const candidate of (candidates ?? []) as Candidate[]) {
      if (Date.now() - startedAt > maxRuntimeMs) break;
      if (ordersProcessed > 0) await sleep(delayMs);

      try {
        const rawOrder = candidate.order_payload && orderItems(candidate.order_payload).length > 0
          ? candidate.order_payload
          : await fetchOrderDetail(accessToken, candidate.order_id);
        const normalizedOrder = normalizeOrder(candidate, rawOrder);
        const items = orderItems(normalizedOrder.payload)
          .map((item, index) => normalizeItemRow(normalizedOrder, item, index));

        if (items.length === 0) {
          ordersWithoutItems += 1;
          await supabase.rpc('mark_olist_order_item_backfill_queue', {
            p_queue_id: candidate.queue_id,
            p_status: 'no_items',
            p_last_error: 'Detalhe do pedido nao retornou itens.'
          });
          await supabase.from('olist_order_items_backfill_errors').insert({
            run_id: runRows.id,
            order_id: candidate.order_id,
            invoice_id: candidate.invoice_id,
            invoice_number: candidate.invoice_number,
            status: 'no_items',
            error_message: 'Detalhe do pedido nao retornou itens.',
            context: candidate
          });
        } else {
          const { error: upsertError } = await supabase
            .from('olist_order_items')
            .upsert(items, { onConflict: 'id' });
          if (upsertError) throw upsertError;
          ordersWithItems += 1;
          itemsUpserted += items.length;
        }
      } catch (error) {
        const status = (error as Error & { status?: number }).status ?? null;
        if (status === 429) rateLimitEvents += 1;
        ordersWithError += 1;
        await supabase.rpc('mark_olist_order_item_backfill_queue', {
          p_queue_id: candidate.queue_id,
          p_status: 'error',
          p_last_error: error instanceof Error ? error.message : String(error)
        });
        await supabase.from('olist_order_items_backfill_errors').insert({
          run_id: runRows.id,
          order_id: candidate.order_id,
          invoice_id: candidate.invoice_id,
          invoice_number: candidate.invoice_number,
          status: 'pending',
          http_status: status,
          error_message: error instanceof Error ? error.message : String(error),
          context: candidate
        });
      }

      ordersProcessed += 1;

      const progressAt = new Date().toISOString();
      const { error: progressError } = await supabase
        .from('olist_order_items_backfill_runs')
        .update({
          orders_processed: ordersProcessed,
          orders_with_items: ordersWithItems,
          orders_without_items: ordersWithoutItems,
          orders_with_error: ordersWithError,
          items_upserted: itemsUpserted,
          metadata: {
            ...runMetadata,
            rate_limit_events: rateLimitEvents,
            updated_at: progressAt
          }
        })
        .eq('id', runRows.id);
      if (progressError) throw progressError;
    }

    const status = ordersWithError > 0 || ordersProcessed < Number((candidates ?? []).length)
      ? 'partial'
      : 'success';
    const finishedAt = new Date().toISOString();
    const elapsedMs = Date.now() - startedAt;

    const { error: patchError } = await supabase
      .from('olist_order_items_backfill_runs')
      .update({
        status,
        finished_at: finishedAt,
        orders_processed: ordersProcessed,
        orders_with_items: ordersWithItems,
        orders_without_items: ordersWithoutItems,
        orders_with_error: ordersWithError,
        items_upserted: itemsUpserted,
        metadata: {
          ...runMetadata,
          phase: 'finished',
          rate_limit_events: rateLimitEvents,
          elapsed_ms: elapsedMs,
          processed_per_minute: elapsedMs > 0 ? Math.round((ordersProcessed / (elapsedMs / 60000)) * 100) / 100 : 0,
          updated_at: finishedAt
        }
      })
      .eq('id', runRows.id);
    if (patchError) throw patchError;

    return jsonResponse({
      ok: true,
      run_id: runRows.id,
      status,
      period: { startDate, endDate },
      candidates_total_at_start: Number(countData ?? 0),
      processed: ordersProcessed,
      orders_with_items: ordersWithItems,
      orders_without_items: ordersWithoutItems,
      orders_with_error: ordersWithError,
      items_upserted: itemsUpserted,
      rate_limit_events: rateLimitEvents,
      elapsed_ms: elapsedMs
    });
  } catch (error) {
    if (supabase && runId) {
      const failedAt = new Date().toISOString();
      await supabase
        .from('olist_order_items_backfill_runs')
        .update({
          status: 'failed',
          finished_at: failedAt,
          error_message: error instanceof Error ? error.message : String(error),
          metadata: { ...runMetadata, failed_at: failedAt, updated_at: failedAt }
        })
        .eq('id', runId);
    }
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
