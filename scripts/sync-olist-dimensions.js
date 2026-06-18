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

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
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

async function tableExists(env, table) {
  const { response } = await supabaseFetch(env, `rest/v1/${table}?select=id&limit=1`);
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
    "select=id,data_criacao,payload,situacao",
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

async function listStockItems(env, limit, offset) {
  const { response, text } = await supabaseFetch(
    env,
    `rest/v1/olist_stock_items?select=id,produto_id,sku,nome,saldo,reservado,disponivel,active,payload,synced_at&order=synced_at.desc,id.asc&limit=${limit}&offset=${offset}`
  );

  if (!response.ok) {
    throw new Error(`Falha ao listar estoque (${response.status}): ${text.slice(0, 300)}`);
  }

  return parseJson(text, "Falha ao listar estoque");
}

async function upsertRows(env, path, rows) {
  for (const group of chunk(rows, 200)) {
    const { response, text } = await supabaseFetch(env, `${path}?on_conflict=id`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(group)
    });

    if (!response.ok) {
      throw new Error(`Falha ao gravar ${path} (${response.status}): ${text.slice(0, 300)}`);
    }
  }
}

function buildStatusRows(codes) {
  const known = {
    "1": { label: "Status 1", funnel_stage: "open", sort_order: 10, is_canceled: false, is_closed: false },
    "2": { label: "Status 2", funnel_stage: "processing", sort_order: 20, is_canceled: false, is_closed: false },
    "8": { label: "Status 8", funnel_stage: "canceled", sort_order: 80, is_canceled: true, is_closed: true }
  };

  return Array.from(codes)
    .sort()
    .map((code) => {
      const preset = known[code] || { label: `Status ${code}`, funnel_stage: "unknown", sort_order: 999, is_canceled: false, is_closed: false };
      return {
        id: `olist:${code}`,
        source: "olist",
        code,
        label: preset.label,
        funnel_stage: preset.funnel_stage,
        sort_order: preset.sort_order,
        is_canceled: preset.is_canceled,
        is_closed: preset.is_closed,
        meta: { source: "olist", raw_code: code },
        synced_at: new Date().toISOString()
      };
    });
}

async function main() {
  const env = loadEnv();
  requireEnv(env, "SUPABASE_URL");
  requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const requiredTables = ["dim_channels", "dim_order_status", "olist_products"];
  for (const table of requiredTables) {
    if (!(await tableExists(env, table))) {
      console.log(JSON.stringify({
        ok: true,
        skipped: true,
        reason: `${table} table not available in remote Supabase`
      }, null, 2));
      return;
    }
  }

  const startDate = process.env.DIMENSIONS_START_DATE || null;
  const endDate = process.env.DIMENSIONS_END_DATE || null;
  const orderPageSize = Number(process.env.DIMENSIONS_ORDER_PAGE_SIZE || "500");
  const stockPageSize = Number(process.env.DIMENSIONS_STOCK_PAGE_SIZE || "500");

  const channelMap = new Map();
  const statusCodes = new Set();
  let orderOffset = 0;
  let ordersProcessed = 0;

  while (true) {
    const orders = await listOrders(env, orderPageSize, orderOffset, startDate, endDate);
    if (orders.length === 0) {
      break;
    }

    for (const order of orders) {
      ordersProcessed += 1;
      if (order.situacao != null) {
        statusCodes.add(String(order.situacao));
      }

      const ecommerce = order.payload && typeof order.payload.ecommerce === "object" ? order.payload.ecommerce : null;
      if (!ecommerce?.nome) continue;

      const sourceId = ecommerce.id == null ? null : String(ecommerce.id);
      const key = sourceId || ecommerce.nome;
      const existing = channelMap.get(key);
      const firstSeenAt = existing?.first_seen_at || order.data_criacao || null;
      const lastSeenAt = order.data_criacao || existing?.last_seen_at || null;

      channelMap.set(key, {
        id: `olist:${sourceId || slugify(ecommerce.nome)}`,
        source: "olist",
        source_id: sourceId,
        source_name: String(ecommerce.nome),
        display_name: String(ecommerce.nome),
        channel_group: String(ecommerce.nome).split(" ")[0] || "Olist",
        active: true,
        first_seen_at: firstSeenAt,
        last_seen_at: lastSeenAt,
        meta: ecommerce,
        synced_at: new Date().toISOString()
      });
    }

    orderOffset += orders.length;
    if (orders.length < orderPageSize) break;
  }

  let stockOffset = 0;
  let productsProcessed = 0;
  const products = [];

  while (true) {
    const rows = await listStockItems(env, stockPageSize, stockOffset);
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
      const categoria = payload.categoria && typeof payload.categoria === "object" ? payload.categoria : {};
      const marca = payload.marca && typeof payload.marca === "object" ? payload.marca : {};
      const precos = payload.precos && typeof payload.precos === "object" ? payload.precos : {};

      products.push({
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
      });
      productsProcessed += 1;
    }

    stockOffset += rows.length;
    if (rows.length < stockPageSize) break;
  }

  const channels = Array.from(channelMap.values());
  const statuses = buildStatusRows(statusCodes);

  if (channels.length > 0) {
    await upsertRows(env, "rest/v1/dim_channels", channels);
  }

  if (statuses.length > 0) {
    await upsertRows(env, "rest/v1/dim_order_status", statuses);
  }

  if (products.length > 0) {
    await upsertRows(env, "rest/v1/olist_products", products);
  }

  console.log(JSON.stringify({
    ok: true,
    ordersProcessed,
    channelsUpserted: channels.length,
    statusesUpserted: statuses.length,
    productsUpserted: products.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
