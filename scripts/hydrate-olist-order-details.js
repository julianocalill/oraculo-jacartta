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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
  return results;
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

async function getAccessToken(env) {
  const tokenRes = await supabaseFetch(
    env,
    "rest/v1/olist_oauth_tokens?provider=eq.olist&select=refresh_token&limit=1"
  );

  if (!tokenRes.response.ok) {
    throw new Error(`Falha ao ler refresh token salvo (${tokenRes.response.status}): ${tokenRes.text.slice(0, 300)}`);
  }

  const refreshToken = JSON.parse(tokenRes.text)[0]?.refresh_token;
  if (!refreshToken) {
    throw new Error("Nao encontrei refresh_token salvo em olist_oauth_tokens.");
  }

  const response = await fetch(env.OLIST_API_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.OLIST_API_CLIENT_ID,
      client_secret: env.OLIST_API_CLIENT_SECRET
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Falha ao renovar token da Olist (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = JSON.parse(text);
  if (typeof payload.access_token !== "string") {
    throw new Error("A resposta de token da Olist nao trouxe access_token.");
  }

  return payload.access_token;
}

async function listOrdersNeedingDetail(env, limit, startDate, endDate, offset) {
  const filters = [
    "select=id,numero_pedido,payload,data_criacao",
    "order=data_criacao.desc,id.desc",
    `limit=${limit}`,
    `offset=${offset}`
  ];

  if (startDate) filters.push(`data_criacao=gte.${startDate}`);
  if (endDate) filters.push(`data_criacao=lte.${endDate}`);

  const { response, text } = await supabaseFetch(env, `rest/v1/olist_orders?${filters.join("&")}`);
  if (!response.ok) {
    throw new Error(`Falha ao listar pedidos (${response.status}): ${text.slice(0, 300)}`);
  }

  const rows = JSON.parse(text);
  return {
    page: rows,
    pending: rows.filter((row) => !Array.isArray(row.payload?.itens))
  };
}

async function fetchOrderDetail(env, accessToken, orderId) {
  const url = new URL(`pedidos/${orderId}`, env.OLIST_API_BASE_URL.endsWith("/") ? env.OLIST_API_BASE_URL : `${env.OLIST_API_BASE_URL}/`);

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        [env.OLIST_API_AUTH_HEADER]: env.OLIST_API_AUTH_PREFIX
          ? `${env.OLIST_API_AUTH_PREFIX} ${accessToken}`
          : accessToken
      }
    });

    const text = await response.text();
    if (response.ok) {
      return JSON.parse(text);
    }

    if ((response.status === 429 || response.status >= 500) && attempt < 6) {
      await sleep(response.status === 429 ? 2000 * attempt : 500 * attempt);
      continue;
    }

    throw new Error(`Falha ao buscar detalhe do pedido ${orderId} (${response.status}): ${text.slice(0, 300)}`);
  }
}

function normalizeDetailedOrder(order) {
  return {
    id: String(order.id),
    numero_pedido: order.numeroPedido == null ? null : String(order.numeroPedido),
    situacao: order.situacao == null ? null : String(order.situacao),
    data_criacao: order.data || order.dataCriacao || null,
    data_atualizacao: order.dataAtualizacao || order.dataAlteracao || null,
    cliente: order.cliente && typeof order.cliente === "object" ? order.cliente : {},
    transportador: order.transportador && typeof order.transportador === "object" ? order.transportador : {},
    payload: order,
    synced_at: new Date().toISOString()
  };
}

async function upsertOrders(env, rows) {
  for (const group of chunk(rows, 50)) {
    const { response, text } = await supabaseFetch(env, "rest/v1/olist_orders?on_conflict=id", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(group)
    });

    if (!response.ok) {
      throw new Error(`Falha ao gravar detalhes de pedidos (${response.status}): ${text.slice(0, 300)}`);
    }
  }
}

async function main() {
  const env = loadEnv();
  requireEnv(env, "SUPABASE_URL");
  requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  requireEnv(env, "OLIST_API_BASE_URL");
  requireEnv(env, "OLIST_API_TOKEN_URL");
  requireEnv(env, "OLIST_API_CLIENT_ID");
  requireEnv(env, "OLIST_API_CLIENT_SECRET");
  requireEnv(env, "OLIST_API_AUTH_HEADER");

  const startDate = process.env.DETAIL_START_DATE || "2026-04-01";
  const endDate = process.env.DETAIL_END_DATE || "2026-04-16";
  const pageSize = Number(process.env.DETAIL_PAGE_SIZE || "200");
  const maxOrders = process.env.DETAIL_MAX_ORDERS
    ? Number(process.env.DETAIL_MAX_ORDERS)
    : Number.POSITIVE_INFINITY;
  const concurrency = Number(process.env.DETAIL_CONCURRENCY || "2");

  const accessToken = await getAccessToken(env);
  let offset = 0;
  let hydrated = 0;

  while (hydrated < maxOrders) {
    const { page, pending } = await listOrdersNeedingDetail(env, pageSize, startDate, endDate, offset);
    if (page.length === 0) {
      break;
    }

    const remaining = Math.max(maxOrders - hydrated, 0);
    const targetRows = pending.slice(0, remaining);

    if (targetRows.length === 0) {
      offset += pageSize;
      continue;
    }

    const detailed = await mapConcurrent(targetRows, concurrency, async (row) => {
      const detail = await fetchOrderDetail(env, accessToken, row.id);
      return normalizeDetailedOrder(detail);
    });

    await upsertOrders(env, detailed);
    hydrated += detailed.length;
    console.log(`[${startDate} -> ${endDate}] hidratados ${hydrated}/${maxOrders}`);

    offset += pageSize;

    if (page.length < pageSize) {
      break;
    }
  }

  console.log(JSON.stringify({
    ok: true,
    startDate,
    endDate,
    hydrated,
    maxOrders: Number.isFinite(maxOrders) ? maxOrders : "all"
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
