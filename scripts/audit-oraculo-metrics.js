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
  } catch {
    // Environment variables may already be exported in CI or local shells.
  }
  return env;
}

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function requireEnv(env, keys) {
  for (const key of keys) {
    if (env[key]) return env[key];
  }
  throw new Error(`Missing required environment variable. Tried: ${keys.join(", ")}`);
}

function money(value) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0);
}

function count(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value ?? 0));
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function minDate(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  return left < right ? left : right;
}

function maxDate(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  return left > right ? left : right;
}

function addNumber(target, key, value) {
  target[key] = Number(target[key] ?? 0) + Number(value ?? 0);
}

function addStats(target, source, sumKeys, minKeys = [], maxKeys = []) {
  for (const key of sumKeys) addNumber(target, key, source?.[key]);
  for (const key of minKeys) target[key] = minDate(target[key], source?.[key]);
  for (const key of maxKeys) target[key] = maxDate(target[key], source?.[key]);
}

async function callSnapshot(env, startDate, endDate) {
  const supabaseUrl = requireEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceKey = requireEnv(env, ["SUPABASE_SERVICE_ROLE_KEY"]);
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/oraculo_reconciliation_snapshot`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      p_start_date: startDate,
      p_end_date: endDate
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase RPC failed (${response.status}): ${text.slice(0, 500)}`);
  }

  return JSON.parse(text);
}

async function callSnapshotByDay(env, startDate, endDate) {
  if (startDate === endDate) return callSnapshot(env, startDate, endDate);

  const snapshots = [];
  for (let current = startDate; current <= endDate; current = addDays(current, 1)) {
    snapshots.push(await callSnapshot(env, current, current));
  }

  const merged = {
    period: { start_date: startDate, end_date: endDate },
    definitions_version: snapshots[0]?.definitions_version ?? "2026-06-20-a",
    olist_by_order_created_at: {},
    olist_by_nf_billing_date: {},
    current_dashboard_nf_function: {},
    diagnostics: {}
  };

  for (const snapshot of snapshots) {
    addStats(
      merged.olist_by_order_created_at,
      snapshot.olist_by_order_created_at,
      [
        "orders_count",
        "canceled_count",
        "pending_status_count",
        "missing_billing_date_count",
        "gross_preferred_revenue",
        "net_preferred_revenue",
        "gross_valor_total_pedido_revenue",
        "gross_valor_total_revenue",
        "gross_valor_total_produtos_revenue"
      ],
      ["first_created_date"],
      ["last_created_date"]
    );

    addStats(
      merged.olist_by_nf_billing_date,
      snapshot.olist_by_nf_billing_date,
      [
        "nf_emitted_count",
        "nf_confirmed_revenue",
        "nf_valor_total_pedido_revenue",
        "nf_valor_total_revenue",
        "nf_valor_total_produtos_revenue"
      ],
      ["first_billing_date"],
      ["last_billing_date"]
    );

    addStats(
      merged.current_dashboard_nf_function,
      snapshot.current_dashboard_nf_function,
      ["confirmed_revenue", "emitted_count", "canceled_count", "pending_count"]
    );
  }

  merged.diagnostics.olist_created_revenue_delta_preferred_minus_valor_total =
    Number(merged.olist_by_order_created_at.gross_preferred_revenue ?? 0) -
    Number(merged.olist_by_order_created_at.gross_valor_total_revenue ?? 0);
  merged.diagnostics.olist_nf_revenue_delta_preferred_minus_valor_total =
    Number(merged.olist_by_nf_billing_date.nf_confirmed_revenue ?? 0) -
    Number(merged.olist_by_nf_billing_date.nf_valor_total_revenue ?? 0);
  merged.diagnostics.known_issue =
    "Current dashboard NF metrics come from oraculo_nf_daily_cache; the cache is currently grouped by order creation date, not billing date.";
  merged.diagnostics.execution_mode = "daily_rpc_merge";

  return merged;
}

function printHuman(snapshot) {
  const created = snapshot.olist_by_order_created_at ?? {};
  const billed = snapshot.olist_by_nf_billing_date ?? {};
  const nf = snapshot.current_dashboard_nf_function ?? {};
  const items = snapshot.olist_items_by_order_created_at ?? {};
  const shopee = snapshot.shopee_by_order_created_at ?? {};
  const shopeeItems = snapshot.shopee_items_by_order_created_at ?? {};
  const diagnostics = snapshot.diagnostics ?? {};

  console.log(`Periodo auditado: ${snapshot.period?.start_date} a ${snapshot.period?.end_date}`);
  console.log("");
  console.log("Olist por data de criacao do pedido");
  console.log(`- Pedidos: ${count(created.orders_count)}`);
  console.log(`- Cancelados: ${count(created.canceled_count)}`);
  console.log(`- Pendentes por status: ${count(created.pending_status_count)}`);
  console.log(`- Sem data de faturamento: ${count(created.missing_billing_date_count)}`);
  console.log(`- Receita preferencial: ${money(created.gross_preferred_revenue)}`);
  console.log(`- Receita usando apenas valorTotal: ${money(created.gross_valor_total_revenue)}`);
  console.log("");
  console.log("Olist por data de faturamento da NF");
  console.log(`- NFs emitidas: ${count(billed.nf_emitted_count)}`);
  console.log(`- Receita confirmada: ${money(billed.nf_confirmed_revenue)}`);
  console.log(`- Receita NF usando apenas valorTotal: ${money(billed.nf_valor_total_revenue)}`);
  console.log("");
  console.log("Funcao atual usada pelo dashboard");
  console.log(`- Receita confirmada: ${money(nf.confirmed_revenue)}`);
  console.log(`- NFs emitidas: ${count(nf.emitted_count)}`);
  console.log(`- Canceladas: ${count(nf.canceled_count)}`);
  console.log(`- Pendentes: ${count(nf.pending_count)}`);
  console.log("");
  console.log("Itens Olist no periodo");
  console.log(`- Linhas de item: ${count(items.item_rows)}`);
  console.log(`- Pedidos com itens: ${count(items.orders_with_items)}`);
  console.log(`- Unidades: ${count(items.units)}`);
  console.log(`- Receita por itens: ${money(items.item_revenue)}`);
  console.log("");
  console.log("Shopee Donacor no periodo");
  console.log(`- Pedidos: ${count(shopee.orders_count)}`);
  console.log(`- Cancelados: ${count(shopee.canceled_count)}`);
  console.log(`- Receita liquida: ${money(shopee.net_revenue)}`);
  console.log(`- Linhas de item: ${count(shopeeItems.item_rows)}`);
  console.log(`- Unidades: ${count(shopeeItems.units)}`);
  console.log("");
  console.log("Diagnostico");
  console.log(`- Diferenca Olist criada: ${money(diagnostics.olist_created_revenue_delta_preferred_minus_valor_total)}`);
  console.log(`- Diferenca NF: ${money(diagnostics.olist_nf_revenue_delta_preferred_minus_valor_total)}`);
  if (diagnostics.execution_mode) console.log(`- Execucao: ${diagnostics.execution_mode}`);
  console.log(`- Observacao: ${diagnostics.known_issue ?? diagnostics.omitted_for_speed ?? "Sem observacao"}`);
}

async function main() {
  const startDate = getArg("start", "2026-06-01");
  const endDate = getArg("end", "2026-06-30");
  const json = process.argv.includes("--json");
  const snapshot = await callSnapshotByDay(loadEnv(), startDate, endDate);

  if (json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  printHuman(snapshot);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
