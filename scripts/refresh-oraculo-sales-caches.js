#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function loadEnv() {
  const file = readFileSync(join(process.cwd(), ".env"), "utf8");
  const env = {};

  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }

  return env;
}

function requireEnv(env, key) {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function parseMoney(value) {
  if (value == null || value === "") return 0;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function toDateKey(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

function toWeekStart(dateKey) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diffToMonday);
  return date.toISOString().slice(0, 10);
}

function getChannelName(payload) {
  const ecommerce = payload && typeof payload.ecommerce === "object" ? payload.ecommerce : null;
  return ecommerce?.nome ? String(ecommerce.nome) : "Sem canal";
}

function getIsCanceled(order) {
  return String(order.situacao) === "8";
}

function getOrderGross(order) {
  return parseMoney(
    order?.payload?.valor ??
    order?.payload?.valorTotalPedido ??
    order?.payload?.total ??
    order?.payload?.valorTotal ??
    order?.payload?.valor_total ??
    order?.payload?.totalPedido ??
    order?.payload?.totais?.total
  );
}

async function listOrderItemsForDay(env, limit, offset, dateKey) {
  const filters = [
    "select=order_id,quantidade,valor_unitario,valor_total,order_data_criacao",
    "order=order_data_criacao.asc,order_id.asc",
    `limit=${limit}`,
    `offset=${offset}`,
    `order_data_criacao=gte.${dateKey}`,
    `order_data_criacao=lt.${addDays(dateKey, 1)}`
  ];

  const { response, text } = await supabaseFetch(env, `rest/v1/olist_order_items?${filters.join("&")}`);
  if (!response.ok) {
    throw new Error(`Falha ao listar itens (${response.status}): ${text.slice(0, 300)}`);
  }

  return parseJson(text, "Falha ao listar itens");
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

function parseJson(text, context) {
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context}: resposta nao veio em JSON`);
  }
}

async function listOrders(env, limit, offset, startDate, endDate) {
  const filters = [
    "select=id,data_criacao,situacao,payload",
    "order=data_criacao.asc,id.asc",
    `limit=${limit}`,
    `offset=${offset}`
  ];

  if (startDate) filters.push(`data_criacao=gte.${startDate}`);
  if (endDate) filters.push(`data_criacao=lt.${endDate}`);

  const { response, text } = await supabaseFetch(env, `rest/v1/olist_orders?${filters.join("&")}`);
  if (!response.ok) {
    throw new Error(`Falha ao listar pedidos (${response.status}): ${text.slice(0, 300)}`);
  }

  return parseJson(text, "Falha ao listar pedidos");
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function listOrdersForDay(env, limit, offset, dateKey) {
  return listOrders(env, limit, offset, dateKey, addDays(dateKey, 1));
}

async function replaceRows(env, table, rows) {
  const deleteResponse = await supabaseFetch(env, `rest/v1/${table}?refreshed_at=not.is.null`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });

  if (!deleteResponse.response.ok) {
    throw new Error(`Falha ao limpar ${table} (${deleteResponse.response.status}): ${deleteResponse.text.slice(0, 300)}`);
  }

  for (const group of chunk(rows, 200)) {
    const { response, text } = await supabaseFetch(env, `rest/v1/${table}`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(group)
    });

    if (!response.ok) {
      throw new Error(`Falha ao gravar ${table} (${response.status}): ${text.slice(0, 300)}`);
    }
  }
}

function finalize(row) {
  const effectiveOrders = row.orders_count - row.canceled_orders;
  return {
    ...row,
    average_ticket: effectiveOrders > 0 ? row.effective_revenue / effectiveOrders : 0,
    refreshed_at: new Date().toISOString()
  };
}

async function main() {
  const env = loadEnv();
  requireEnv(env, "SUPABASE_URL");
  requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const startDate = process.env.SALES_CACHE_START_DATE || "2026-04-01";
  const endDate = process.env.SALES_CACHE_END_DATE || addDays(new Date().toISOString().slice(0, 10), 1);
  const pageSize = Number(process.env.SALES_CACHE_PAGE_SIZE || "1000");

  const daily = new Map();
  const channels = new Map();
  const orderMeta = new Map();
  let ordersProcessed = 0;
  let itemsProcessed = 0;
  let currentDate = startDate;

  while (currentDate < endDate) {
    let offset = 0;

    while (true) {
      const orders = await listOrdersForDay(env, pageSize, offset, currentDate);
      if (orders.length === 0) break;

      for (const order of orders) {
        const orderDate = toDateKey(order.data_criacao);
        if (!orderDate) continue;

        const isCanceled = getIsCanceled(order);
        const gross = getOrderGross(order);
        const effective = isCanceled ? 0 : gross;
        const channelName = getChannelName(order.payload);
        orderMeta.set(order.id, {
          orderDate,
          isCanceled,
          channelName
        });

        if (!daily.has(orderDate)) {
          daily.set(orderDate, {
            order_date: orderDate,
            gross_revenue: 0,
            effective_revenue: 0,
            orders_count: 0,
            canceled_orders: 0,
            units: 0
          });
        }

        const dailyRow = daily.get(orderDate);
        dailyRow.gross_revenue += gross;
        dailyRow.effective_revenue += effective;
        dailyRow.orders_count += 1;
        dailyRow.canceled_orders += isCanceled ? 1 : 0;

        const weekStart = toWeekStart(orderDate);
        const channelKey = `${weekStart}:${channelName}`;

        if (!channels.has(channelKey)) {
          channels.set(channelKey, {
            week_start: weekStart,
            channel_id: null,
            channel_name: channelName,
            gross_revenue: 0,
            effective_revenue: 0,
            orders_count: 0,
            canceled_orders: 0,
            units: 0
          });
        }

        const channelRow = channels.get(channelKey);
        channelRow.gross_revenue += gross;
        channelRow.effective_revenue += effective;
        channelRow.orders_count += 1;
        channelRow.canceled_orders += isCanceled ? 1 : 0;
      }

      ordersProcessed += orders.length;
      offset += orders.length;
      console.log(JSON.stringify({ currentDate, ordersProcessed, dailyRows: daily.size, channelRows: channels.size }));

      if (orders.length < pageSize) break;
    }

    let itemOffset = 0;

    while (true) {
      const items = await listOrderItemsForDay(env, pageSize, itemOffset, currentDate);
      if (items.length === 0) break;

      for (const item of items) {
        const meta = orderMeta.get(item.order_id);
        const orderDate = meta?.orderDate ?? toDateKey(item.order_data_criacao);
        if (!orderDate) continue;

        const quantity = Number(item.quantidade ?? 0);
        const unitValue = parseMoney(item.valor_unitario);
        const totalValue = parseMoney(item.valor_total);
        const channelName = meta?.channelName ?? "Sem canal";
        const weekStart = toWeekStart(orderDate);

        if (!daily.has(orderDate)) {
          daily.set(orderDate, {
            order_date: orderDate,
            gross_revenue: 0,
            effective_revenue: 0,
            orders_count: 0,
            canceled_orders: 0,
            units: 0
          });
        }

        const dailyRow = daily.get(orderDate);
        if (Number.isFinite(quantity) && quantity > 0) {
          dailyRow.units += quantity;
        }

        const channelKey = `${weekStart}:${channelName}`;
        if (!channels.has(channelKey)) {
          channels.set(channelKey, {
            week_start: weekStart,
            channel_id: null,
            channel_name: channelName,
            gross_revenue: 0,
            effective_revenue: 0,
            orders_count: 0,
            canceled_orders: 0,
            units: 0
          });
        }

        const channelRow = channels.get(channelKey);
        if (Number.isFinite(quantity) && quantity > 0) {
          channelRow.units += quantity;
        }
        itemsProcessed += 1;
      }

      console.log(JSON.stringify({ currentDate, ordersProcessed, itemsProcessed, dailyRows: daily.size, channelRows: channels.size }));

      itemOffset += items.length;

      if (items.length < pageSize) break;
    }

    currentDate = addDays(currentDate, 1);
  }

  const dailyRows = Array.from(daily.values()).map(finalize);
  const channelRows = Array.from(channels.values()).map(finalize);

  await replaceRows(env, "oraculo_daily_sales_cache", dailyRows);
  await replaceRows(env, "oraculo_channel_sales_cache", channelRows);

  console.log(JSON.stringify({
    ok: true,
    startDate,
    endDate,
    ordersProcessed,
    dailyRows: dailyRows.length,
    channelRows: channelRows.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
