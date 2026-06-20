#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function loadEnv() {
  const env = { ...process.env };
  const file = readFileSync(join(process.cwd(), ".env"), "utf8");
  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    env[line.slice(0, index).trim()] = env[line.slice(0, index).trim()] || line.slice(index + 1).trim();
  }
  return env;
}

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function requireEnv(env, key) {
  if (!env[key]) throw new Error(`Missing required environment variable: ${key}`);
  return env[key];
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function rpc(env, currentDate) {
  const supabaseUrl = requireEnv(env, "SUPABASE_URL").replace(/\/$/, "");
  const serviceKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/refresh_oraculo_channel_sales_unified_cache`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      p_start_date: currentDate,
      p_end_date: currentDate
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Falha em ${currentDate} (${response.status}): ${text.slice(0, 300)}`);
  return Number(JSON.parse(text) ?? 0);
}

async function main() {
  const env = loadEnv();
  const start = getArg("start", "2026-06-01");
  const end = getArg("end", new Date().toISOString().slice(0, 10));
  let totalRows = 0;

  for (let current = start; current <= end; current = addDays(current, 1)) {
    const rows = await rpc(env, current);
    totalRows += rows;
    console.log(JSON.stringify({ current, rows, totalRows }));
  }

  console.log(JSON.stringify({ ok: true, start, end, totalRows }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
