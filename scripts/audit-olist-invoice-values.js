#!/usr/bin/env node

const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const EXPECTED_COUNT = 71197;
const EXPECTED_REVENUE = 5243629.96;
const DEFAULT_MONEY_PATHS = [
  "total_amount",
  "raw_json.valor",
  "raw_json.valorProdutos",
  "raw_json.valorFrete",
  "raw_json.valorDesconto",
  "raw_json.valorFaturado",
  "raw_json.valorNotaComImpostos",
  "raw_json.valorServicos",
  "raw_json.valorSeguro",
  "raw_json.valorOutras",
  "raw_json.valorIpi",
  "raw_json.valorIcms",
  "raw_json.valorIcmsSt",
  "raw_json.valorIssqn",
  "raw_json.baseIcms",
  "raw_json.baseIcmsSt"
];
const DATE_PATHS = [
  "emission_date",
  "raw_json.dataEmissao",
  "raw_json.dataInclusao",
  "raw_json.dataPrevista",
  "raw_json.dataCancelamento"
];

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
    // Env may already be loaded.
  }
  return env;
}

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function requireEnv(env, keys) {
  for (const key of keys) {
    if (env[key]) return env[key];
  }
  throw new Error(`Missing required environment variable. Tried: ${keys.join(", ")}`);
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null || typeof value === "boolean") return null;
  const text = String(value).trim();
  if (!text) return null;
  if (!/^-?[\d.,]+$/.test(text.replace(/\s/g, ""))) return null;
  const normalized = text.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2
  }).format(Number(value ?? 0));
}

function formatCount(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value ?? 0));
}

function percent(value) {
  return `${Number(value * 100).toFixed(3)}%`;
}

function getPath(row, path) {
  if (path === "total_amount") return row.total_amount;
  if (path === "emission_date") return row.emission_date;
  return path.split(".").reduce((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return current[part];
  }, row);
}

function dateKey(value) {
  if (!value) return "";
  const text = String(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function inDateWindow(value, startDate, endDate) {
  const key = dateKey(value);
  return key >= startDate && key <= endDate;
}

function flattenNumeric(obj, prefix = "raw_json", out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      if (index < 3) flattenNumeric(item, `${prefix}[${index}]`, out);
    });
    return out;
  }

  for (const [key, value] of Object.entries(obj)) {
    const path = `${prefix}.${key}`;
    if (value && typeof value === "object") {
      flattenNumeric(value, path, out);
      continue;
    }
    const number = parseNumber(value);
    if (number != null) out.push({ path, value: number });
  }
  return out;
}

function isMoneyLikePath(path) {
  if (/(^|\.|\])id[A-Z_]?|(^|\.)id$|codigo$/i.test(path)) return false;
  return /(valor|total|preco|frete|desconto|imposto|icms|ipi|iss|seguro|outras|faturado|produto|base|taxa|comissao|custo)/i.test(path);
}

function addGroup(groups, key, field, amount) {
  const group = groups.get(key) ?? { count: 0, sums: {} };
  group.count += 1;
  group.sums[field] = Number(group.sums[field] ?? 0) + Number(amount ?? 0);
  groups.set(key, group);
}

function addField(stats, path, amount) {
  const entry = stats.get(path) ?? { path, count: 0, sum: 0, min: null, max: null, money_like: isMoneyLikePath(path) };
  entry.count += 1;
  entry.sum += amount;
  entry.min = entry.min == null ? amount : Math.min(entry.min, amount);
  entry.max = entry.max == null ? amount : Math.max(entry.max, amount);
  stats.set(path, entry);
}

function isCanceled(row) {
  return String(row.status ?? "").trim() === "8";
}

function isStatus6(row) {
  return String(row.status ?? "").trim() === "6";
}

function statusSet(row, allowed) {
  return allowed.has(String(row.status ?? "").trim());
}

function getChannel(row) {
  return row.channel_name || row.integration_name || row.marketplace_name || row.raw_json?.ecommerce?.nome || row.raw_json?.ecommerce?.canalVenda || "(sem canal)";
}

function sanitizePayload(row) {
  const raw = row.raw_json ?? {};
  return {
    id: row.id,
    numero: raw.numero ?? row.invoice_number,
    situacao: raw.situacao ?? row.status,
    dataEmissao: raw.dataEmissao ?? row.emission_date,
    dataInclusao: raw.dataInclusao ?? null,
    dataPrevista: raw.dataPrevista ?? null,
    valor: raw.valor ?? null,
    valorProdutos: raw.valorProdutos ?? null,
    valorFrete: raw.valorFrete ?? null,
    valorDesconto: raw.valorDesconto ?? null,
    valorFaturado: raw.valorFaturado ?? null,
    valorNotaComImpostos: raw.valorNotaComImpostos ?? null,
    ecommerce: raw.ecommerce ?? null,
    cliente: {
      uf: raw.cliente?.endereco?.uf ?? raw.cliente?.uf ?? null
    }
  };
}

async function supabaseFetch(env, path, options = {}) {
  const serviceKey = requireEnv(env, ["SUPABASE_SERVICE_ROLE_KEY"]);
  const response = await fetch(`${requireEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]).replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Supabase request failed (${response.status}): ${text.slice(0, 500)}`);
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

async function fetchAll(env, path, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await supabaseFetch(env, `${path}${separator}limit=${pageSize}&offset=${offset}`);
    const batch = Array.isArray(page) ? page : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    if (offset > 0 && offset % 10000 === 0) {
      console.error(`[audit-olist-invoice-values] carregadas ${formatCount(rows.length)} NFs`);
    }
  }
  return rows;
}

async function main() {
  const env = loadEnv();
  const startDate = arg("start", "2026-06-01");
  const endDate = arg("end", "2026-06-19");
  const outputPath = arg("output", "docs/nf-faturada-value-reconciliation.md");
  const sampleSize = Number(arg("sample-size", "20"));

  const invoices = await fetchAll(
    env,
    `/rest/v1/olist_invoices?select=id,invoice_number,emission_date,status,status_label,total_amount,channel_name,integration_name,marketplace_name,order_number,raw_json&emission_date=gte.${startDate}&emission_date=lte.${endDate}T23:59:59&order=emission_date.asc,id.asc`
  );
  const itemRows = await fetchAll(env, "/rest/v1/olist_invoice_items?select=invoice_id,total_value");
  const itemInvoiceIds = new Set(itemRows.map((row) => String(row.invoice_id)));

  const numericStats = new Map();
  for (const row of invoices) {
    addField(numericStats, "total_amount", parseNumber(row.total_amount) ?? 0);
    for (const item of flattenNumeric(row.raw_json)) {
      addField(numericStats, item.path, item.value);
    }
  }

  const discoveredFields = Array.from(numericStats.values())
    .filter((entry) => entry.money_like || DEFAULT_MONEY_PATHS.includes(entry.path))
    .sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));

  const fieldsToCompare = Array.from(new Set([
    ...DEFAULT_MONEY_PATHS,
    ...discoveredFields.slice(0, 60).map((entry) => entry.path)
  ]));

  const scenarios = [
    { name: "status_6", label: "status = 6", predicate: isStatus6 },
    { name: "not_status_8", label: "status <> 8", predicate: (row) => !isCanceled(row) },
    { name: "status_6_7", label: "status in (6,7)", predicate: (row) => statusSet(row, new Set(["6", "7"])) },
    { name: "status_1_3_6_7", label: "status in (1,3,6,7)", predicate: (row) => statusSet(row, new Set(["1", "3", "6", "7"])) },
    { name: "status_6_only_linked", label: "status = 6 com pedido", predicate: (row) => isStatus6(row) && String(row.order_number ?? "").trim() !== "" },
    { name: "status_6_with_items", label: "status = 6 com item hidratado", predicate: (row) => isStatus6(row) && itemInvoiceIds.has(String(row.id)) }
  ];

  const scenarioRows = [];
  for (const scenario of scenarios) {
    const rows = invoices.filter(scenario.predicate);
    for (const field of fieldsToCompare) {
      let sum = 0;
      let count = 0;
      for (const row of rows) {
        const parsed = parseNumber(getPath(row, field));
        if (parsed == null) continue;
        sum += parsed;
        count += 1;
      }
      scenarioRows.push({
        scenario: scenario.label,
        field,
        invoice_count: rows.length,
        field_count: count,
        sum,
        count_delta: rows.length - EXPECTED_COUNT,
        count_delta_pct: Math.abs(rows.length - EXPECTED_COUNT) / EXPECTED_COUNT,
        value_delta: sum - EXPECTED_REVENUE,
        value_delta_pct: Math.abs(sum - EXPECTED_REVENUE) / EXPECTED_REVENUE
      });
    }
  }

  scenarioRows.sort((a, b) => {
    const aScore = a.count_delta_pct + a.value_delta_pct;
    const bScore = b.count_delta_pct + b.value_delta_pct;
    return aScore - bScore;
  });

  const statusGroups = new Map();
  const dayGroups = new Map();
  const channelGroups = new Map();
  const linkedGroups = new Map();
  const itemGroups = new Map();
  const datePathGroups = new Map();
  const baseField = "raw_json.valor";

  for (const row of invoices) {
    const amount = parseNumber(getPath(row, baseField)) ?? parseNumber(row.total_amount) ?? 0;
    addGroup(statusGroups, String(row.status ?? "(sem status)"), baseField, amount);
    addGroup(dayGroups, dateKey(row.emission_date), baseField, amount);
    addGroup(channelGroups, getChannel(row), baseField, amount);
    addGroup(linkedGroups, String(row.order_number ?? "").trim() ? "com pedido vinculado" : "sem pedido vinculado", baseField, amount);
    addGroup(itemGroups, itemInvoiceIds.has(String(row.id)) ? "com itens hidratados" : "sem itens hidratados", baseField, amount);

    for (const datePath of DATE_PATHS) {
      const value = getPath(row, datePath);
      if (!value) continue;
      const key = `${datePath}: ${inDateWindow(value, startDate, endDate) ? "dentro da janela" : "fora da janela"}`;
      addGroup(datePathGroups, key, baseField, amount);
    }
  }

  const sampleRows = invoices
    .filter((row) => isStatus6(row))
    .slice(0, sampleSize)
    .map((row) => ({
      invoice_number: row.invoice_number,
      api_status: row.status,
      api_emission_date: dateKey(row.emission_date),
      manual_screen_value: "preencher manualmente",
      saved_total_amount: row.total_amount,
      raw_valor: row.raw_json?.valor ?? null,
      raw_valorProdutos: row.raw_json?.valorProdutos ?? null,
      raw_valorFrete: row.raw_json?.valorFrete ?? null,
      raw_dataEmissao: row.raw_json?.dataEmissao ?? null,
      raw_dataInclusao: row.raw_json?.dataInclusao ?? null,
      order_number: row.order_number,
      sanitized_payload: sanitizePayload(row)
    }));

  const best = scenarioRows[0];
  const accepted = best.count_delta_pct < 0.005 && best.value_delta_pct < 0.005;

  function groupTable(groups, limit = 40) {
    return Array.from(groups.entries())
      .map(([key, value]) => ({ key, count: value.count, sum: value.sums[baseField] ?? 0 }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)))
      .slice(0, limit);
  }

  function mdTable(rows, columns) {
    const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
    const separator = `| ${columns.map(() => "---").join(" | ")} |`;
    const body = rows.map((row) => `| ${columns.map((column) => column.format ? column.format(row[column.key], row) : row[column.key]).join(" | ")} |`);
    return [header, separator, ...body].join("\n");
  }

  const markdown = [
    "# Reconciliação de Valores de NFs Olist",
    "",
    `Data da auditoria: ${new Date().toISOString()}`,
    `Período: ${startDate} a ${endDate}`,
    "",
    "## Critério Manual da Olist",
    "",
    `- NFs emitidas esperadas: ${formatCount(EXPECTED_COUNT)}`,
    `- Valor total esperado: ${formatMoney(EXPECTED_REVENUE)}`,
    "- Tolerância exigida: diferença menor que 0,5% em quantidade e valor.",
    "",
    "## Resultado Executivo",
    "",
    `- Melhor combinação encontrada: ${best.scenario} + ${best.field}`,
    `- Quantidade: ${formatCount(best.invoice_count)} (delta ${formatCount(best.count_delta)}, ${percent(best.count_delta_pct)})`,
    `- Valor: ${formatMoney(best.sum)} (delta ${formatMoney(best.value_delta)}, ${percent(best.value_delta_pct)})`,
    `- Aceite atingido: ${accepted ? "sim" : "não"}`,
    "",
    accepted
      ? "A combinação acima está dentro da tolerância estatística. Ainda assim, revisar a amostra manual antes de promover views oficiais."
      : "Nenhuma combinação bateu com a tolerância exigida. Não criar views oficiais nem migrar dashboard/margem/ROI.",
    "",
    "## Campos Monetários Encontrados",
    "",
    mdTable(discoveredFields.slice(0, 80), [
      { key: "path", label: "Campo" },
      { key: "count", label: "Qtde", format: formatCount },
      { key: "sum", label: "Soma", format: formatMoney },
      { key: "min", label: "Mín", format: formatMoney },
      { key: "max", label: "Máx", format: formatMoney }
    ]),
    "",
    "## Melhores Combinações Status + Campo de Valor",
    "",
    mdTable(scenarioRows.slice(0, 30), [
      { key: "scenario", label: "Cenário" },
      { key: "field", label: "Campo" },
      { key: "invoice_count", label: "NFs", format: formatCount },
      { key: "sum", label: "Soma", format: formatMoney },
      { key: "count_delta", label: "Delta Qtde", format: formatCount },
      { key: "count_delta_pct", label: "Delta Qtde %", format: percent },
      { key: "value_delta", label: "Delta Valor", format: formatMoney },
      { key: "value_delta_pct", label: "Delta Valor %", format: percent }
    ]),
    "",
    "## Quantidade e Soma por Status",
    "",
    mdTable(groupTable(statusGroups), [
      { key: "key", label: "Status" },
      { key: "count", label: "Qtde", format: formatCount },
      { key: "sum", label: "Soma raw_json.valor", format: formatMoney }
    ]),
    "",
    "## Quantidade e Soma por Data de Emissão",
    "",
    mdTable(groupTable(dayGroups, 80), [
      { key: "key", label: "Data" },
      { key: "count", label: "Qtde", format: formatCount },
      { key: "sum", label: "Soma raw_json.valor", format: formatMoney }
    ]),
    "",
    "## Quantidade e Soma por Integração/Canal",
    "",
    mdTable(groupTable(channelGroups, 80), [
      { key: "key", label: "Canal" },
      { key: "count", label: "Qtde", format: formatCount },
      { key: "sum", label: "Soma raw_json.valor", format: formatMoney }
    ]),
    "",
    "## Pedido Vinculado",
    "",
    mdTable(groupTable(linkedGroups), [
      { key: "key", label: "Grupo" },
      { key: "count", label: "Qtde", format: formatCount },
      { key: "sum", label: "Soma raw_json.valor", format: formatMoney }
    ]),
    "",
    "## Cobertura de Itens Hidratados",
    "",
    mdTable(groupTable(itemGroups), [
      { key: "key", label: "Grupo" },
      { key: "count", label: "Qtde", format: formatCount },
      { key: "sum", label: "Soma raw_json.valor", format: formatMoney }
    ]),
    "",
    "## Campos de Data Testados",
    "",
    mdTable(groupTable(datePathGroups, 80), [
      { key: "key", label: "Campo / Janela" },
      { key: "count", label: "Qtde", format: formatCount },
      { key: "sum", label: "Soma raw_json.valor", format: formatMoney }
    ]),
    "",
    "## Amostra de 20 NFs para Conferência Manual",
    "",
    "A coluna `manual_screen_value` precisa ser preenchida olhando a tela da Olist. O payload abaixo é sanitizado para evitar CPF/CNPJ e dados pessoais sensíveis no repositório.",
    "",
    mdTable(sampleRows, [
      { key: "invoice_number", label: "NF" },
      { key: "api_status", label: "Status API" },
      { key: "api_emission_date", label: "Data API" },
      { key: "manual_screen_value", label: "Valor Tela Olist" },
      { key: "raw_valor", label: "raw.valor", format: formatMoney },
      { key: "raw_valorProdutos", label: "raw.valorProdutos", format: formatMoney },
      { key: "raw_valorFrete", label: "raw.valorFrete", format: formatMoney },
      { key: "order_number", label: "Pedido" }
    ]),
    "",
    "<details>",
    "<summary>Payload sanitizado da amostra</summary>",
    "",
    "```json",
    JSON.stringify(sampleRows.map((row) => row.sanitized_payload), null, 2),
    "```",
    "",
    "</details>",
    "",
    "## Conclusão",
    "",
    accepted
      ? "Existe uma combinação candidata dentro da tolerância. Próximo passo: validar manualmente a amostra antes de criar views fiscais oficiais."
      : "A reconciliação ainda não atingiu a tolerância. Próximo passo: comparar a amostra de 20 NFs na tela Olist para descobrir se a divergência vem de data visual, status visual, campo financeiro ou atualização posterior da base.",
    "",
    "Enquanto não bater, manter a trava: não criar `oraculo_fiscal_daily_revenue`, `oraculo_fiscal_sku_sales`, `oraculo_fiscal_channel_sales` e não migrar dashboard/margem/ROI."
  ].join("\n");

  writeFileSync(outputPath, `${markdown}\n`);
  console.log(JSON.stringify({
    ok: true,
    output: outputPath,
    invoices: invoices.length,
    best: {
      scenario: best.scenario,
      field: best.field,
      count: best.invoice_count,
      sum: best.sum,
      count_delta_pct: best.count_delta_pct,
      value_delta_pct: best.value_delta_pct,
      accepted
    }
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
