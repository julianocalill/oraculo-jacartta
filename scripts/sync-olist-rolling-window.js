#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = resolve(__dirname, "..");

function loadEnv() {
  const file = readFileSync(join(repoRoot, ".env"), "utf8");
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

function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function firstDayMonthsBack(date, monthsBack) {
  return new Date(date.getFullYear(), date.getMonth() - monthsBack, 1);
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

async function listOrderIds(env, startDate, resetAll, limit) {
  const filters = [
    "select=id",
    "order=data_criacao.asc,id.asc",
    `limit=${limit}`
  ];

  if (!resetAll) {
    filters.push(`data_criacao=lt.${startDate}`);
  }

  const { response, text } = await supabaseFetch(env, `rest/v1/olist_orders?${filters.join("&")}`);
  if (!response.ok) {
    throw new Error(`Falha ao listar pedidos para limpeza (${response.status}): ${text.slice(0, 300)}`);
  }

  return JSON.parse(text);
}

async function deleteOrdersByIds(env, ids) {
  const encodedIds = ids.map((id) => String(id)).join(",");
  const { response, text } = await supabaseFetch(env, `rest/v1/olist_orders?id=in.(${encodedIds})`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal"
    }
  });

  if (!response.ok) {
    throw new Error(`Falha ao apagar lote de pedidos (${response.status}): ${text.slice(0, 300)}`);
  }
}

async function deleteOrders(env, startDate, resetAll) {
  const batchSize = 1000;
  let deleted = 0;

  while (true) {
    const rows = await listOrderIds(env, startDate, resetAll, batchSize);
    if (rows.length === 0) break;
    await deleteOrdersByIds(env, rows.map((row) => row.id));
    deleted += rows.length;
    console.log(`Pedidos apagados: ${deleted}`);
  }
}

async function deleteRuns(env, table, field, startDate, resetAll) {
  const filter = resetAll ? "id=not.is.null" : `${field}=lt.${startDate}`;
  const { response, text } = await supabaseFetch(env, `rest/v1/${table}?${filter}`, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal"
    }
  });

  if (!response.ok) {
    throw new Error(`Falha ao limpar ${table} (${response.status}): ${text.slice(0, 300)}`);
  }
}

function runNodeScript(scriptPath, envVars) {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...envVars
    }
  });

  if (result.status !== 0) {
    throw new Error(`Script failed: ${scriptPath}`);
  }
}

async function main() {
  const env = loadEnv();
  requireEnv(env, "SUPABASE_URL");
  requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const today = new Date();
  const monthsBack = Number(process.env.ROLLING_MONTHS_BACK || "2");
  const startDate = toLocalIsoDate(firstDayMonthsBack(today, monthsBack));
  const endDate = toLocalIsoDate(today);
  const resetAll = String(process.env.RESET_ALL || "false").toLowerCase() === "true";

  await deleteOrders(env, startDate, resetAll);
  await deleteRuns(env, "olist_sync_runs", "window_end", startDate, resetAll);

  runNodeScript(join(repoRoot, "scripts/import-olist-orders-full.js"), {
    ORDER_BACKFILL_START_DATE: startDate,
    ORDER_BACKFILL_END_DATE: endDate,
    ORDER_BACKFILL_WINDOW_DAYS: "1"
  });

  const hydrateDetails = String(process.env.HYDRATE_ORDER_DETAILS || "false").toLowerCase() === "true";
  if (hydrateDetails) {
    runNodeScript(join(repoRoot, "scripts/hydrate-olist-order-details.js"), {
      DETAIL_START_DATE: startDate,
      DETAIL_END_DATE: endDate,
      DETAIL_PAGE_SIZE: "200",
      DETAIL_CONCURRENCY: "2"
    });
  }

  runNodeScript(join(repoRoot, "scripts/sync-olist-order-items.js"), {
    ORDER_ITEMS_START_DATE: startDate,
    ORDER_ITEMS_END_DATE: endDate
  });

  runNodeScript(join(repoRoot, "scripts/sync-olist-dimensions.js"), {
    DIMENSIONS_START_DATE: startDate,
    DIMENSIONS_END_DATE: endDate
  });

  runNodeScript(join(repoRoot, "scripts/snapshot-olist-stock.js"), {});

  console.log(JSON.stringify({
    ok: true,
    resetAll,
    startDate,
    endDate,
    monthsBack,
    hydrateDetails
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
