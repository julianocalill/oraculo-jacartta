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

async function tableExists(env) {
  const { response } = await supabaseFetch(env, "rest/v1/olist_order_items?select=id&limit=1");
  return response.ok;
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
    "select=id,data_criacao,payload",
    "order=data_criacao.asc,id.asc",
    `limit=${limit}`,
    `offset=${offset}`
  ];

  if (startDate) filters.push(`data_criacao=gte.${startDate}`);
  if (endDate) filters.push(`data_criacao=lte.${endDate}`);

  const { response, text } = await supabaseFetch(env, `rest/v1/olist_orders?${filters.join("&")}`);
  if (!response.ok) {
    throw new Error(`Falha ao listar pedidos (${response.status}): ${text.slice(0, 300)}`);
  }

  return parseJson(text, "Falha ao listar pedidos");
}

function normalizeItemRow(order, item, index) {
  const produto = item && typeof item.produto === "object" ? item.produto : {};
  const produtoId = produto.id == null ? null : String(produto.id);
  const sku = produto.sku == null ? null : String(produto.sku);
  const lineNumber = index + 1;
  const rowId = `${order.id}:${lineNumber}:${produtoId || sku || "item"}`;
  const quantidade = Number(item.quantidade ?? 0);
  const valorUnitario = item.valorUnitario == null ? null : Number(item.valorUnitario);
  const valorTotal = Number.isFinite(quantidade) && Number.isFinite(valorUnitario)
    ? quantidade * valorUnitario
    : null;

  return {
    id: rowId,
    order_id: String(order.id),
    line_number: lineNumber,
    produto_id: produtoId,
    sku,
    tipo: produto.tipo == null ? null : String(produto.tipo),
    descricao: produto.descricao == null ? null : String(produto.descricao),
    quantidade: Number.isFinite(quantidade) ? quantidade : 0,
    valor_unitario: Number.isFinite(valorUnitario) ? valorUnitario : null,
    valor_total: Number.isFinite(valorTotal) ? valorTotal : null,
    info_adicional: item.infoAdicional == null ? null : String(item.infoAdicional),
    order_data_criacao: order.data_criacao,
    payload: item && typeof item === "object" ? item : {},
    synced_at: new Date().toISOString()
  };
}

async function upsertItems(env, rows) {
  for (const group of chunk(rows, 200)) {
    const { response, text } = await supabaseFetch(env, "rest/v1/olist_order_items?on_conflict=id", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(group)
    });

    if (!response.ok) {
      throw new Error(`Falha ao gravar itens de pedido (${response.status}): ${text.slice(0, 300)}`);
    }
  }
}

async function main() {
  const env = loadEnv();
  requireEnv(env, "SUPABASE_URL");
  requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  if (!(await tableExists(env))) {
    console.log(JSON.stringify({
      ok: true,
      skipped: true,
      reason: "olist_order_items table not available in remote Supabase"
    }, null, 2));
    return;
  }

  const startDate = process.env.ORDER_ITEMS_START_DATE || null;
  const endDate = process.env.ORDER_ITEMS_END_DATE || null;
  const pageSize = Number(process.env.ORDER_ITEMS_PAGE_SIZE || "500");

  let offset = 0;
  let ordersProcessed = 0;
  let itemsUpserted = 0;

  while (true) {
    const orders = await listOrders(env, pageSize, offset, startDate, endDate);
    if (orders.length === 0) {
      break;
    }

    const itemRows = orders.flatMap((order) => {
      const itens = Array.isArray(order.payload?.itens) ? order.payload.itens : [];
      return itens.map((item, index) => normalizeItemRow(order, item, index));
    });

    if (itemRows.length > 0) {
      await upsertItems(env, itemRows);
      itemsUpserted += itemRows.length;
    }

    ordersProcessed += orders.length;
    offset += orders.length;

    console.log(JSON.stringify({
      ordersProcessed,
      itemsUpserted,
      startDate,
      endDate
    }));

    if (orders.length < pageSize) {
      break;
    }
  }

  console.log(JSON.stringify({
    ok: true,
    ordersProcessed,
    itemsUpserted,
    startDate,
    endDate
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
