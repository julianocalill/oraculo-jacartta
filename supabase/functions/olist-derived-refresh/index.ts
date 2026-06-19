import { createClient } from 'npm:@supabase/supabase-js@2';

const env = {
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  supabaseServiceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  olistSyncJobSecret: Deno.env.get('OLIST_SYNC_JOB_SECRET') ?? ''
};

type DailyRow = {
  order_date: string;
  gross_revenue: number;
  effective_revenue: number;
  orders_count: number;
  canceled_orders: number;
  units: number;
};

type ChannelRow = {
  week_start: string;
  channel_id: null;
  channel_name: string;
  gross_revenue: number;
  effective_revenue: number;
  orders_count: number;
  canceled_orders: number;
  units: number;
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

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toDateKey(value: unknown) {
  return value ? String(value).slice(0, 10) : null;
}

function toWeekStart(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function firstDayMonthsBack(monthsBack: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1)).toISOString().slice(0, 10);
}

function parseMoney(value: unknown) {
  if (value == null || value === '') return 0;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function slugify(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function chunk<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function getChannelName(payload: Record<string, unknown>) {
  const ecommerce = payload.ecommerce && typeof payload.ecommerce === 'object'
    ? payload.ecommerce as Record<string, unknown>
    : null;
  return ecommerce?.nome ? String(ecommerce.nome) : 'Sem canal';
}

function getOrderGross(order: { payload?: Record<string, unknown> }) {
  const payload = order.payload ?? {};
  const totals = payload.totais && typeof payload.totais === 'object' ? payload.totais as Record<string, unknown> : {};
  return parseMoney(
    payload.valor ??
    payload.valorTotalPedido ??
    payload.total ??
    payload.valorTotal ??
    payload.valor_total ??
    payload.totalPedido ??
    totals.total
  );
}

function finalize<T extends DailyRow | ChannelRow>(row: T) {
  const effectiveOrders = row.orders_count - row.canceled_orders;
  return {
    ...row,
    average_ticket: effectiveOrders > 0 ? row.effective_revenue / effectiveOrders : 0,
    refreshed_at: new Date().toISOString()
  };
}

async function selectAll(
  supabase: ReturnType<typeof createClient>,
  table: string,
  select: string,
  apply: (query: any) => any,
  pageSize = 1000
) {
  const rows: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const query = apply(supabase.from(table).select(select).range(from, to));
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function upsertInChunks(
  supabase: ReturnType<typeof createClient>,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  size = 200
) {
  for (const group of chunk(rows, size)) {
    const { error } = await supabase.from(table).upsert(group, { onConflict });
    if (error) throw error;
  }
}

async function syncOrderItems(supabase: ReturnType<typeof createClient>, startDate: string, endDate: string) {
  const orders = await selectAll(
    supabase,
    'olist_orders',
    'id,data_criacao,payload',
    (query) => query.gte('data_criacao', startDate).lt('data_criacao', endDate).order('data_criacao', { ascending: true })
  );

  const itemRows = orders.flatMap((order) => {
    const itens = Array.isArray(order.payload?.itens) ? order.payload.itens : [];
    return itens.map((item: Record<string, unknown>, index: number) => {
      const produto = item.produto && typeof item.produto === 'object' ? item.produto as Record<string, unknown> : {};
      const produtoId = produto.id == null ? null : String(produto.id);
      const sku = produto.sku == null ? null : String(produto.sku);
      const quantidade = Number(item.quantidade ?? 0);
      const valorUnitario = item.valorUnitario == null ? null : Number(item.valorUnitario);
      const valorTotal = Number.isFinite(quantidade) && Number.isFinite(valorUnitario) ? quantidade * valorUnitario : null;
      return {
        id: `${order.id}:${index + 1}:${produtoId || sku || 'item'}`,
        order_id: String(order.id),
        line_number: index + 1,
        produto_id: produtoId,
        sku,
        tipo: produto.tipo == null ? null : String(produto.tipo),
        descricao: produto.descricao == null ? null : String(produto.descricao),
        quantidade: Number.isFinite(quantidade) ? quantidade : 0,
        valor_unitario: Number.isFinite(valorUnitario) ? valorUnitario : null,
        valor_total: Number.isFinite(valorTotal) ? valorTotal : null,
        info_adicional: item.infoAdicional == null ? null : String(item.infoAdicional),
        order_data_criacao: order.data_criacao,
        payload: item,
        synced_at: new Date().toISOString()
      };
    });
  });

  if (itemRows.length > 0) {
    await upsertInChunks(supabase, 'olist_order_items', itemRows, 'id');
  }

  return { ordersProcessed: orders.length, itemsUpserted: itemRows.length };
}

async function syncDimensions(supabase: ReturnType<typeof createClient>, startDate: string, endDate: string) {
  const [orders, stockItems] = await Promise.all([
    selectAll(
      supabase,
      'olist_orders',
      'id,data_criacao,payload,situacao',
      (query) => query.gte('data_criacao', startDate).lt('data_criacao', endDate)
    ),
    selectAll(
      supabase,
      'olist_stock_items',
      'id,produto_id,sku,nome,saldo,reservado,disponivel,active,payload,synced_at',
      (query) => query.order('synced_at', { ascending: false })
    )
  ]);

  const channels = new Map<string, Record<string, unknown>>();
  const statusCodes = new Set<string>();

  for (const order of orders) {
    if (order.situacao != null) statusCodes.add(String(order.situacao));
    const ecommerce = order.payload?.ecommerce && typeof order.payload.ecommerce === 'object'
      ? order.payload.ecommerce as Record<string, unknown>
      : null;
    if (!ecommerce?.nome) continue;
    const sourceId = ecommerce.id == null ? null : String(ecommerce.id);
    const key = sourceId || String(ecommerce.nome);
    const existing = channels.get(key);
    channels.set(key, {
      id: `olist:${sourceId || slugify(ecommerce.nome)}`,
      source: 'olist',
      source_id: sourceId,
      source_name: String(ecommerce.nome),
      display_name: String(ecommerce.nome),
      channel_group: String(ecommerce.nome).split(' ')[0] || 'Olist',
      active: true,
      first_seen_at: existing?.first_seen_at || order.data_criacao || null,
      last_seen_at: order.data_criacao || existing?.last_seen_at || null,
      meta: ecommerce,
      synced_at: new Date().toISOString()
    });
  }

  const statuses = Array.from(statusCodes).sort().map((code) => ({
    id: `olist:${code}`,
    source: 'olist',
    code,
    label: `Status ${code}`,
    funnel_stage: code === '8' ? 'canceled' : 'unknown',
    sort_order: code === '8' ? 80 : 999,
    is_canceled: code === '8',
    is_closed: code === '8',
    meta: { source: 'olist', raw_code: code },
    synced_at: new Date().toISOString()
  }));

  const products = stockItems.map((row) => {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {};
    const categoria = payload.categoria && typeof payload.categoria === 'object' ? payload.categoria as Record<string, unknown> : {};
    const marca = payload.marca && typeof payload.marca === 'object' ? payload.marca as Record<string, unknown> : {};
    const precos = payload.precos && typeof payload.precos === 'object' ? payload.precos as Record<string, unknown> : {};
    return {
      id: String(row.produto_id || row.id),
      sku: row.sku == null ? null : String(row.sku),
      nome: row.nome == null ? null : String(row.nome),
      tipo: payload.tipo == null ? null : String(payload.tipo),
      situacao: payload.situacao == null ? null : String(payload.situacao),
      categoria_id: categoria.id == null ? null : String(categoria.id),
      categoria_nome: categoria.nome == null ? null : String(categoria.nome),
      marca_id: marca.id == null ? null : String(marca.id),
      marca_nome: marca.nome == null ? null : String(marca.nome),
      gtin: payload.gtin == null ? null : String(payload.gtin),
      preco: precos.preco == null ? null : Number(precos.preco),
      preco_promocional: precos.precoPromocional == null ? null : Number(precos.precoPromocional),
      preco_custo: precos.precoCusto == null ? null : Number(precos.precoCusto),
      preco_custo_medio: precos.precoCustoMedio == null ? null : Number(precos.precoCustoMedio),
      saldo: row.saldo == null ? null : Number(row.saldo),
      reservado: row.reservado == null ? null : Number(row.reservado),
      disponivel: row.disponivel == null ? null : Number(row.disponivel),
      active: Boolean(row.active),
      payload,
      synced_at: row.synced_at || new Date().toISOString()
    };
  });

  if (channels.size > 0) await upsertInChunks(supabase, 'dim_channels', Array.from(channels.values()), 'id');
  if (statuses.length > 0) await upsertInChunks(supabase, 'dim_order_status', statuses, 'id');
  if (products.length > 0) await upsertInChunks(supabase, 'olist_products', products, 'id');

  return { channelsUpserted: channels.size, statusesUpserted: statuses.length, productsUpserted: products.length };
}

async function snapshotStock(supabase: ReturnType<typeof createClient>, snapshotDate: string) {
  const stockItems = await selectAll(
    supabase,
    'olist_stock_items',
    'produto_id,sku,nome,saldo,reservado,disponivel,active,payload',
    (query) => query.order('id', { ascending: true })
  );

  const snapshots = stockItems.map((row) => ({
    snapshot_date: snapshotDate,
    produto_id: row.produto_id == null ? null : String(row.produto_id),
    sku: row.sku == null ? null : String(row.sku),
    nome: row.nome == null ? null : String(row.nome),
    saldo: row.saldo == null ? null : Number(row.saldo),
    reservado: row.reservado == null ? null : Number(row.reservado),
    disponivel: row.disponivel == null ? null : Number(row.disponivel),
    active: Boolean(row.active),
    payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
    created_at: new Date().toISOString()
  }));

  if (snapshots.length > 0) {
    await upsertInChunks(supabase, 'olist_stock_snapshots', snapshots, 'snapshot_date,produto_id');
  }

  return { snapshotsUpserted: snapshots.length };
}

async function refreshSalesCaches(supabase: ReturnType<typeof createClient>, startDate: string, endDate: string) {
  const daily = new Map<string, DailyRow>();
  const channels = new Map<string, ChannelRow>();

  const [orders, items] = await Promise.all([
    selectAll(
      supabase,
      'olist_orders',
      'id,data_criacao,situacao,payload',
      (query) => query.gte('data_criacao', startDate).lt('data_criacao', endDate).order('data_criacao', { ascending: true })
    ),
    selectAll(
      supabase,
      'olist_order_items',
      'order_id,quantidade,order_data_criacao',
      (query) => query.gte('order_data_criacao', startDate).lt('order_data_criacao', endDate)
    )
  ]);

  const orderMeta = new Map<string, { orderDate: string; channelName: string }>();
  for (const order of orders) {
    const orderDate = toDateKey(order.data_criacao);
    if (!orderDate) continue;
    const payload = order.payload && typeof order.payload === 'object' ? order.payload as Record<string, unknown> : {};
    const isCanceled = String(order.situacao) === '8';
    const gross = getOrderGross({ payload });
    const channelName = getChannelName(payload);
    const weekStart = toWeekStart(orderDate);
    orderMeta.set(String(order.id), { orderDate, channelName });

    if (!daily.has(orderDate)) {
      daily.set(orderDate, { order_date: orderDate, gross_revenue: 0, effective_revenue: 0, orders_count: 0, canceled_orders: 0, units: 0 });
    }
    const dailyRow = daily.get(orderDate)!;
    dailyRow.gross_revenue += gross;
    dailyRow.effective_revenue += isCanceled ? 0 : gross;
    dailyRow.orders_count += 1;
    dailyRow.canceled_orders += isCanceled ? 1 : 0;

    const channelKey = `${weekStart}:${channelName}`;
    if (!channels.has(channelKey)) {
      channels.set(channelKey, { week_start: weekStart, channel_id: null, channel_name: channelName, gross_revenue: 0, effective_revenue: 0, orders_count: 0, canceled_orders: 0, units: 0 });
    }
    const channelRow = channels.get(channelKey)!;
    channelRow.gross_revenue += gross;
    channelRow.effective_revenue += isCanceled ? 0 : gross;
    channelRow.orders_count += 1;
    channelRow.canceled_orders += isCanceled ? 1 : 0;
  }

  for (const item of items) {
    const meta = orderMeta.get(String(item.order_id));
    const orderDate = meta?.orderDate ?? toDateKey(item.order_data_criacao);
    if (!orderDate) continue;
    const quantity = Number(item.quantidade ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    if (!daily.has(orderDate)) {
      daily.set(orderDate, { order_date: orderDate, gross_revenue: 0, effective_revenue: 0, orders_count: 0, canceled_orders: 0, units: 0 });
    }
    daily.get(orderDate)!.units += quantity;

    const channelName = meta?.channelName ?? 'Sem canal';
    const channelKey = `${toWeekStart(orderDate)}:${channelName}`;
    if (!channels.has(channelKey)) {
      channels.set(channelKey, { week_start: toWeekStart(orderDate), channel_id: null, channel_name: channelName, gross_revenue: 0, effective_revenue: 0, orders_count: 0, canceled_orders: 0, units: 0 });
    }
    channels.get(channelKey)!.units += quantity;
  }

  await supabase.from('oraculo_daily_sales_cache').delete().gte('order_date', startDate).lt('order_date', endDate);
  await supabase.from('oraculo_channel_sales_cache').delete().gte('week_start', toWeekStart(startDate));

  const dailyRows = Array.from(daily.values()).map(finalize);
  const channelRows = Array.from(channels.values()).map(finalize);
  if (dailyRows.length > 0) await upsertInChunks(supabase, 'oraculo_daily_sales_cache', dailyRows, 'order_date');
  if (channelRows.length > 0) await upsertInChunks(supabase, 'oraculo_channel_sales_cache', channelRows, 'week_start,channel_name');

  return { dailyRows: dailyRows.length, channelRows: channelRows.length };
}

async function refreshNfCache(supabase: ReturnType<typeof createClient>, startDate: string, endDate: string) {
  const { error } = await supabase.rpc('refresh_oraculo_nf_daily_cache', {
    start_date: startDate,
    end_date: endDate
  });

  if (error) throw error;
  return { refreshed: true };
}

async function refreshUnifiedSkuCache(supabase: ReturnType<typeof createClient>) {
  const { error } = await supabase.rpc('refresh_oraculo_unified_sku_cache');
  if (error) throw error;
  return { refreshed: true };
}

Deno.serve(async (req) => {
  try {
    requireValue('SUPABASE_URL', env.supabaseUrl);
    requireValue('SUPABASE_SERVICE_ROLE_KEY', env.supabaseServiceRoleKey);
    requireValue('OLIST_SYNC_JOB_SECRET', env.olistSyncJobSecret);

    if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    if (req.headers.get('x-sync-secret') !== env.olistSyncJobSecret) return jsonResponse({ error: 'Unauthorized' }, 401);

    const body = req.headers.get('content-type')?.includes('application/json')
      ? await req.json().catch(() => ({}))
      : {};
    const monthsBack = Number.isFinite(Number(body.monthsBack)) ? Number(body.monthsBack) : 1;
    const startDate = typeof body.startDate === 'string' ? body.startDate : firstDayMonthsBack(monthsBack);
    const endDate = typeof body.endDate === 'string' ? body.endDate : addDays(new Date().toISOString().slice(0, 10), 1);
    const snapshotDate = new Date().toISOString().slice(0, 10);

    const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const orderItems = await syncOrderItems(supabase, startDate, endDate);
    const dimensions = await syncDimensions(supabase, startDate, endDate);
    const stockSnapshot = await snapshotStock(supabase, snapshotDate);
    const salesCaches = await refreshSalesCaches(supabase, startDate, endDate);
    const nfCache = await refreshNfCache(supabase, startDate, endDate);
    const unifiedSkuCache = await refreshUnifiedSkuCache(supabase);

    return jsonResponse({ ok: true, startDate, endDate, orderItems, dimensions, stockSnapshot, salesCaches, nfCache, unifiedSkuCache });
  } catch (error) {
    console.error(error);
    return jsonResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
