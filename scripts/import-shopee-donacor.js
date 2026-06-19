#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const N8N_ENV_PATH = "/Users/julianocalil/espacodebicho-integracoes/.env";
const SHOPEE_SHOP_ID = 1227023039;
const POSTGRES_CREDENTIAL_ID = "lsiqvd6vDTqqhOFJ";
const POSTGRES_CREDENTIAL_NAME = "Postgres account";
const PRODUCTS_WORKFLOW_NAME = "codex - exportar produtos Donacor Shopee";
const PRODUCTS_WEBHOOK_PATH = "codex-donacor-shopee-products";
const ORDERS_WORKFLOW_NAME = "codex - exportar pedidos Donacor Shopee";
const ORDERS_WEBHOOK_PATH = "codex-donacor-shopee-orders";

function parseEnvFile(filePath) {
  const env = {};
  const file = readFileSync(filePath, "utf8");

  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index === -1) continue;

    env[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
  }

  return env;
}

function loadEnv() {
  return parseEnvFile(join(process.cwd(), ".env"));
}

function loadN8nEnv() {
  return parseEnvFile(N8N_ENV_PATH);
}

function requireEnv(env, key) {
  const value = env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function cliOption(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function formatDateInput(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Data invalida para ${value}. Use YYYY-MM-DD.`);
  }
  return value;
}

function toShopeeTimestamp(date, endOfDay = false) {
  const suffix = endOfDay ? "T23:59:59-03:00" : "T00:00:00-03:00";
  return Math.floor(new Date(`${date}${suffix}`).getTime() / 1000);
}

function addDays(date, days) {
  const next = new Date(`${date}T00:00:00-03:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function buildDateWindows(startDate, endDate, maxDaysPerWindow = 14) {
  const windows = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    const tentativeEnd = addDays(cursor, maxDaysPerWindow - 1);
    const windowEnd = tentativeEnd > endDate ? endDate : tentativeEnd;
    windows.push({
      startDate: cursor,
      endDate: windowEnd,
      timeFrom: toShopeeTimestamp(cursor, false),
      timeTo: toShopeeTimestamp(windowEnd, true)
    });
    cursor = addDays(windowEnd, 1);
  }

  return windows;
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function dedupeById(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return [...map.values()];
}

function toSyncMeta(baseMeta, progress) {
  return {
    ...baseMeta,
    windows_processed: progress.processedWindows,
    pages_processed: progress.pages,
    fetched_orders_so_far: progress.fetchedOrders,
    upserted_orders_so_far: progress.upsertedOrders,
    upserted_items_so_far: progress.upsertedItems
  };
}

function parseJson(text, context) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context}: resposta nao veio em JSON`);
  }
}

function toIso(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric * 1000).toISOString();
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function n8nRequest(n8nEnv, path, options = {}) {
  const baseUrl = requireEnv(n8nEnv, "N8N_BASE_URL").replace(/\/+$/, "");
  const apiKey = requireEnv(n8nEnv, "N8N_API_KEY");
  const url = new URL(path, `${baseUrl}/`);
  const response = await fetch(url, {
    ...options,
    headers: {
      "X-N8N-API-KEY": apiKey,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`n8n ${options.method || "GET"} ${path} falhou (${response.status}): ${text.slice(0, 400)}`);
  }

  return data;
}

async function findWorkflowByName(n8nEnv, name) {
  let cursor;

  do {
    const query = cursor ? `/api/v1/workflows?cursor=${encodeURIComponent(cursor)}` : "/api/v1/workflows";
    const data = await n8nRequest(n8nEnv, query);
    const found = (data.data || []).find((workflow) => workflow.name === name);
    if (found) return found;
    cursor = data.nextCursor;
  } while (cursor);

  return null;
}

async function ensureProductsWorkflow(n8nEnv) {
  const workflow = {
    name: PRODUCTS_WORKFLOW_NAME,
    nodes: [
      {
        id: "products-webhook",
        name: "Webhook exportar produtos Donacor",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [-720, 0],
        parameters: { httpMethod: "GET", path: PRODUCTS_WEBHOOK_PATH, responseMode: "lastNode", options: {} }
      },
      {
        id: "products-token",
        name: "Buscar token atual Donacor",
        type: "n8n-nodes-base.postgres",
        typeVersion: 2.6,
        position: [-480, 0],
        credentials: { postgres: { id: POSTGRES_CREDENTIAL_ID, name: POSTGRES_CREDENTIAL_NAME } },
        parameters: {
          operation: "executeQuery",
          query: `SELECT
  t.shop_id,
  t.partner_id,
  t.access_token,
  t.access_token_expires_at
FROM shopee_tokens t
JOIN shopee_shops s ON s.shop_id = t.shop_id
WHERE t.shop_id = ${SHOPEE_SHOP_ID}
  AND COALESCE(s.is_active, TRUE) = TRUE
  AND t.access_token IS NOT NULL
  AND t.access_token_expires_at > NOW()
ORDER BY t.updated_at DESC
LIMIT 1;`,
          options: {}
        }
      },
      {
        id: "products-code",
        name: "Consultar catalogo Shopee",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [-240, 0],
        parameters: {
          jsCode: `const crypto = require('crypto');
const partnerKey = $env.SHOPEE_PARTNER_KEY;
if (!partnerKey) throw new Error('SHOPEE_PARTNER_KEY nao encontrada no ambiente do n8n.');
const token = $input.first().json;
if (!token?.shop_id || !token?.partner_id || !token?.access_token) {
  throw new Error('Nenhum access_token valido encontrado para Donacor.');
}
const baseUrl = 'https://partner.shopeemobile.com';
const errors = [];
function signUrl(apiPath, params = {}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const partnerId = String(token.partner_id);
  const shopId = String(token.shop_id);
  const accessToken = String(token.access_token);
  const sign = crypto.createHmac('sha256', partnerKey).update(partnerId + apiPath + timestamp + accessToken + shopId).digest('hex');
  const url = new URL(baseUrl + apiPath);
  for (const [key, value] of Object.entries({ partner_id: partnerId, timestamp, sign, shop_id: shopId, access_token: accessToken, ...params })) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}
async function fetchJson(apiPath, params, label) {
  const response = await fetch(signUrl(apiPath, params));
  const data = await response.json();
  if (data.error) {
    const error = { label, error: data.error, message: data.message || null };
    errors.push(error);
    throw new Error(JSON.stringify(error));
  }
  return data.response || data;
}
function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
async function getItemList() {
  const byId = new Map();
  let offset = 0;
  let hasNext = true;
  let pagesRead = 0;
  while (hasNext && pagesRead < 500) {
    const response = await fetchJson('/api/v2/product/get_item_list', {
      item_status: 'NORMAL',
      page_size: 100,
      offset
    }, 'get_item_list:NORMAL');
    const list = response.item || response.item_list || [];
    for (const item of list) if (item?.item_id) byId.set(String(item.item_id), { ...item, listed_status: 'NORMAL' });
    hasNext = Boolean(response.has_next_page);
    offset = Number(response.next_offset ?? offset + list.length);
    pagesRead += 1;
    if (list.length === 0 && hasNext) break;
  }
  return [...byId.values()];
}
async function getBaseInfo(itemIds) {
  const byId = new Map();
  for (const group of chunks(itemIds, 50)) {
    const response = await fetchJson('/api/v2/product/get_item_base_info', {
      item_id_list: group.join(','),
      response_optional_fields: 'item_name,description,item_sku,create_time,update_time,price_info,stock_info,image,weight,category_id,brand'
    }, 'get_item_base_info');
    for (const item of response.item_list || []) if (item?.item_id) byId.set(String(item.item_id), item);
  }
  return byId;
}
async function getModelInfo(itemIds) {
  const byItemId = new Map();
  for (const itemId of itemIds) {
    try {
      const response = await fetchJson('/api/v2/product/get_model_list', { item_id: itemId }, 'get_model_list:' + itemId);
      byItemId.set(String(itemId), response.model || response.model_list || []);
    } catch (_) {
      byItemId.set(String(itemId), []);
    }
  }
  return byItemId;
}
function firstPrice(priceInfo) {
  const first = Array.isArray(priceInfo) ? priceInfo[0] : priceInfo;
  return first || {};
}
function totalStock(stockInfo) {
  if (Array.isArray(stockInfo)) return stockInfo.reduce((sum, entry) => sum + Number(entry.current_stock ?? entry.normal_stock ?? entry.stock ?? 0), 0);
  return Number(stockInfo?.current_stock ?? stockInfo?.normal_stock ?? stockInfo?.stock ?? 0);
}
function modelStock(model) {
  const stocks = model?.stock_info_v2?.seller_stock || model?.stock_info || [];
  if (Array.isArray(stocks)) return stocks.reduce((sum, entry) => sum + Number(entry.stock ?? entry.current_stock ?? 0), 0);
  return Number(stocks?.stock ?? stocks?.current_stock ?? 0);
}
const listedItems = await getItemList();
const itemIds = listedItems.map((item) => String(item.item_id));
const baseInfoById = await getBaseInfo(itemIds);
const modelInfoById = await getModelInfo(itemIds);
const products = [];
for (const listed of listedItems) {
  const base = baseInfoById.get(String(listed.item_id)) || listed;
  const models = modelInfoById.get(String(listed.item_id)) || [];
  const price = firstPrice(base.price_info);
  const brand = base.brand || {};
  const image = Array.isArray(base.image?.image_url_list) ? base.image.image_url_list[0] : null;
  const productBase = {
    shop_id: Number(token.shop_id),
    item_id: String(base.item_id || listed.item_id),
    item_name: base.item_name || base.name || '',
    item_sku: base.item_sku || '',
    item_status: base.item_status || listed.item_status || listed.listed_status || '',
    category_id: base.category_id || '',
    brand_name: brand.brand_name || brand.original_brand_name || '',
    price_min: price.original_price ?? price.current_price ?? price.price ?? '',
    price_max: price.original_price ?? price.current_price ?? price.price ?? '',
    stock_total: totalStock(base.stock_info),
    weight: base.weight || '',
    create_time: base.create_time || '',
    update_time: base.update_time || '',
    image_url: image || '',
    raw_json: base
  };
  if (models.length === 0) {
    products.push({ ...productBase, model_id: '', model_name: '', model_sku: '', model_status: '', model_stock: '', model_price: '' });
    continue;
  }
  for (const model of models) {
    products.push({
      ...productBase,
      model_id: model.model_id || '',
      model_name: model.model_name || '',
      model_sku: model.model_sku || '',
      model_status: model.model_status || '',
      model_stock: modelStock(model),
      model_price: model.price_info?.current_price ?? model.price_info?.original_price ?? ''
    });
  }
}
return [{ json: { ok: true, source: 'Shopee product APIs', shop_id: Number(token.shop_id), item_count: itemIds.length, row_count: products.length, products, errors } }];`
        }
      }
    ],
    connections: {
      "Webhook exportar produtos Donacor": { main: [[{ node: "Buscar token atual Donacor", type: "main", index: 0 }]] },
      "Buscar token atual Donacor": { main: [[{ node: "Consultar catalogo Shopee", type: "main", index: 0 }]] }
    },
    settings: { executionOrder: "v1" }
  };

  const existing = await findWorkflowByName(n8nEnv, PRODUCTS_WORKFLOW_NAME);
  if (existing) {
    await n8nRequest(n8nEnv, `/api/v1/workflows/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings
      })
    });
    if (!existing.active) {
      await n8nRequest(n8nEnv, `/api/v1/workflows/${existing.id}/activate`, { method: "POST", body: "{}" });
    }
    return existing.id;
  }

  const created = await n8nRequest(n8nEnv, "/api/v1/workflows", { method: "POST", body: JSON.stringify(workflow) });
  await n8nRequest(n8nEnv, `/api/v1/workflows/${created.id}/activate`, { method: "POST", body: "{}" });
  return created.id;
}

async function ensureOrdersWorkflow(n8nEnv) {
  const workflow = {
    name: ORDERS_WORKFLOW_NAME,
    nodes: [
      {
        id: "orders-webhook",
        name: "Webhook exportar pedidos Donacor",
        type: "n8n-nodes-base.webhook",
        typeVersion: 2,
        position: [-720, 0],
        parameters: { httpMethod: "POST", path: ORDERS_WEBHOOK_PATH, responseMode: "lastNode", options: {} }
      },
      {
        id: "orders-token",
        name: "Buscar token atual Donacor",
        type: "n8n-nodes-base.postgres",
        typeVersion: 2.6,
        position: [-480, 0],
        credentials: { postgres: { id: POSTGRES_CREDENTIAL_ID, name: POSTGRES_CREDENTIAL_NAME } },
        parameters: {
          operation: "executeQuery",
          query: `SELECT
  t.shop_id,
  t.partner_id,
  t.access_token,
  t.access_token_expires_at
FROM shopee_tokens t
JOIN shopee_shops s ON s.shop_id = t.shop_id
WHERE t.shop_id = ${SHOPEE_SHOP_ID}
  AND COALESCE(s.is_active, TRUE) = TRUE
  AND t.access_token IS NOT NULL
  AND t.access_token_expires_at > NOW()
ORDER BY t.updated_at DESC
LIMIT 1;`,
          options: {}
        }
      },
      {
        id: "orders-code",
        name: "Consultar pedidos Shopee",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        position: [-240, 0],
        parameters: {
          jsCode: `const crypto = require('crypto');
const partnerKey = $env.SHOPEE_PARTNER_KEY;
if (!partnerKey) throw new Error('SHOPEE_PARTNER_KEY nao encontrada no ambiente do n8n.');
const token = $input.first().json;
if (!token?.shop_id || !token?.partner_id || !token?.access_token) {
  throw new Error('Nenhum access_token valido encontrado para Donacor.');
}
const webhook = $('Webhook exportar pedidos Donacor').first().json || {};
const payload = webhook.body || webhook.query || webhook || {};
const timeFrom = Number(payload.time_from || 0);
const timeTo = Number(payload.time_to || 0);
const cursor = String(payload.cursor || '');
const pageSize = Math.max(1, Math.min(100, Number(payload.page_size || 100)));
const timeRangeField = payload.time_range_field || 'create_time';
if (!timeFrom || !timeTo) throw new Error('Envie time_from e time_to em epoch seconds.');
const baseUrl = 'https://partner.shopeemobile.com';
function signUrl(apiPath, params = {}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const partnerId = String(token.partner_id);
  const shopId = String(token.shop_id);
  const accessToken = String(token.access_token);
  const sign = crypto.createHmac('sha256', partnerKey).update(partnerId + apiPath + timestamp + accessToken + shopId).digest('hex');
  const query = Object.entries({ partner_id: partnerId, timestamp, sign, shop_id: shopId, access_token: accessToken, ...params })
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
    .join('&');
  return baseUrl + apiPath + '?' + query;
}
async function fetchJson(apiPath, params) {
  const data = await this.helpers.httpRequest({
    method: 'GET',
    url: signUrl(apiPath, params),
    json: true
  });
  if (data.error) throw new Error(JSON.stringify({ path: apiPath, error: data.error, message: data.message || null }));
  return data.response || data;
}
function chunks(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
const listResponse = await fetchJson('/api/v2/order/get_order_list', {
  time_range_field: timeRangeField,
  time_from: String(timeFrom),
  time_to: String(timeTo),
  page_size: String(pageSize),
  cursor
});
const orderList = Array.isArray(listResponse.order_list) ? listResponse.order_list : [];
const detailMap = new Map();
for (const group of chunks(orderList.map((order) => order.order_sn).filter(Boolean), 50)) {
  const detail = await fetchJson('/api/v2/order/get_order_detail', {
    order_sn_list: group.join(','),
    response_optional_fields: 'buyer_user_id,buyer_username,recipient_address,item_list,payment_method,total_amount,invoice_data,actual_shipping_fee,estimated_shipping_fee,order_status,create_time,update_time,pay_time,package_list,note,days_to_ship'
  });
  for (const order of detail.order_list || []) {
    if (order?.order_sn) detailMap.set(String(order.order_sn), order);
  }
}
const orders = orderList.map((summary) => {
  const orderSn = String(summary.order_sn || '');
  const detail = detailMap.get(orderSn) || {};
  return { ...summary, ...detail, order_sn: orderSn, shop_id: Number(token.shop_id) };
});
return [{
  json: {
    ok: true,
    shop_id: Number(token.shop_id),
    time_from: timeFrom,
    time_to: timeTo,
    page_size: pageSize,
    cursor,
    next_cursor: listResponse.next_cursor || '',
    more: Boolean(listResponse.more),
    orders_count: orders.length,
    orders
  }
}];`
        }
      }
    ],
    connections: {
      "Webhook exportar pedidos Donacor": { main: [[{ node: "Buscar token atual Donacor", type: "main", index: 0 }]] },
      "Buscar token atual Donacor": { main: [[{ node: "Consultar pedidos Shopee", type: "main", index: 0 }]] }
    },
    settings: { executionOrder: "v1" }
  };

  const existing = await findWorkflowByName(n8nEnv, ORDERS_WORKFLOW_NAME);
  if (existing) {
    await n8nRequest(n8nEnv, `/api/v1/workflows/${existing.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: workflow.name,
        nodes: workflow.nodes,
        connections: workflow.connections,
        settings: workflow.settings
      })
    });
    if (!existing.active) {
      await n8nRequest(n8nEnv, `/api/v1/workflows/${existing.id}/activate`, { method: "POST", body: "{}" });
    }
    return existing.id;
  }

  const created = await n8nRequest(n8nEnv, "/api/v1/workflows", { method: "POST", body: JSON.stringify(workflow) });
  await n8nRequest(n8nEnv, `/api/v1/workflows/${created.id}/activate`, { method: "POST", body: "{}" });
  return created.id;
}

async function supabaseFetch(env, path, options = {}) {
  const url = new URL(path, env.SUPABASE_URL.endsWith("/") ? env.SUPABASE_URL : `${env.SUPABASE_URL}/`);
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  return { response, text: await response.text() };
}

async function upsertRows(env, table, rows) {
  let upserted = 0;
  for (const group of chunk(rows, 200)) {
    const { response, text } = await supabaseFetch(env, `rest/v1/${table}?on_conflict=id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(group)
    });
    if (!response.ok) {
      throw new Error(`Falha ao gravar ${table} (${response.status}): ${text.slice(0, 400)}`);
    }
    upserted += group.length;
  }
  return upserted;
}

function normalizeProductRow(row) {
  const modelId = row.model_id ? String(row.model_id) : "";
  const itemId = String(row.item_id);
  return {
    id: `${row.shop_id}:${itemId}:${modelId || "base"}`,
    shop_id: Number(row.shop_id),
    item_id: itemId,
    model_id: modelId || null,
    item_name: row.item_name || null,
    item_sku: row.item_sku || null,
    item_status: row.item_status || null,
    category_id: row.category_id ? String(row.category_id) : null,
    brand_name: row.brand_name || null,
    price_min: asNumber(row.price_min),
    price_max: asNumber(row.price_max),
    stock_total: asNumber(row.stock_total),
    weight: asNumber(row.weight),
    create_time: toIso(row.create_time),
    update_time: toIso(row.update_time),
    image_url: row.image_url || null,
    model_name: row.model_name || null,
    model_sku: row.model_sku || null,
    model_status: row.model_status || null,
    model_stock: asNumber(row.model_stock),
    model_price: asNumber(row.model_price),
    raw_json: row.raw_json || row,
    synced_at: new Date().toISOString()
  };
}

function normalizeOrderRow(order) {
  const recipient = order.recipient_address || {};
  return {
    id: `${order.shop_id}:${order.order_sn}`,
    shop_id: Number(order.shop_id),
    shop_name: "Donacor Shopee",
    order_sn: String(order.order_sn),
    order_status: order.order_status || null,
    create_time: toIso(order.create_time),
    update_time: toIso(order.update_time),
    pay_time: toIso(order.pay_time),
    total_amount: asNumber(order.total_amount),
    estimated_shipping_fee: asNumber(order.estimated_shipping_fee),
    actual_shipping_fee: asNumber(order.actual_shipping_fee),
    currency: order.currency || null,
    buyer_user_id: order.buyer_user_id == null ? null : String(order.buyer_user_id),
    buyer_username: order.buyer_username || null,
    recipient_name: recipient.name || null,
    recipient_phone: recipient.phone || null,
    recipient_city: recipient.city || null,
    recipient_state: recipient.state || null,
    days_to_ship: Number.isFinite(Number(order.days_to_ship)) ? Number(order.days_to_ship) : null,
    note: order.note || null,
    raw_json: order,
    synced_at: new Date().toISOString()
  };
}

function normalizeOrderItems(order) {
  const items = Array.isArray(order.item_list) ? order.item_list : [];
  return items.map((item, index) => {
    const itemId = item.item_id == null ? "" : String(item.item_id);
    const modelId = item.model_id == null ? "" : String(item.model_id);
    return {
      id: `${order.shop_id}:${order.order_sn}:${itemId || "item"}:${modelId || index + 1}`,
      order_id: `${order.shop_id}:${order.order_sn}`,
      shop_id: Number(order.shop_id),
      order_sn: String(order.order_sn),
      item_id: itemId || null,
      item_name: item.item_name || null,
      model_id: modelId || null,
      model_name: item.model_name || null,
      sku: item.model_sku || item.item_sku || item.sku || null,
      quantity: Number(item.model_quantity_purchased ?? item.quantity_purchased ?? item.quantity ?? 0) || 0,
      raw_json: item,
      synced_at: new Date().toISOString()
    };
  });
}

async function invokeProductsWebhook(n8nEnv) {
  const webhookUrl = `${requireEnv(n8nEnv, "N8N_BASE_URL").replace(/\/+$/, "")}/webhook/${PRODUCTS_WEBHOOK_PATH}`;
  const response = await fetch(webhookUrl);
  const text = await response.text();
  if (!response.ok) throw new Error(`Webhook de produtos falhou (${response.status}): ${text.slice(0, 400)}`);
  const data = parseJson(text, "Falha ao consultar produtos Shopee");
  return Array.isArray(data) ? (data[0] || {}) : data;
}

async function invokeOrdersWebhook(n8nEnv, payload) {
  const webhookUrl = `${requireEnv(n8nEnv, "N8N_BASE_URL").replace(/\/+$/, "")}/webhook/${ORDERS_WEBHOOK_PATH}`;
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Webhook de pedidos falhou (${response.status}): ${text.slice(0, 400)}`);
  const data = parseJson(text, "Falha ao consultar pedidos Shopee");
  return Array.isArray(data) ? (data[0] || {}) : data;
}

async function logRun(env, payload) {
  const { response, text } = await supabaseFetch(env, "rest/v1/shopee_sync_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Falha ao criar shopee_sync_runs (${response.status}): ${text.slice(0, 300)}`);
  const data = parseJson(text, "Falha ao criar shopee_sync_runs");
  return data[0];
}

async function patchRun(env, id, payload) {
  const { response, text } = await supabaseFetch(env, `rest/v1/shopee_sync_runs?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Falha ao atualizar shopee_sync_runs (${response.status}): ${text.slice(0, 300)}`);
}

async function refreshUnifiedSkuCache(env) {
  const { response, text } = await supabaseFetch(env, "rest/v1/rpc/refresh_oraculo_unified_sku_cache", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: "{}"
  });
  if (!response.ok) {
    throw new Error(`Falha ao atualizar cache unificado (${response.status}): ${text.slice(0, 300)}`);
  }
  return parseJson(text, "Falha ao atualizar cache unificado");
}

async function main() {
  const env = loadEnv();
  const n8nEnv = loadN8nEnv();

  requireEnv(env, "SUPABASE_URL");
  requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  requireEnv(n8nEnv, "N8N_BASE_URL");
  requireEnv(n8nEnv, "N8N_API_KEY");

  const startDate = formatDateInput(cliOption("start", "2026-06-01"));
  const endDate = formatDateInput(cliOption("end", new Date().toISOString().slice(0, 10)));
  const windows = buildDateWindows(startDate, endDate);

  await ensureProductsWorkflow(n8nEnv);
  await ensureOrdersWorkflow(n8nEnv);

  const productsRun = await logRun(env, {
    source: "shopee_products",
    status: "running",
    meta: { shop_id: SHOPEE_SHOP_ID }
  });

  let upsertedProducts = 0;
  try {
    const productResult = await invokeProductsWebhook(n8nEnv);
    const productRows = (productResult.products || []).map(normalizeProductRow);
    upsertedProducts = await upsertRows(env, "shopee_products", productRows);

    await patchRun(env, productsRun.id, {
      finished_at: new Date().toISOString(),
      status: "success",
      records_fetched: productRows.length,
      records_upserted: upsertedProducts,
      meta: { shop_id: SHOPEE_SHOP_ID, item_count: productResult.item_count || 0 }
    });

  } catch (error) {
    await patchRun(env, productsRun.id, {
      finished_at: new Date().toISOString(),
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  const ordersRun = await logRun(env, {
    source: "shopee_orders",
    status: "running",
    meta: { shop_id: SHOPEE_SHOP_ID, start_date: startDate, end_date: endDate }
  });

  let pages = 0;
  let processedWindows = 0;
  let fetchedOrders = 0;
  let upsertedOrders = 0;
  let upsertedItems = 0;
  const ordersRunMeta = {
    shop_id: SHOPEE_SHOP_ID,
    start_date: startDate,
    end_date: endDate
  };

  try {
    for (const window of windows) {
      let cursor = "";
      do {
        const result = await invokeOrdersWebhook(n8nEnv, {
          time_from: window.timeFrom,
          time_to: window.timeTo,
          page_size: 100,
          cursor,
          time_range_field: "create_time"
        });

        const orders = result.orders || [];
        const orderRows = dedupeById(orders.map(normalizeOrderRow));
        const itemRows = dedupeById(orders.flatMap(normalizeOrderItems));

        if (orderRows.length > 0) upsertedOrders += await upsertRows(env, "shopee_orders", orderRows);
        if (itemRows.length > 0) upsertedItems += await upsertRows(env, "shopee_order_items", itemRows);

        fetchedOrders += orders.length;
        pages += 1;
        await patchRun(env, ordersRun.id, {
          records_fetched: fetchedOrders,
          records_upserted: upsertedOrders + upsertedItems,
          meta: toSyncMeta(ordersRunMeta, {
            processedWindows,
            pages,
            fetchedOrders,
            upsertedOrders,
            upsertedItems
          })
        });
        cursor = result.more ? String(result.next_cursor || "") : "";
      } while (cursor);

      processedWindows += 1;
      await patchRun(env, ordersRun.id, {
        records_fetched: fetchedOrders,
        records_upserted: upsertedOrders + upsertedItems,
        meta: toSyncMeta(ordersRunMeta, {
          processedWindows,
          pages,
          fetchedOrders,
          upsertedOrders,
          upsertedItems
        })
      });
    }

    await patchRun(env, ordersRun.id, {
      finished_at: new Date().toISOString(),
      status: "success",
      records_fetched: fetchedOrders,
      records_upserted: upsertedOrders + upsertedItems,
      meta: {
        ...toSyncMeta(ordersRunMeta, {
          processedWindows,
          pages,
          fetchedOrders,
          upsertedOrders,
          upsertedItems
        }),
        windows: processedWindows,
        pages
      }
    });

    await refreshUnifiedSkuCache(env);

    console.log(JSON.stringify({
      ok: true,
      shop_id: SHOPEE_SHOP_ID,
      period: { start_date: startDate, end_date: endDate },
      products_upserted: upsertedProducts,
      orders_fetched: fetchedOrders,
      orders_upserted: upsertedOrders,
      order_items_upserted: upsertedItems,
      windows: processedWindows,
      pages
    }, null, 2));
  } catch (error) {
    await patchRun(env, ordersRun.id, {
      finished_at: new Date().toISOString(),
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
