#!/usr/bin/env node

// Seed da aba Importações a partir do MVP local rastreamento-importacoes.
// Lê o último import da planilha FOLLOW UP (data/imports/latest.json),
// considera apenas faturas a partir da linha MIN_SHEET_ROW (as anteriores
// são embarques antigos que não precisam subir) e sobe também o registro
// de navios (IMO/MMSI) e as últimas posições AIS conhecidas.
//
// Uso: node scripts/import-rastreamento-followup.js [caminho-do-projeto]

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const MIN_SHEET_ROW = 419;
const SOURCE_PROJECT = process.argv[2] || join(process.env.HOME, "rastreamento-importacoes");

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

async function upsert(env, table, rows, onConflict) {
  if (rows.length === 0) return;
  const { response, text } = await supabaseFetch(
    env,
    `rest/v1/${table}?on_conflict=${onConflict}`,
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows)
    }
  );

  if (!response.ok) {
    throw new Error(`Upsert em ${table} falhou (${response.status}): ${text}`);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(SOURCE_PROJECT, relativePath), "utf8"));
}

async function main() {
  const env = loadEnv();
  requireEnv(env, "SUPABASE_URL");
  requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const dataset = readJson("data/imports/latest.json");
  const registry = readJson("data/vessels/registry.json");
  const positions = readJson("data/ais/positions.json");

  const invoices = dataset.invoices.filter(
    (invoice) => (invoice.source?.firstRow ?? 0) >= MIN_SHEET_ROW
  );

  console.log(
    `Planilha ${dataset.importBatch.sourceFileName}: ${dataset.invoices.length} faturas no total, ` +
      `${invoices.length} a partir da linha ${MIN_SHEET_ROW}.`
  );

  const faturaRows = invoices.map((invoice) => ({
    invoice_number: invoice.invoiceNumber,
    process_name: invoice.processName,
    production_start: invoice.productionStart,
    production_end: invoice.productionEnd,
    bl: invoice.bl,
    container_number: invoice.containerNumber,
    vessel_name: invoice.vesselNameManual,
    destination: invoice.destinationManual,
    port_arrival: invoice.portArrivalManual,
    transit_agent: invoice.transitAgent,
    packing_list_yuan: invoice.packingListYuan,
    packing_list_usd: invoice.packingListUsd,
    packing_list_brl: invoice.packingListBrl,
    taxes_brl: invoice.taxesBrl,
    total_cash_brl: invoice.totalCashBrl,
    transfer_invoice: invoice.transferInvoice,
    origin: "planilha",
    source_sheet: invoice.source?.sheet ?? null,
    source_first_row: invoice.source?.firstRow ?? null,
    source_last_row: invoice.source?.lastRow ?? null,
    updated_at: new Date().toISOString()
  }));

  await upsert(env, "importacao_faturas", faturaRows, "invoice_number");
  console.log(`Faturas gravadas: ${faturaRows.length}`);

  // Reimporta os itens das faturas vindas da planilha do zero (idempotente).
  const invoiceNumbers = invoices.map((invoice) => invoice.invoiceNumber);
  if (invoiceNumbers.length > 0) {
    const filter = `invoice_number=in.(${invoiceNumbers.map((n) => `"${n}"`).join(",")})`;
    const { response, text } = await supabaseFetch(env, `rest/v1/importacao_itens?${filter}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    if (!response.ok) {
      throw new Error(`Limpeza de itens falhou (${response.status}): ${text}`);
    }
  }

  const itemRows = invoices.flatMap((invoice) =>
    invoice.items.map((item) => ({
      invoice_number: invoice.invoiceNumber,
      description: item.description,
      quantity: item.quantity,
      unit_cost_yuan: item.unitCostYuan,
      unit_cost_with_tax_brl: item.unitCostWithTaxBrl,
      cartons: item.cartons,
      quantity_per_carton: item.quantityPerCarton,
      cbm: item.cbm,
      cbm_total: item.cbmTotal,
      source_row: item.sourceRow
    }))
  );

  if (itemRows.length > 0) {
    const { response, text } = await supabaseFetch(env, "rest/v1/importacao_itens", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(itemRows)
    });
    if (!response.ok) {
      throw new Error(`Insert de itens falhou (${response.status}): ${text}`);
    }
  }
  console.log(`Itens gravados: ${itemRows.length}`);

  const navioRows = registry.vessels.map((vessel) => ({
    name: vessel.name,
    aliases: vessel.aliases ?? [],
    imo: vessel.imo ?? null,
    mmsi: vessel.mmsi ?? null,
    updated_at: new Date().toISOString()
  }));

  await upsert(env, "importacao_navios", navioRows, "name");
  console.log(`Navios no registro: ${navioRows.length}`);

  const posicaoRows = Object.values(positions)
    .filter((position) => position.latitude != null && position.longitude != null)
    .map((position) => ({
      mmsi: position.mmsi,
      vessel_name: position.vesselName ?? null,
      latitude: position.latitude,
      longitude: position.longitude,
      speed_knots: position.speedKnots ?? null,
      course_degrees: position.courseDegrees ?? null,
      heading_degrees: position.headingDegrees ?? null,
      provider: position.provider ?? null,
      observed_at: position.observedAt ?? null,
      received_at: position.receivedAt ?? null,
      updated_at: new Date().toISOString()
    }));

  await upsert(env, "importacao_posicoes", posicaoRows, "mmsi");
  console.log(`Posições AIS gravadas: ${posicaoRows.length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
