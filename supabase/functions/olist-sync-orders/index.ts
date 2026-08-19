import { createClient } from 'npm:@supabase/supabase-js@2';

type JsonObject = Record<string, unknown>;

type OlistApiPayload = {
  itens?: unknown[];
  items?: unknown[];
  data?: unknown[];
  pedidos?: unknown[];
  paginacao?: JsonObject;
};

type SyncRun = {
  id: string;
  started_at?: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'failed';
  window_start: string;
  window_end: string;
  records_fetched: number | null;
  records_upserted: number | null;
  error_message: string | null;
  metadata: JsonObject | null;
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
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function todayIso() {
  return toIsoDate(new Date());
}

function daysAgoIso(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return toIsoDate(date);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function parseJsonOrThrow(text: string, context: string) {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context}: resposta nao veio em JSON`);
  }
}

function normalizeRows(payload: OlistApiPayload | unknown): Record<string, unknown>[] {
  const container = payload && typeof payload === 'object' ? payload as OlistApiPayload : {};
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(container.itens)
      ? container.itens
      : Array.isArray(container.items)
        ? container.items
        : Array.isArray(container.data)
          ? container.data
          : Array.isArray(container.pedidos)
            ? container.pedidos
            : [];

  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => {
      const id = String(
        row.id ?? row.codigo ?? row.numero ?? row.numeroPedido ?? row.numero_pedido ?? row.numeroPedidoEcommerce ?? ''
      ).trim();

      if (!id) {
        throw new Error('Encontrado pedido sem identificador.');
      }

      return {
        id,
        numero_pedido: row.numeroPedido ?? row.numero_pedido ?? row.numero ?? null,
        situacao: row.situacao ?? row.status ?? null,
        data_criacao: row.dataCriacao ?? row.data_criacao ?? row.created_at ?? null,
        data_atualizacao: row.dataAtualizacao ?? row.data_atualizacao ?? row.updated_at ?? null,
        cliente: row.cliente && typeof row.cliente === 'object' ? row.cliente : {},
        transportador: row.transportador && typeof row.transportador === 'object' ? row.transportador : {},
        payload: row,
        synced_at: new Date().toISOString()
      };
    });
}

async function getAccessToken(
  supabase: ReturnType<typeof createClient>
) {
  if (env.olistApiBearerToken) {
    return env.olistApiBearerToken;
  }

  requireValue('OLIST_API_TOKEN_URL', env.olistApiTokenUrl);
  requireValue('OLIST_API_CLIENT_ID', env.olistApiClientId);
  requireValue('OLIST_API_CLIENT_SECRET', env.olistApiClientSecret);

  const refreshToken = env.olistApiRefreshToken || await getStoredRefreshToken(supabase);
  requireValue('OLIST_API_REFRESH_TOKEN or stored token', refreshToken);

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: env.olistApiClientId,
    client_secret: env.olistApiClientSecret
  });

  const response = await fetch(env.olistApiTokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`Falha ao renovar token da Olist (${response.status}): ${text.slice(0, 300)}`);
  }

  if (!parsed.access_token) {
    throw new Error('A resposta de token da Olist nao trouxe access_token.');
  }

  await storeRefreshedToken(supabase, parsed, refreshToken);

  return parsed.access_token as string;
}

async function getStoredRefreshToken(
  supabase: ReturnType<typeof createClient>
) {
  const { data, error } = await supabase
    .from('olist_oauth_tokens')
    .select('refresh_token')
    .eq('provider', 'olist')
    .maybeSingle();

  if (error) throw error;

  return data?.refresh_token ?? '';
}

async function storeRefreshedToken(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  fallbackRefreshToken: string
) {
  const expiresIn = Number(payload.expires_in ?? 0);
  const expiresAt = expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const row = {
    provider: 'olist',
    access_token: typeof payload.access_token === 'string' ? payload.access_token : null,
    refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : fallbackRefreshToken,
    expires_at: expiresAt,
    scope: typeof payload.scope === 'string' ? payload.scope : null,
    token_type: typeof payload.token_type === 'string' ? payload.token_type : null,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('olist_oauth_tokens')
    .upsert(row, { onConflict: 'provider' });

  if (error) throw error;
}

function olistHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  headers[env.olistApiAuthHeader] = env.olistApiAuthPrefix
    ? `${env.olistApiAuthPrefix} ${accessToken}`
    : accessToken;
  return headers;
}

async function fetchOrderPage(
  accessToken: string,
  startDate: string,
  endDate: string,
  offset: number,
  limit: number,
  maxAttempts = 6
) {
  const baseUrl = env.olistApiBaseUrl.endsWith('/') ? env.olistApiBaseUrl : `${env.olistApiBaseUrl}/`;
  const url = new URL('pedidos', baseUrl);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('orderBy', 'desc');
  url.searchParams.set('dataInicial', startDate);
  url.searchParams.set('dataFinal', endDate);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(url, { headers: olistHeaders(accessToken) });
    const text = await response.text();

    if (response.ok) {
      return parseJsonOrThrow(text, 'Falha ao buscar pedidos da Olist') as OlistApiPayload;
    }

    // Rate limit / transient server error: back off and retry so a single 429
    // in the middle of a peak sweep doesn't fail (and roll back) the whole run.
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '0');
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(15000, 1500 * (attempt + 1));
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Falha ao buscar pedidos da Olist (${response.status}): ${text.slice(0, 300)}`);
  }

  throw new Error('Falha ao buscar pedidos da Olist (429): limite de taxa da Olist excedido');
}

async function fetchOlistOrderDetail(accessToken: string, orderId: string) {
  const baseUrl = env.olistApiBaseUrl.endsWith('/') ? env.olistApiBaseUrl : `${env.olistApiBaseUrl}/`;
  const url = new URL(`pedidos/${orderId}`, baseUrl);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(url, { headers: olistHeaders(accessToken) });
    const text = await response.text();

    if (response.ok) {
      const payload = parseJsonOrThrow(text, `Falha ao buscar detalhe do pedido ${orderId}`) as Record<string, unknown>;

      return {
        id: String(payload.id ?? orderId),
        numero_pedido: payload.numeroPedido ?? payload.numero_pedido ?? null,
        situacao: payload.situacao == null ? null : String(payload.situacao),
        data_criacao: payload.data ?? payload.dataCriacao ?? null,
        data_atualizacao: payload.dataAtualizacao ?? payload.dataAlteracao ?? null,
        cliente: payload.cliente && typeof payload.cliente === 'object' ? payload.cliente : {},
        transportador: payload.transportador && typeof payload.transportador === 'object' ? payload.transportador : {},
        payload,
        synced_at: new Date().toISOString()
      };
    }

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '0');
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Falha ao buscar detalhe do pedido ${orderId} (${response.status}): ${text.slice(0, 300)}`);
  }

  throw new Error(`Falha ao buscar detalhe do pedido ${orderId} (429): limite de taxa da Olist excedido`);
}

function mergeExistingDetail(
  row: Record<string, unknown>,
  existing: { payload: Record<string, unknown>; data_atualizacao: string | null }
) {
  return {
    ...row,
    payload: {
      ...existing.payload,
      ...(row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {}),
      itens: existing.payload.itens
    }
  };
}

async function hydrateOrderDetails(
  supabase: ReturnType<typeof createClient>,
  accessToken: string,
  rows: Record<string, unknown>[],
  detailDelayMs: number
) {
  const existingById = new Map<string, { payload: Record<string, unknown>; data_atualizacao: string | null }>();

  for (const batch of chunk(rows, 200)) {
    const ids = batch.map((row) => String(row.id));
    const { data, error } = await supabase
      .from('olist_orders')
      .select('id,payload,data_atualizacao')
      .in('id', ids);

    if (error) throw error;

    for (const existing of data ?? []) {
      const payload = existing.payload && typeof existing.payload === 'object'
        ? existing.payload as Record<string, unknown>
        : {};
      if (Array.isArray(payload.itens)) {
        existingById.set(String(existing.id), {
          payload,
          data_atualizacao: existing.data_atualizacao == null ? null : String(existing.data_atualizacao)
        });
      }
    }
  }

  const detailedRows: Record<string, unknown>[] = [];

  for (const row of rows) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {};
    if (Array.isArray(payload.itens)) {
      detailedRows.push(row);
      continue;
    }

    const existing = existingById.get(String(row.id));
    const rowUpdatedAt = row.data_atualizacao == null ? null : String(row.data_atualizacao);
    if (existing && existing.data_atualizacao === rowUpdatedAt) {
      detailedRows.push(mergeExistingDetail(row, existing));
      continue;
    }

    if (detailDelayMs > 0) await sleep(detailDelayMs);
    detailedRows.push(await fetchOlistOrderDetail(accessToken, String(row.id)));
  }

  return detailedRows;
}

async function findResumeRun(
  supabase: ReturnType<typeof createClient>,
  startDate: string,
  endDate: string
) {
  const { data, error } = await supabase
    .from('olist_order_sync_runs')
    .select('*')
    .eq('window_start', startDate)
    .eq('window_end', endDate)
    .in('status', ['running', 'failed'])
    .order('started_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data ?? []).sort((left: SyncRun, right: SyncRun) => {
    const leftOffset = Number(left.metadata?.next_offset ?? 0);
    const rightOffset = Number(right.metadata?.next_offset ?? 0);
    if (rightOffset !== leftOffset) return rightOffset - leftOffset;
    return String(right.started_at ?? '').localeCompare(String(left.started_at ?? ''));
  })[0] as SyncRun | undefined;
}

async function createRun(
  supabase: ReturnType<typeof createClient>,
  startDate: string,
  endDate: string,
  metadata: JsonObject
) {
  const { data, error } = await supabase
    .from('olist_order_sync_runs')
    .insert({
      status: 'running',
      window_start: startDate,
      window_end: endDate,
      metadata
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as SyncRun;
}

async function patchRun(supabase: ReturnType<typeof createClient>, runId: string, patch: JsonObject) {
  const { error } = await supabase
    .from('olist_order_sync_runs')
    .update(patch)
    .eq('id', runId);

  if (error) throw error;
}

Deno.serve(async (req) => {
  let supabase: ReturnType<typeof createClient> | null = null;
  let run: SyncRun | null = null;

  try {
    requireValue('SUPABASE_URL', env.supabaseUrl);
    requireValue('SUPABASE_SERVICE_ROLE_KEY', env.supabaseServiceRoleKey);
    requireValue('OLIST_API_BASE_URL', env.olistApiBaseUrl);
    requireValue('OLIST_SYNC_JOB_SECRET', env.olistSyncJobSecret);

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const syncSecret = req.headers.get('x-sync-secret');
    if (syncSecret !== env.olistSyncJobSecret) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const body = req.headers.get('content-type')?.includes('application/json')
      ? await req.json().catch(() => ({})) as JsonObject
      : {};

    // Window: explicit startDate/endDate wins; otherwise fall back to lookbackDays (legacy).
    const lookbackDays = clampPositiveInt(body.lookbackDays, 2, 31);
    const startDate = typeof body.startDate === 'string' ? body.startDate : daysAgoIso(lookbackDays);
    const endDate = typeof body.endDate === 'string' ? body.endDate : todayIso();
    const pageSize = clampPositiveInt(body.pageSize ?? body.limit, 100, 100);
    const maxPages = clampPositiveInt(body.maxPages, 50, 1000);
    const delayMs = clampPositiveInt(body.delayMs, 0, 10000);
    const detailDelayMs = clampPositiveInt(body.detailDelayMs, 250, 10000);
    // Headers-only pass by default; item/detail hydration is opt-in (slow path).
    const shouldHydrateDetails = body.hydrateDetails === true;
    const resume = body.resume !== false;

    const runMetadata = {
      source: 'supabase/functions/olist-sync-orders',
      page_size: pageSize,
      hydrate_details: shouldHydrateDetails,
      max_pages: maxPages,
      next_offset: 0,
      started_at: new Date().toISOString()
    };

    run = resume ? (await findResumeRun(supabase, startDate, endDate)) ?? null : null;
    run = run ?? await createRun(supabase, startDate, endDate, runMetadata);

    if (!run?.id) throw new Error('Nao foi possivel criar ou retomar o run de sync.');

    if (run.status !== 'running') {
      await patchRun(supabase, run.id, {
        status: 'running',
        finished_at: null,
        error_message: null,
        metadata: {
          ...(run.metadata ?? {}),
          resumed_at: new Date().toISOString(),
          hydrate_details: shouldHydrateDetails
        }
      });
    }

    const accessToken = await getAccessToken(supabase);
    const existingMetadata = run.metadata && typeof run.metadata === 'object' ? run.metadata : {};
    let offset = resume ? Number(existingMetadata.next_offset ?? 0) : 0;
    let totalFetched = Number(run.records_fetched ?? 0);
    let totalUpserted = Number(run.records_upserted ?? 0);
    let totalReported = Number(existingMetadata.total_reported ?? 0);
    let pagesProcessed = 0;
    let completed = false;

    for (let page = 0; page < maxPages; page += 1) {
      const payload = await fetchOrderPage(accessToken, startDate, endDate, offset, pageSize);
      const normalized = normalizeRows(payload);
      const pagination = payload && typeof payload === 'object' ? payload.paginacao as JsonObject | undefined : undefined;
      totalReported = Number(pagination?.total ?? totalReported ?? 0);

      if (normalized.length === 0) {
        completed = true;
        break;
      }

      const rows = shouldHydrateDetails
        ? await hydrateOrderDetails(supabase, accessToken, normalized, detailDelayMs)
        : normalized;

      for (const batch of chunk(rows, 50)) {
        const { error } = await supabase
          .from('olist_orders')
          .upsert(batch, { onConflict: 'id' });

        if (error) throw error;
      }

      totalFetched += normalized.length;
      totalUpserted += rows.length;
      offset += normalized.length;
      pagesProcessed += 1;
      completed = totalReported > 0 ? offset >= totalReported : normalized.length < pageSize;

      await patchRun(supabase, run.id, {
        records_fetched: totalFetched,
        records_upserted: totalUpserted,
        metadata: {
          ...(run.metadata ?? {}),
          source: 'supabase/functions/olist-sync-orders',
          page_size: pageSize,
          hydrate_details: shouldHydrateDetails,
          total_reported: totalReported,
          next_offset: offset,
          last_page_size: normalized.length,
          updated_at: new Date().toISOString()
        }
      });

      if (completed) break;
      if (delayMs > 0) await sleep(delayMs);
    }

    await patchRun(supabase, run.id, {
      status: completed ? 'success' : 'running',
      finished_at: completed ? new Date().toISOString() : null,
      records_fetched: totalFetched,
      records_upserted: totalUpserted,
      error_message: null,
      metadata: {
        ...(run.metadata ?? {}),
        source: 'supabase/functions/olist-sync-orders',
        page_size: pageSize,
        hydrate_details: shouldHydrateDetails,
        total_reported: totalReported,
        next_offset: offset,
        completed,
        updated_at: new Date().toISOString()
      }
    });

    return jsonResponse({
      ok: true,
      run_id: run.id,
      window_start: startDate,
      window_end: endDate,
      pages_processed: pagesProcessed,
      next_offset: offset,
      total_reported: totalReported,
      fetched: totalFetched,
      upserted: totalUpserted,
      hydrate_details: shouldHydrateDetails,
      completed
    });
  } catch (error) {
    console.error(error);
    if (supabase && run?.id) {
      await patchRun(supabase, run.id, {
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : String(error),
        metadata: {
          ...(run.metadata ?? {}),
          failed_at: new Date().toISOString()
        }
      }).catch(() => null);
    }

    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
