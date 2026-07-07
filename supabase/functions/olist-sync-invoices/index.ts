import { createClient } from 'npm:@supabase/supabase-js@2';

type JsonObject = Record<string, unknown>;

type SyncRun = {
  id: string;
  started_at?: string;
  endpoint: string;
  window_start: string;
  window_end: string;
  status: 'running' | 'success' | 'failed';
  records_fetched: number | null;
  records_upserted: number | null;
  items_upserted: number | null;
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
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function parseNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  const normalized = text
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstValue(row: JsonObject, keys: string[]) {
  for (const key of keys) {
    let current: unknown = row;
    for (const part of key.split('.')) {
      if (!current || typeof current !== 'object') {
        current = undefined;
        break;
      }
      current = (current as JsonObject)[part];
    }
    if (current != null && String(current).trim() !== '') return current;
  }
  return null;
}

function normalizeListRows(payload: unknown): JsonObject[] {
  const container = payload && typeof payload === 'object' ? payload as JsonObject : {};
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(container.itens)
      ? container.itens
      : Array.isArray(container.items)
        ? container.items
        : Array.isArray(container.data)
          ? container.data
          : Array.isArray(container.notas)
            ? container.notas
            : Array.isArray(container.notasFiscais)
              ? container.notasFiscais
              : Array.isArray(container.nfes)
                ? container.nfes
                : [];

  return rows.filter((row): row is JsonObject => Boolean(row) && typeof row === 'object');
}

function normalizeItems(row: JsonObject) {
  const items = firstValue(row, ['itens', 'items', 'produtos', 'notaFiscal.itens', 'nfe.itens']);
  return Array.isArray(items)
    ? items.filter((item): item is JsonObject => Boolean(item) && typeof item === 'object')
    : [];
}

function normalizeInvoice(row: JsonObject) {
  const invoiceNumber = firstValue(row, [
    'numero',
    'numeroNotaFiscal',
    'numeroNfe',
    'numeroNF',
    'notaFiscal.numero',
    'nfe.numero'
  ]);
  const accessKey = firstValue(row, [
    'chaveAcesso',
    'chave_acesso',
    'chaveAcessoNfe',
    'notaFiscal.chaveAcesso',
    'nfe.chaveAcesso'
  ]);
  const rawId = firstValue(row, ['id', 'codigo', 'idNotaFiscal', 'idNfe', 'notaFiscal.id', 'nfe.id']);
  const id = String(rawId ?? accessKey ?? invoiceNumber ?? '').trim();
  if (!id) return null;

  return {
    id,
    invoice_number: invoiceNumber == null ? null : String(invoiceNumber),
    invoice_series: firstValue(row, ['serie', 'serieNotaFiscal', 'notaFiscal.serie', 'nfe.serie']),
    emission_date: firstValue(row, ['dataEmissao', 'data_emissao', 'emissao', 'data', 'notaFiscal.dataEmissao', 'nfe.dataEmissao']),
    cancellation_date: firstValue(row, ['dataCancelamento', 'data_cancelamento', 'notaFiscal.dataCancelamento', 'nfe.dataCancelamento']),
    status: firstValue(row, ['situacao', 'status', 'statusNotaFiscal', 'notaFiscal.status', 'nfe.status']),
    status_label: firstValue(row, ['descricaoSituacao', 'statusDescricao', 'situacaoDescricao', 'notaFiscal.descricaoSituacao']),
    client_name: firstValue(row, ['cliente.nome', 'cliente.razaoSocial', 'nomeCliente', 'destinatario.nome']),
    client_document: firstValue(row, ['cliente.cpfCnpj', 'cliente.cnpj', 'cliente.cpf', 'documentoCliente', 'destinatario.cpfCnpj']),
    uf: firstValue(row, ['cliente.endereco.uf', 'cliente.uf', 'enderecoEntrega.uf', 'uf', 'estado', 'destinatario.uf', 'destinatario.endereco.uf']),
    total_amount: parseNumber(firstValue(row, [
      'valor',
      'valorTotal',
      'valor_total',
      'valorTotalNota',
      'valorNota',
      'total',
      'valorNotaComImpostos',
      'notaFiscal.valorTotal',
      'nfe.valorTotal'
    ])),
    channel_name: firstValue(row, ['ecommerce.canalVenda', 'canal', 'canalVenda', 'marketplace.nome']),
    integration_name: firstValue(row, ['ecommerce.nome', 'integracao', 'integracao.nome', 'origem.nome', 'fonte']),
    marketplace_name: firstValue(row, ['ecommerce.nome', 'marketplace', 'marketplace.nome']),
    order_id: firstValue(row, ['pedido.id', 'idPedido', 'pedidoId', 'idPedidoEcommerce']),
    order_number: firstValue(row, [
      'ecommerce.numeroPedidoEcommerce',
      'ecommerce.numeroPedidoCanalVenda',
      'pedido.numero',
      'numeroPedido',
      'numero_pedido',
      'pedido.numeroPedido'
    ]),
    access_key: accessKey == null ? null : String(accessKey),
    raw_json: row,
    synced_at: new Date().toISOString()
  };
}

function normalizeInvoiceItems(invoice: ReturnType<typeof normalizeInvoice>, row: JsonObject) {
  if (!invoice) return [];
  return normalizeItems(row).map((item, index) => {
    const itemId = firstValue(item, ['idItem', 'id', 'codigoItem']);
    const productId = firstValue(item, ['idProduto', 'produto.id', 'produtoId', 'codigoProduto']);
    const sku = firstValue(item, ['codigo', 'produto.codigo', 'sku', 'codigoProduto', 'produto.sku']);
    const quantity = parseNumber(firstValue(item, ['quantidade', 'qtde', 'qtd']));
    const unitValue = parseNumber(firstValue(item, ['valorUnitario', 'valor_unitario', 'preco', 'valor']));
    const totalValue = parseNumber(firstValue(item, ['valorTotal', 'valor_total', 'total']));

    return {
      id: `${invoice.id}:${itemId ?? index + 1}`,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      line_number: index + 1,
      product_id: productId == null ? null : String(productId),
      sku: sku == null ? null : String(sku),
      description: firstValue(item, ['descricao', 'nome', 'produto.nome', 'produto.descricao']),
      quantity,
      unit_value: unitValue,
      total_value: totalValue || quantity * unitValue,
      raw_json: item,
      synced_at: new Date().toISOString()
    };
  });
}

function olistHeaders(accessToken: string) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  headers[env.olistApiAuthHeader] = env.olistApiAuthPrefix
    ? `${env.olistApiAuthPrefix} ${accessToken}`
    : accessToken;
  return headers;
}

async function fetchJsonWithRetry(url: URL, options: RequestInit, context: string, maxAttempts = 6) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      clearTimeout(timeout);

      if (response.ok) return text ? JSON.parse(text) : {};
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after') ?? '0');
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1));
        continue;
      }
      throw new Error(`${context} failed (${response.status}): ${text.slice(0, 300)}`);
    } catch (error) {
      clearTimeout(timeout);
      if (attempt === maxAttempts - 1) throw error;
      await sleep(1500 * (attempt + 1));
    }
  }

  throw new Error(`${context} failed: limite de tentativas excedido`);
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

async function storeRefreshedToken(
  supabase: ReturnType<typeof createClient>,
  payload: JsonObject,
  fallbackRefreshToken: string
) {
  const expiresIn = Number(payload.expires_in ?? 0);
  const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

  const { error } = await supabase
    .from('olist_oauth_tokens')
    .upsert({
      provider: 'olist',
      access_token: typeof payload.access_token === 'string' ? payload.access_token : null,
      refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : fallbackRefreshToken,
      expires_at: expiresAt,
      scope: typeof payload.scope === 'string' ? payload.scope : null,
      token_type: typeof payload.token_type === 'string' ? payload.token_type : null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'provider' });

  if (error) throw error;
}

async function getAccessToken(supabase: ReturnType<typeof createClient>) {
  if (env.olistApiBearerToken) return env.olistApiBearerToken;

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
  const payload = text ? JSON.parse(text) as JsonObject : {};
  if (!response.ok) throw new Error(`Falha ao renovar token da Olist (${response.status}): ${text.slice(0, 300)}`);
  if (!payload.access_token || typeof payload.access_token !== 'string') {
    throw new Error('A resposta de token da Olist nao trouxe access_token.');
  }

  await storeRefreshedToken(supabase, payload, refreshToken);
  return payload.access_token;
}

async function fetchInvoicePage(
  accessToken: string,
  endpoint: string,
  startDate: string,
  endDate: string,
  offset: number,
  limit: number
) {
  const baseUrl = env.olistApiBaseUrl.endsWith('/') ? env.olistApiBaseUrl : `${env.olistApiBaseUrl}/`;
  const url = new URL(endpoint.replace(/^\//, ''), baseUrl);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('orderBy', 'desc');
  url.searchParams.set('dataInicial', startDate);
  url.searchParams.set('dataFinal', endDate);
  return fetchJsonWithRetry(url, { headers: olistHeaders(accessToken) }, `Olist ${endpoint} offset=${offset}`);
}

async function fetchInvoiceDetail(accessToken: string, endpoint: string, invoiceId: string) {
  const baseUrl = env.olistApiBaseUrl.endsWith('/') ? env.olistApiBaseUrl : `${env.olistApiBaseUrl}/`;
  const url = new URL(`${endpoint.replace(/^\//, '')}/${encodeURIComponent(invoiceId)}`, baseUrl);
  return fetchJsonWithRetry(url, { headers: olistHeaders(accessToken) }, `Olist ${endpoint}/${invoiceId}`, 4);
}

async function findResumeRun(
  supabase: ReturnType<typeof createClient>,
  endpoint: string,
  startDate: string,
  endDate: string
) {
  const { data, error } = await supabase
    .from('olist_invoice_sync_runs')
    .select('*')
    .eq('endpoint', endpoint)
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
  endpoint: string,
  startDate: string,
  endDate: string,
  metadata: JsonObject
) {
  const { data, error } = await supabase
    .from('olist_invoice_sync_runs')
    .insert({
      status: 'running',
      endpoint,
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
    .from('olist_invoice_sync_runs')
    .update(patch)
    .eq('id', runId);

  if (error) throw error;
}

async function upsertRows(supabase: ReturnType<typeof createClient>, table: string, rows: JsonObject[]) {
  for (let index = 0; index < rows.length; index += 500) {
    const batch = rows.slice(index, index + 500);
    if (batch.length === 0) continue;
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: 'id' });

    if (error) throw error;
  }
}

Deno.serve(async (req) => {
  let supabase: ReturnType<typeof createClient> | null = null;
  let run: SyncRun | null = null;

  try {
    requireValue('SUPABASE_URL', env.supabaseUrl);
    requireValue('SUPABASE_SERVICE_ROLE_KEY', env.supabaseServiceRoleKey);
    requireValue('OLIST_API_BASE_URL', env.olistApiBaseUrl);
    requireValue('OLIST_SYNC_JOB_SECRET', env.olistSyncJobSecret);

    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    if (req.headers.get('x-sync-secret') !== env.olistSyncJobSecret) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = req.headers.get('content-type')?.includes('application/json')
      ? await req.json().catch(() => ({})) as JsonObject
      : {};

    const endpoint = String(body.endpoint ?? 'notas').replace(/^\/+/, '') || 'notas';
    const lookbackDays = clampPositiveInt(body.lookbackDays, 3, 31);
    const startDate = typeof body.startDate === 'string' ? body.startDate : daysAgoIso(lookbackDays);
    const endDate = typeof body.endDate === 'string' ? body.endDate : todayIso();
    const pageSize = clampPositiveInt(body.pageSize ?? body.limit, 50, 100);
    const maxPages = clampPositiveInt(body.maxPages, 2, 300);
    const delayMs = clampPositiveInt(body.delayMs, 1000, 10000);
    const detailDelayMs = clampPositiveInt(body.detailDelayMs, 400, 10000);
    const hydrateDetails = body.hydrateDetails !== false;
    const resume = body.resume !== false;

    supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const runMetadata = {
      source: 'supabase/functions/olist-sync-invoices',
      endpoint,
      page_size: pageSize,
      hydrate_details: hydrateDetails,
      max_pages: maxPages,
      next_offset: 0,
      started_at: new Date().toISOString()
    };

    run = resume
      ? await findResumeRun(supabase, endpoint, startDate, endDate) ?? null
      : null;
    run = run ?? await createRun(supabase, endpoint, startDate, endDate, runMetadata);

    if (!run?.id) throw new Error('Nao foi possivel criar ou retomar o run de sync.');

    if (run.status !== 'running') {
      await patchRun(supabase, run.id, {
        status: 'running',
        finished_at: null,
        error_message: null,
        metadata: {
          ...(run.metadata ?? {}),
          resumed_at: new Date().toISOString(),
          hydrate_details: hydrateDetails
        }
      });
    }

    const accessToken = await getAccessToken(supabase);
    const existingMetadata = run.metadata && typeof run.metadata === 'object' ? run.metadata : {};
    let offset = resume ? Number(existingMetadata.next_offset ?? 0) : 0;
    let totalFetched = Number(run.records_fetched ?? 0);
    let totalInvoices = Number(run.records_upserted ?? 0);
    let totalItems = Number(run.items_upserted ?? 0);
    let totalReported = Number(existingMetadata.total_reported ?? 0);
    let pagesProcessed = 0;
    let completed = false;

    for (let page = 0; page < maxPages; page += 1) {
      const payload = await fetchInvoicePage(accessToken, endpoint, startDate, endDate, offset, pageSize) as JsonObject;
      const rows = normalizeListRows(payload);
      const pagination = payload && typeof payload === 'object' ? payload.paginacao as JsonObject | undefined : undefined;
      totalReported = Number(pagination?.total ?? totalReported ?? 0);
      if (rows.length === 0) {
        completed = true;
        break;
      }

      const invoices: JsonObject[] = [];
      const items: JsonObject[] = [];
      let detailErrors = 0;

      for (const row of rows) {
        const listInvoice = normalizeInvoice(row);
        if (!listInvoice) continue;

        let sourceRow = row;
        let invoice = listInvoice;
        if (hydrateDetails) {
          try {
            await sleep(detailDelayMs);
            const detailPayload = await fetchInvoiceDetail(accessToken, endpoint, listInvoice.id);
            if (detailPayload && typeof detailPayload === 'object') {
              sourceRow = detailPayload as JsonObject;
              invoice = normalizeInvoice(sourceRow) ?? listInvoice;
            }
          } catch {
            detailErrors += 1;
          }
        }

        invoices.push(invoice);
        items.push(...normalizeInvoiceItems(invoice, sourceRow));
      }

      await upsertRows(supabase, 'olist_invoices', invoices);
      await upsertRows(supabase, 'olist_invoice_items', items);

      totalFetched += rows.length;
      totalInvoices += invoices.length;
      totalItems += items.length;
      offset += rows.length;
      pagesProcessed += 1;
      completed = totalReported > 0 ? offset >= totalReported : rows.length < pageSize;

      await patchRun(supabase, run.id, {
        records_fetched: totalFetched,
        records_upserted: totalInvoices,
        items_upserted: totalItems,
        metadata: {
          ...(run.metadata ?? {}),
          source: 'supabase/functions/olist-sync-invoices',
          endpoint,
          page_size: pageSize,
          hydrate_details: hydrateDetails,
          total_reported: totalReported,
          next_offset: offset,
          last_page_size: rows.length,
          last_detail_errors: detailErrors,
          updated_at: new Date().toISOString()
        }
      });

      if (completed) break;
      await sleep(delayMs);
    }

    await patchRun(supabase, run.id, {
      status: completed ? 'success' : 'running',
      finished_at: completed ? new Date().toISOString() : null,
      records_fetched: totalFetched,
      records_upserted: totalInvoices,
      items_upserted: totalItems,
      error_message: null,
      metadata: {
        ...(run.metadata ?? {}),
        source: 'supabase/functions/olist-sync-invoices',
        endpoint,
        page_size: pageSize,
        hydrate_details: hydrateDetails,
        total_reported: totalReported,
        next_offset: offset,
        completed,
        updated_at: new Date().toISOString()
      }
    });

    return jsonResponse({
      ok: true,
      run_id: run.id,
      endpoint,
      window_start: startDate,
      window_end: endDate,
      pages_processed: pagesProcessed,
      next_offset: offset,
      total_reported: totalReported,
      records_fetched: totalFetched,
      invoices_upserted: totalInvoices,
      items_upserted: totalItems,
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
