import { createClient } from 'npm:@supabase/supabase-js@2';

type OlistApiPayload = {
  itens?: unknown[];
  items?: unknown[];
  data?: unknown[];
  pedidos?: unknown[];
};

type SyncRun = {
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'failed';
  window_start: string;
  window_end: string;
  records_fetched: number;
  records_upserted: number;
  error_message: string | null;
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

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
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

async function fetchOlistOrders(accessToken: string, lookbackDays = 2, maxPages = 50) {
  const baseUrl = env.olistApiBaseUrl.endsWith('/') ? env.olistApiBaseUrl : `${env.olistApiBaseUrl}/`;
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  headers[env.olistApiAuthHeader] = env.olistApiAuthPrefix
    ? `${env.olistApiAuthPrefix} ${accessToken}`
    : accessToken;

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd);
  windowStart.setDate(windowStart.getDate() - lookbackDays);

  const startDate = toIsoDate(windowStart);
  const endDate = toIsoDate(windowEnd);
  const limit = 100;
  let offset = 0;
  const rows: Record<string, unknown>[] = [];

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL('pedidos', baseUrl);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('orderBy', 'desc');
    url.searchParams.set('dataInicial', startDate);
    url.searchParams.set('dataFinal', endDate);

    const response = await fetch(url, { headers });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(`Falha ao buscar pedidos da Olist (${response.status}): ${text.slice(0, 300)}`);
    }

    const payload = parseJsonOrThrow(text, 'Falha ao buscar pedidos da Olist');
    const normalized = normalizeRows(payload);
    if (normalized.length === 0) {
      break;
    }

    rows.push(...normalized);
    offset += normalized.length;

    if (normalized.length < limit) {
      break;
    }
  }

  return {
    rows,
    windowStart: startDate,
    windowEnd: endDate
  };
}

async function fetchOlistOrderDetail(accessToken: string, orderId: string) {
  const baseUrl = env.olistApiBaseUrl.endsWith('/') ? env.olistApiBaseUrl : `${env.olistApiBaseUrl}/`;
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  headers[env.olistApiAuthHeader] = env.olistApiAuthPrefix
    ? `${env.olistApiAuthPrefix} ${accessToken}`
    : accessToken;

  const response = await fetch(new URL(`pedidos/${orderId}`, baseUrl), { headers });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Falha ao buscar detalhe do pedido ${orderId} (${response.status}): ${text.slice(0, 300)}`);
  }

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

async function hydrateOrderDetails(accessToken: string, rows: Record<string, unknown>[]) {
  const detailedRows: Record<string, unknown>[] = [];

  for (const row of rows) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {};
    if (Array.isArray(payload.itens)) {
      detailedRows.push(row);
      continue;
    }

    detailedRows.push(await fetchOlistOrderDetail(accessToken, String(row.id)));
  }

  return detailedRows;
}

Deno.serve(async (req) => {
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

    const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const startedAt = new Date().toISOString();
    const run: SyncRun = {
      started_at: startedAt,
      finished_at: null,
      status: 'running',
      window_start: '',
      window_end: '',
      records_fetched: 0,
      records_upserted: 0,
      error_message: null
    };

    const requestBody = req.headers.get('content-type')?.includes('application/json')
      ? await req.json().catch(() => ({}))
      : {};
    const typedBody = requestBody as {
      hydrateDetails?: boolean;
      lookbackDays?: number;
      maxPages?: number;
    };
    const shouldHydrateDetails = Boolean(typedBody.hydrateDetails);
    const lookbackDays = Number.isFinite(Number(typedBody.lookbackDays)) ? Number(typedBody.lookbackDays) : 2;
    const maxPages = Number.isFinite(Number(typedBody.maxPages)) ? Number(typedBody.maxPages) : 50;

    const accessToken = await getAccessToken(supabase);
    const syncResult = await fetchOlistOrders(accessToken, lookbackDays, maxPages);
    const rows = shouldHydrateDetails
      ? await hydrateOrderDetails(accessToken, syncResult.rows)
      : syncResult.rows;

    run.window_start = syncResult.windowStart;
    run.window_end = syncResult.windowEnd;
    run.records_fetched = rows.length;

    for (const rows of chunk(rows, 50)) {
      const { error } = await supabase
        .from('olist_orders')
        .upsert(rows, { onConflict: 'id' });

      if (error) throw error;
      run.records_upserted += rows.length;
    }

    run.status = 'success';
    run.finished_at = new Date().toISOString();

    const { error: insertError } = await supabase
      .from('olist_sync_runs')
      .insert(run);

    if (insertError) throw insertError;

    return jsonResponse({
      ok: true,
      window_start: run.window_start,
      window_end: run.window_end,
      fetched: run.records_fetched,
      upserted: run.records_upserted
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
