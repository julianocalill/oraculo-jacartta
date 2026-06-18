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
  const { response } = await supabaseFetch(env, "rest/v1/olist_stock_snapshots?select=id&limit=1");
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

async function listStockItems(env, limit, offset) {
  const { response, text } = await supabaseFetch(
    env,
    `rest/v1/olist_stock_items?select=produto_id,sku,nome,saldo,reservado,disponivel,active,payload&order=id.asc&limit=${limit}&offset=${offset}`
  );

  if (!response.ok) {
    throw new Error(`Falha ao listar estoque (${response.status}): ${text.slice(0, 300)}`);
  }

  return parseJson(text, "Falha ao listar estoque");
}

async function upsertSnapshots(env, rows) {
  for (const group of chunk(rows, 200)) {
    const { response, text } = await supabaseFetch(env, "rest/v1/olist_stock_snapshots?on_conflict=snapshot_date,produto_id", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(group)
    });

    if (!response.ok) {
      throw new Error(`Falha ao gravar snapshots (${response.status}): ${text.slice(0, 300)}`);
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
      reason: "olist_stock_snapshots table not available in remote Supabase"
    }, null, 2));
    return;
  }

  const snapshotDate = process.env.STOCK_SNAPSHOT_DATE || new Date().toISOString().slice(0, 10);
  const pageSize = Number(process.env.STOCK_SNAPSHOT_PAGE_SIZE || "500");
  let offset = 0;
  let snapshotsUpserted = 0;

  while (true) {
    const rows = await listStockItems(env, pageSize, offset);
    if (rows.length === 0) {
      break;
    }

    const snapshots = rows.map((row) => ({
      snapshot_date: snapshotDate,
      produto_id: row.produto_id == null ? null : String(row.produto_id),
      sku: row.sku == null ? null : String(row.sku),
      nome: row.nome == null ? null : String(row.nome),
      saldo: row.saldo == null ? null : Number(row.saldo),
      reservado: row.reservado == null ? null : Number(row.reservado),
      disponivel: row.disponivel == null ? null : Number(row.disponivel),
      active: Boolean(row.active),
      payload: row.payload && typeof row.payload === "object" ? row.payload : {},
      created_at: new Date().toISOString()
    }));

    await upsertSnapshots(env, snapshots);
    snapshotsUpserted += snapshots.length;
    offset += rows.length;

    console.log(JSON.stringify({ snapshotDate, snapshotsUpserted }));

    if (rows.length < pageSize) break;
  }

  console.log(JSON.stringify({
    ok: true,
    snapshotDate,
    snapshotsUpserted
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
