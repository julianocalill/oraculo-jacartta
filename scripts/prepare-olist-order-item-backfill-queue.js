#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function loadEnv() {
  const env = { ...process.env };
  try {
    const file = readFileSync(join(process.cwd(), ".env"), "utf8");
    for (const rawLine of file.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index === -1) continue;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      env[key] = env[key] || value;
    }
  } catch {}
  return env;
}

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function validateDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Parametro --${name} invalido: ${value}`);
  }
  return value;
}

function requireEnv(env, keys) {
  for (const key of keys) if (env[key]) return env[key];
  throw new Error(`Missing required environment variable. Tried: ${keys.join(", ")}`);
}

async function supabaseRpc(env, name, body) {
  const baseUrl = requireEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]).replace(/\/$/, "");
  const serviceKey = requireEnv(env, ["SUPABASE_SERVICE_ROLE_KEY"]);
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase RPC ${name} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const env = loadEnv();
  const start = validateDate(arg("start", "2026-06-01"), "start");
  const end = validateDate(arg("end", "2026-06-19"), "end");
  if (start > end) throw new Error("--start deve ser menor ou igual a --end.");

  const pageSize = Math.max(1, Math.min(Number(arg("page-size", "2000")) || 2000, 5000));
  const refreshedLinks = hasFlag("refresh-links")
    ? Number(await supabaseRpc(
      env,
      "refresh_oraculo_fiscal_invoice_order_links",
      { p_start_date: start, p_end_date: end }
    ) || 0)
    : 0;
  const initial = await supabaseRpc(
    env,
    "olist_order_item_backfill_queue_summary",
    { p_start_date: start, p_end_date: end }
  );
  let afterOrderId = initial?.last_order_id || null;
  let inserted = 0;
  let batches = 0;

  while (true) {
    const batch = await supabaseRpc(
      env,
      "prepare_olist_order_item_backfill_queue_batch",
      {
        p_start_date: start,
        p_end_date: end,
        p_after_order_id: afterOrderId,
        p_limit: pageSize
      }
    );
    batches += 1;
    inserted += Number(batch?.inserted || 0);
    if (batch?.exhausted || !batch?.next_order_id) break;
    afterOrderId = String(batch.next_order_id);
    console.log(JSON.stringify({
      batch: batches,
      inserted,
      checkpoint_order_id: afterOrderId
    }));
  }

  const queue = await supabaseRpc(
    env,
    "olist_order_item_backfill_queue_summary",
    { p_start_date: start, p_end_date: end }
  );

  console.log(JSON.stringify({
    ok: true,
    period: { start, end },
    refreshed_invoice_order_links: refreshedLinks,
    refresh_links_requested: hasFlag("refresh-links"),
    page_size: pageSize,
    batches,
    inserted_this_invocation: inserted,
    queue
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
