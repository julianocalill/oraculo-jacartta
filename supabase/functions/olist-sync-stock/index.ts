import { createClient } from 'npm:@supabase/supabase-js@2';

type StockPayload = {
  itens?: unknown[];
  items?: unknown[];
  data?: unknown[];
  produtos?: unknown[];
  estoques?: unknown[];
};

type ProductSummary = {
  id: string;
  sku: string | null;
  descricao: string | null;
  situacao: string | null;
  payload: Record<string, unknown>;
};

const env = {
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  supabaseServiceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  olistApiBaseUrl: Deno.env.get('OLIST_API_BASE_URL') ?? '',
  olistApiTokenUrl: Deno.env.get('OLIST_API_TOKEN_URL') ?? '',
  olistApiClientId: Deno.env.get('OLIST_API_CLIENT_ID') ?? '',
  olistApiClientSecret: Deno.env.get('OLIST_API_CLIENT_SECRET') ?? '',
  olistApiRefreshToken: Deno.env.get('OLIST_API_REFRESH_TOKEN') ?? '',
  olistStockEndpoint: Deno.env.get('OLIST_STOCK_ENDPOINT') ?? 'estoque',
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

function parseJsonOrThrow(text: string, context: string) {
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context}: resposta nao veio em JSON`);
  }
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

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function runner() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
  return results;
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function readRows(payload: StockPayload | unknown) {
  const container = payload && typeof payload === 'object' ? payload as StockPayload : {};
  return Array.isArray(payload)
    ? payload
    : Array.isArray(container.itens)
      ? container.itens
      : Array.isArray(container.items)
        ? container.items
        : Array.isArray(container.data)
          ? container.data
          : Array.isArray(container.produtos)
            ? container.produtos
            : Array.isArray(container.estoques)
              ? container.estoques
              : [];
}

function normalizeProductList(payload: StockPayload | unknown) {
  return readRows(payload)
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => {
      const id = String(
        row.idProduto ??
        row.id_produto ??
        row.produtoId ??
        row.produto_id ??
        row.id ??
        row.codigo ??
        row.codigo ??
        row.sku ??
        ''
      ).trim();

      if (!id) {
        throw new Error('Encontrado produto sem identificador.');
      }

      return {
        id,
        sku: row.sku === null || row.sku === undefined ? null : String(row.sku),
        descricao: row.descricao === null || row.descricao === undefined ? null : String(row.descricao),
        situacao: row.situacao === null || row.situacao === undefined ? null : String(row.situacao),
        payload: row
      } satisfies ProductSummary;
    });
}

function normalizeStockRow(product: Record<string, unknown>, batchId: string) {
  const estoque = product.estoque && typeof product.estoque === 'object'
    ? product.estoque as Record<string, unknown>
    : {};

  const id = String(product.id ?? product.codigo ?? product.sku ?? '').trim();

  if (!id) {
    throw new Error('Encontrado detalhe de produto sem identificador.');
  }

  return {
    id,
    produto_id: id,
    sku: product.sku === null || product.sku === undefined ? null : String(product.sku),
    nome: product.descricao === null || product.descricao === undefined ? null : String(product.descricao),
    saldo: asNumber(estoque.quantidade),
    reservado: asNumber(estoque.reservado),
    disponivel: asNumber(estoque.disponivel ?? estoque.quantidade),
    depositos: Array.isArray(estoque.depositos) ? estoque.depositos : [],
    payload: product,
    active: true,
    sync_batch_id: batchId,
    synced_at: new Date().toISOString()
  };
}

async function getStoredRefreshToken(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from('olist_oauth_tokens')
    .select('refresh_token')
    .eq('provider', 'olist')
    .maybeSingle();

  if (error) throw error;
  return data?.refresh_token ?? '';
}

async function getAccessToken(supabase: ReturnType<typeof createClient>) {
  requireValue('OLIST_API_TOKEN_URL', env.olistApiTokenUrl);
  requireValue('OLIST_API_CLIENT_ID', env.olistApiClientId);
  requireValue('OLIST_API_CLIENT_SECRET', env.olistApiClientSecret);

  const refreshToken = env.olistApiRefreshToken || await getStoredRefreshToken(supabase);
  requireValue('OLIST_API_REFRESH_TOKEN or stored token', refreshToken);

  const response = await fetch(env.olistApiTokenUrl, {
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
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Falha ao renovar token da Olist (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = parseJsonOrThrow(text, 'Falha ao renovar token da Olist') as Record<string, unknown>;
  if (typeof payload.access_token !== 'string') {
    throw new Error('A resposta de token da Olist nao trouxe access_token.');
  }

  const expiresIn = Number(payload.expires_in ?? 0);
  const expiresAt = expiresIn > 0
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const { error } = await supabase
    .from('olist_oauth_tokens')
    .upsert({
      provider: 'olist',
      access_token: payload.access_token,
      refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : refreshToken,
      expires_at: expiresAt,
      scope: typeof payload.scope === 'string' ? payload.scope : null,
      token_type: typeof payload.token_type === 'string' ? payload.token_type : null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'provider' });

  if (error) throw error;

  return payload.access_token;
}

async function fetchProductDetail(accessToken: string, productId: string) {
  const baseUrl = env.olistApiBaseUrl.endsWith('/') ? env.olistApiBaseUrl : `${env.olistApiBaseUrl}/`;
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  headers[env.olistApiAuthHeader] = env.olistApiAuthPrefix
    ? `${env.olistApiAuthPrefix} ${accessToken}`
    : accessToken;

  const url = new URL(`produtos/${productId}`, baseUrl);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers });
    const text = await response.text();

    if (response.ok) {
      return parseJsonOrThrow(text, `Falha ao buscar detalhe do produto ${productId}`) as Record<string, unknown>;
    }

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after') ?? '0');
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 750 * (attempt + 1);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Falha ao buscar detalhe do produto ${productId} (${response.status}): ${text.slice(0, 300)}`);
  }

  throw new Error(`Falha ao buscar detalhe do produto ${productId} (429): limite de taxa da Olist excedido`);
}

async function fetchProductPage(accessToken: string, limit: number, offset: number) {
  const baseUrl = env.olistApiBaseUrl.endsWith('/') ? env.olistApiBaseUrl : `${env.olistApiBaseUrl}/`;
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  headers[env.olistApiAuthHeader] = env.olistApiAuthPrefix
    ? `${env.olistApiAuthPrefix} ${accessToken}`
    : accessToken;

  const url = new URL('produtos', baseUrl);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));

  const response = await fetch(url, { headers });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Falha ao listar produtos da Olist (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = parseJsonOrThrow(text, 'Falha ao listar produtos da Olist');
  const products = normalizeProductList(payload);
  const total = Number((payload as Record<string, unknown>)?.paginacao && typeof (payload as Record<string, unknown>).paginacao === 'object'
    ? ((payload as { paginacao?: { total?: number } }).paginacao?.total ?? products.length)
    : products.length);

  return { products, total };
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

    if (req.headers.get('x-sync-secret') !== env.olistSyncJobSecret) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const batchId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const accessToken = await getAccessToken(supabase);
    const limit = 100;
    let offset = 0;
    let fetched = 0;
    let upserted = 0;
    let total = 0;

    for (let page = 0; page < 1000; page += 1) {
      const productPage = await fetchProductPage(accessToken, limit, offset);
      total = productPage.total;

      if (productPage.products.length === 0) {
        break;
      }

      fetched += productPage.products.length;

      const details = await mapConcurrent(productPage.products, 2, async (product) => {
        const detail = await fetchProductDetail(accessToken, product.id);
        return normalizeStockRow(detail, batchId);
      });

      for (const group of chunk(details, 50)) {
        const { error } = await supabase
          .from('olist_stock_items')
          .upsert(group, { onConflict: 'id' });

        if (error) throw error;
        upserted += group.length;
      }

      offset += productPage.products.length;
      if (offset >= total) {
        break;
      }
    }

    const { error: staleError } = await supabase
      .from('olist_stock_items')
      .update({ active: false })
      .neq('sync_batch_id', batchId);

    if (staleError) throw staleError;

    const { error: logError } = await supabase
      .from('olist_stock_sync_runs')
      .insert({
        batch_id: batchId,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: 'success',
        records_fetched: fetched,
        records_upserted: upserted,
        error_message: null
      });

    if (logError) throw logError;

    return jsonResponse({
      ok: true,
      batch_id: batchId,
      fetched,
      upserted
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
