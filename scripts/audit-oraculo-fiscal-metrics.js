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

function requireEnv(env, keys) {
  for (const key of keys) if (env[key]) return env[key];
  throw new Error(`Missing required environment variable. Tried: ${keys.join(", ")}`);
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const normalized = String(value).trim().replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(parseNumber(value));
}

function count(value) {
  return new Intl.NumberFormat("pt-BR").format(parseNumber(value));
}

async function supabaseFetch(env, path, options = {}) {
  const key = requireEnv(env, ["SUPABASE_SERVICE_ROLE_KEY"]);
  const response = await fetch(`${requireEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]).replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const env = loadEnv();
  const start = arg("start", "2026-06-01");
  const end = arg("end", "2026-06-19");

  const [metricsRows, channelRows] = await Promise.all([
    supabaseFetch(env, "/rest/v1/rpc/oraculo_fiscal_metrics", {
      method: "POST",
      body: JSON.stringify({ start_date: start, end_date: end })
    }),
    supabaseFetch(env, "/rest/v1/rpc/oraculo_fiscal_channel_metrics", {
      method: "POST",
      body: JSON.stringify({ start_date: start, end_date: end })
    })
  ]);

  const metrics = Array.isArray(metricsRows) ? metricsRows[0] : metricsRows;
  const invoices = parseNumber(metrics?.invoices_count);
  const revenue = parseNumber(metrics?.billed_revenue);
  const excludedDevolutions = parseNumber(metrics?.excluded_devolutions_count);
  const excludedDevolutionsRevenue = parseNumber(metrics?.excluded_devolutions_revenue);
  const canceled = parseNumber(metrics?.canceled_count);
  const canceledRevenue = parseNumber(metrics?.canceled_revenue);
  const linkedOrders = parseNumber(metrics?.linked_orders_count);
  const channels = Array.isArray(channelRows) ? channelRows : [];

  const result = {
    period: { start, end },
    official_fiscal: {
      invoices,
      billed_revenue: revenue,
      average_ticket: invoices > 0 ? revenue / invoices : 0,
      linked_orders: linkedOrders
    },
    excluded: {
      devolutions_count: excludedDevolutions,
      devolutions_revenue: excludedDevolutionsRevenue,
      canceled_count: canceled,
      canceled_revenue: canceledRevenue
    },
    top_channels: channels.slice(0, 15).map((row) => ({
      channel: row.channel_label ?? "Sem canal",
      invoices: parseNumber(row.invoices_count),
      revenue: parseNumber(row.billed_revenue)
    }))
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Periodo fiscal: ${start} a ${end}`);
  console.log("");
  console.log("Fiscal oficial");
  console.log(`- NFs faturadas validas: ${count(invoices)}`);
  console.log(`- Receita faturada: ${money(revenue)}`);
  console.log(`- Ticket medio faturado: ${money(invoices > 0 ? revenue / invoices : 0)}`);
  console.log(`- NFs com pedido vinculado: ${count(linkedOrders)}`);
  console.log("");
  console.log("Excluidas da receita oficial");
  console.log(`- Devolucoes/tipo E: ${count(excludedDevolutions)} / ${money(excludedDevolutionsRevenue)}`);
  console.log(`- Canceladas/status 8: ${count(canceled)} / ${money(canceledRevenue)}`);
  console.log("");
  console.log("Top canais");
  for (const channel of result.top_channels) {
    console.log(`- ${channel.channel}: ${count(channel.invoices)} NFs / ${money(channel.revenue)}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
