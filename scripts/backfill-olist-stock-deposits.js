#!/usr/bin/env node

// Semeadura única de olist_stock_deposits: varre GET /estoque/{idProduto} para
// TODOS os produtos ativos (o sync incremental só busca depósitos de produtos
// com movimento — sem esta semeadura, um produto que só tem saldo em Avarias/
// Devolução nunca entraria na tabela).
//
// Usa o access_token já armazenado em olist_oauth_tokens e NUNCA roda o fluxo
// de refresh localmente: o refresh rotaciona o token e órfãozinharia as Edge
// Functions. Em 401, relê o token da tabela (o cron de estoque renova a cada
// 30 min) e tenta de novo.
//
// uso: node scripts/backfill-olist-stock-deposits.js [--limit N] [--delay-ms 350]

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${path} (${response.status}): ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function readAccessToken(env) {
  const rows = await supabaseFetch(env, "rest/v1/olist_oauth_tokens?provider=eq.olist&select=access_token&limit=1");
  const token = rows?.[0]?.access_token;
  if (!token) throw new Error("Sem access_token armazenado em olist_oauth_tokens.");
  return token;
}

async function listActiveProducts(env) {
  const products = [];
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const page = await supabaseFetch(
      env,
      `rest/v1/olist_stock_items?select=produto_id,sku&active=is.true&order=produto_id.asc&limit=${pageSize}&offset=${offset}`
    );
    products.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return products;
}

async function fetchStockDeposits(env, accessToken, produtoId) {
  const baseUrl = env.OLIST_API_BASE_URL.endsWith("/") ? env.OLIST_API_BASE_URL : `${env.OLIST_API_BASE_URL}/`;
  const url = new URL(`estoque/${produtoId}`, baseUrl);
  const headers = {
    Accept: "application/json",
    [env.OLIST_API_AUTH_HEADER || "Authorization"]: `${env.OLIST_API_AUTH_PREFIX || "Bearer"} ${accessToken}`
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    let response;
    let text;
    try {
      response = await fetch(url, { headers });
      text = await response.text();
    } catch {
      // Falha de rede (fetch failed) — mesmo backoff dos 5xx.
      await sleep(1500 * (attempt + 1));
      continue;
    }

    if (response.ok) {
      return { ok: true, payload: JSON.parse(text) };
    }
    if (response.status === 401) {
      return { ok: false, unauthorized: true };
    }
    if (response.status === 404) {
      return { ok: true, payload: null };
    }
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after") || "0");
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1));
      continue;
    }
    throw new Error(`GET estoque/${produtoId} (${response.status}): ${text.slice(0, 300)}`);
  }
  throw new Error(`GET estoque/${produtoId}: limite de taxa excedido apos retries.`);
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function normalizeDepositRows(stockDetail, produtoId, sku) {
  const deposits = Array.isArray(stockDetail?.depositos) ? stockDetail.depositos : [];
  return deposits
    .filter((row) => row && typeof row === "object")
    .map((row) => ({
      produto_id: produtoId,
      deposito_id: String(row.id ?? "").trim(),
      sku,
      deposito_nome: row.nome == null ? null : String(row.nome),
      desconsiderar: row.desconsiderar === true,
      saldo: asNumber(row.saldo),
      reservado: asNumber(row.reservado),
      disponivel: asNumber(row.disponivel),
      empresa_cnpj: row.empresa == null ? null : String(row.empresa),
      synced_at: new Date().toISOString()
    }))
    .filter((row) => row.deposito_id !== "");
}

async function upsertDeposits(env, rows) {
  for (const group of chunk(rows, 200)) {
    await supabaseFetch(env, "rest/v1/olist_stock_deposits?on_conflict=produto_id,deposito_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(group)
    });
  }
}

async function upsertDimension(env, rows) {
  if (!rows.length) return;
  await supabaseFetch(env, "rest/v1/logistica_depositos?on_conflict=deposito_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}

async function main() {
  const env = loadEnv();
  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OLIST_API_BASE_URL"]) {
    if (!env[key]) throw new Error(`Faltando ${key} no .env`);
  }

  const args = process.argv.slice(2);
  const limitIndex = args.indexOf("--limit");
  const delayIndex = args.indexOf("--delay-ms");
  const limit = limitIndex !== -1 ? Number(args[limitIndex + 1]) : Infinity;
  const delayMs = delayIndex !== -1 ? Number(args[delayIndex + 1]) : 350;

  let accessToken = await readAccessToken(env);
  const products = await listActiveProducts(env);

  // Retomável: pula quem já tem linha em olist_stock_deposits (rodadas
  // anteriores interrompidas continuam de onde pararam).
  const swept = new Set();
  for (let offset = 0; ; offset += 1000) {
    const page = await supabaseFetch(
      env,
      `rest/v1/olist_stock_deposits?select=produto_id&order=produto_id.asc&limit=1000&offset=${offset}`
    );
    for (const row of page) swept.add(row.produto_id);
    if (page.length < 1000) break;
  }

  const targets = products.filter((product) => !swept.has(product.produto_id)).slice(0, limit);
  console.log(`Produtos ativos: ${products.length}; ja varridos: ${swept.size}; varrendo ${targets.length} (delay ${delayMs}ms).`);

  const dimensionSeen = new Map();
  let done = 0;
  let pending = [];

  for (const product of targets) {
    let result = await fetchStockDeposits(env, accessToken, product.produto_id);
    if (!result.ok && result.unauthorized) {
      console.log("Token expirou; relendo de olist_oauth_tokens...");
      await sleep(5000);
      accessToken = await readAccessToken(env);
      result = await fetchStockDeposits(env, accessToken, product.produto_id);
      if (!result.ok) throw new Error("Token relido continua invalido; aguarde o proximo ciclo do cron de estoque.");
    }

    if (result.payload) {
      const rows = normalizeDepositRows(result.payload, product.produto_id, product.sku);
      pending.push(...rows);
      for (const row of rows) {
        if (!dimensionSeen.has(row.deposito_id)) {
          dimensionSeen.set(row.deposito_id, { deposito_id: row.deposito_id, nome: row.deposito_nome ?? row.deposito_id });
        }
      }
    }

    done += 1;
    if (pending.length >= 400) {
      await upsertDeposits(env, pending);
      pending = [];
      console.log(`${done}/${targets.length} produtos varridos.`);
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  if (pending.length) await upsertDeposits(env, pending);
  await upsertDimension(env, Array.from(dimensionSeen.values()));
  console.log(`Concluido: ${done} produtos varridos, ${dimensionSeen.size} depositos na dimensao.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
