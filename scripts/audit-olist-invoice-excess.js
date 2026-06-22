#!/usr/bin/env node

const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const EXPECTED_COUNT = 71197;
const EXPECTED_REVENUE = 5243629.96;

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
  if (value == null || typeof value === "boolean") return 0;
  const text = String(value).trim();
  if (!text) return 0;
  const normalized = text.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function formatCount(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value ?? 0));
}

function percent(value) {
  return `${Number(value * 100).toFixed(3)}%`;
}

function dateKey(value) {
  if (!value) return "";
  const text = String(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function clean(value, fallback = "") {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows, columns) {
  return [
    columns.map((column) => csvCell(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(","))
  ].join("\n");
}

function getPath(row, path) {
  if (path === "status") return row.status;
  if (path === "channel") return getChannel(row);
  if (path === "company") return getCompany(row);
  return path.split(".").reduce((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return current[part];
  }, row);
}

function getChannel(row) {
  return clean(row.raw_json?.ecommerce?.nome ?? row.integration_name ?? row.marketplace_name ?? row.channel_name, "(sem canal)");
}

function getCompany(row) {
  return clean(
    row.raw_json?.empresa?.nome ??
    row.raw_json?.loja?.nome ??
    row.raw_json?.conta?.nome ??
    row.raw_json?.unidade?.nome ??
    row.raw_json?.empresa ??
    row.raw_json?.loja ??
    "(sem empresa/loja)"
  );
}

function getNature(row) {
  return clean(
    row.raw_json?.naturezaOperacao ??
    row.raw_json?.finalidade ??
    row.raw_json?.tipo ??
    row.raw_json?.tipoNotaCredito ??
    row.raw_json?.tipoNotaDebito ??
    "(sem natureza)"
  );
}

function candidateFeature(row, feature) {
  if (feature === "status") return clean(row.status, "(sem status)");
  if (feature === "status_label") return clean(row.status_label, "(sem status desc)");
  if (feature === "channel") return getChannel(row);
  if (feature === "company") return getCompany(row);
  if (feature === "nature") return getNature(row);
  if (feature === "type") return clean(row.raw_json?.tipo, "(sem tipo)");
  if (feature === "finality") return clean(row.raw_json?.finalidade, "(sem finalidade)");
  if (feature === "origin") return clean(row.raw_json?.origem?.nome ?? row.raw_json?.origem, "(sem origem)");
  if (feature === "ecommerce_id") return clean(row.raw_json?.ecommerce?.id, "(sem ecommerce id)");
  if (feature === "ecommerce_name") return clean(row.raw_json?.ecommerce?.nome, "(sem ecommerce nome)");
  if (feature === "canal_venda") return clean(row.raw_json?.ecommerce?.canalVenda, "(sem canal venda)");
  if (feature === "uf") return clean(row.uf ?? row.raw_json?.cliente?.endereco?.uf ?? row.raw_json?.cliente?.uf, "(sem uf)");
  if (feature === "has_order") return clean(row.order_number) ? "com pedido" : "sem pedido";
  if (feature === "has_items") return row.has_items ? "com itens" : "sem itens";
  if (feature === "date_inclusao") return dateKey(row.raw_json?.dataInclusao) || "(sem dataInclusao)";
  if (feature === "date_prevista") return dateKey(row.raw_json?.dataPrevista) || "(sem dataPrevista)";
  return "(desconhecido)";
}

function summarize(rows) {
  return {
    count: rows.length,
    value: rows.reduce((sum, row) => sum + parseNumber(row.total_amount), 0)
  };
}

function score(summary) {
  return {
    count_delta: summary.count - EXPECTED_COUNT,
    value_delta: summary.value - EXPECTED_REVENUE,
    count_delta_pct: Math.abs(summary.count - EXPECTED_COUNT) / EXPECTED_COUNT,
    value_delta_pct: Math.abs(summary.value - EXPECTED_REVENUE) / EXPECTED_REVENUE,
    total_score: Math.abs(summary.count - EXPECTED_COUNT) / EXPECTED_COUNT + Math.abs(summary.value - EXPECTED_REVENUE) / EXPECTED_REVENUE
  };
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function mdTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => column.format ? column.format(row[column.key], row) : row[column.key]).join(" | ")} |`);
  return [header, separator, ...body].join("\n");
}

function categorizeFields(row) {
  const raw = row.raw_json ?? {};
  const keys = new Set();
  function visit(value, prefix = "raw_json", depth = 0) {
    if (!value || typeof value !== "object" || depth > 2) return;
    if (Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const path = `${prefix}.${key}`;
      if (child == null) continue;
      if (typeof child === "object") {
        visit(child, path, depth + 1);
        continue;
      }
      if (typeof child === "boolean") keys.add(path);
      if (typeof child === "string" && child.trim() && child.length <= 80) keys.add(path);
      if (typeof child === "number" && /tipo|status|situacao|modelo|ambiente|finalidade|regime|forma|meio|id/i.test(path)) keys.add(path);
    }
  }
  visit(raw);
  return Array.from(keys);
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
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function fetchAll(env, path, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await supabaseFetch(env, `${path}${separator}limit=${pageSize}&offset=${offset}`);
    rows.push(...(Array.isArray(batch) ? batch : []));
    if (!Array.isArray(batch) || batch.length < pageSize) break;
    if (offset > 0 && offset % 10000 === 0) {
      console.error(`[audit-olist-invoice-excess] carregadas ${formatCount(rows.length)} NFs`);
    }
  }
  return rows;
}

async function main() {
  const env = loadEnv();
  const startDate = arg("start", "2026-06-01");
  const endDate = arg("end", "2026-06-19");
  const csvPath = arg("csv", `reports/olist-invoice-reconciliation-excess-${startDate}-${endDate}.csv`);
  const docPath = arg("doc", "docs/nf-faturada-value-reconciliation.md");

  const invoices = await fetchAll(
    env,
    `/rest/v1/olist_invoices?select=id,invoice_number,emission_date,status,status_label,total_amount,channel_name,integration_name,marketplace_name,order_number,client_name,uf,raw_json&emission_date=gte.${startDate}&emission_date=lte.${endDate}T23:59:59&order=emission_date.asc,id.asc`
  );
  const itemRows = await fetchAll(env, "/rest/v1/olist_invoice_items?select=invoice_id");
  const itemInvoiceIds = new Set(itemRows.map((row) => String(row.invoice_id)));
  for (const row of invoices) row.has_items = itemInvoiceIds.has(String(row.id));

  const status67 = invoices.filter((row) => ["6", "7"].includes(String(row.status ?? "")));
  const status6 = invoices.filter((row) => String(row.status ?? "") === "6");
  const status7 = invoices.filter((row) => String(row.status ?? "") === "7");
  const status8 = invoices.filter((row) => String(row.status ?? "") === "8");
  const otherStatus = invoices.filter((row) => !["6", "7", "8"].includes(String(row.status ?? "")));

  const featureNames = [
    "status",
    "status_label",
    "channel",
    "company",
    "nature",
    "type",
    "finality",
    "origin",
    "ecommerce_id",
    "ecommerce_name",
    "canal_venda",
    "uf",
    "has_order",
    "has_items",
    "date_inclusao",
    "date_prevista"
  ];

  const candidateCategoricalPaths = new Set();
  for (const row of status67.slice(0, 500)) {
    for (const path of categorizeFields(row)) candidateCategoricalPaths.add(path);
  }

  const baseSummary = summarize(status67);
  const baseScore = score(baseSummary);
  const candidates = [];

  function pushCandidate(label, rows, excludedRows = []) {
    const summary = summarize(rows);
    const currentScore = score(summary);
    candidates.push({
      label,
      count: summary.count,
      value: summary.value,
      count_delta: currentScore.count_delta,
      value_delta: currentScore.value_delta,
      count_delta_pct: currentScore.count_delta_pct,
      value_delta_pct: currentScore.value_delta_pct,
      total_score: currentScore.total_score,
      excluded_count: excludedRows.length,
      excluded_value: excludedRows.reduce((sum, row) => sum + parseNumber(row.total_amount), 0)
    });
  }

  pushCandidate("status in (6,7)", status67);
  pushCandidate("status = 6", status6, status7);
  pushCandidate("status = 6 com pedido", status6.filter((row) => clean(row.order_number)), status6.filter((row) => !clean(row.order_number)));
  pushCandidate("status in (6,7) com pedido", status67.filter((row) => clean(row.order_number)), status67.filter((row) => !clean(row.order_number)));

  for (const feature of featureNames) {
    const groups = groupBy(status67, (row) => candidateFeature(row, feature));
    for (const [key, rows] of groups) {
      const without = status67.filter((row) => candidateFeature(row, feature) !== key);
      pushCandidate(`status in (6,7) excluindo ${feature}=${key}`, without, rows);
      pushCandidate(`somente ${feature}=${key}`, rows, status67.filter((row) => candidateFeature(row, feature) !== key));
    }
  }

  for (const path of Array.from(candidateCategoricalPaths).slice(0, 120)) {
    const groups = groupBy(status67, (row) => clean(getPath(row, path), "(vazio)"));
    if (groups.size < 2 || groups.size > 80) continue;
    for (const [key, rows] of groups) {
      const without = status67.filter((row) => clean(getPath(row, path), "(vazio)") !== key);
      pushCandidate(`status in (6,7) excluindo ${path}=${key}`, without, rows);
    }
  }

  candidates.sort((a, b) => a.total_score - b.total_score);
  const best = candidates[0];

  const bestExcluded = (() => {
    const label = best.label;
    const match = label.match(/^status in \(6,7\) excluindo ([^=]+)=(.*)$/);
    if (!match) return status67
      .slice()
      .sort((a, b) => parseNumber(b.total_amount) - parseNumber(a.total_amount))
      .slice(0, Math.max(731, 1000));
    const featureOrPath = match[1];
    const value = match[2];
    return status67.filter((row) => {
      const current = featureNames.includes(featureOrPath)
        ? candidateFeature(row, featureOrPath)
        : clean(getPath(row, featureOrPath), "(vazio)");
      return current === value;
    });
  })();

  mkdirSync(dirname(csvPath), { recursive: true });
  writeFileSync(csvPath, `${toCsv(bestExcluded, [
    { label: "numero_nf", value: (row) => row.invoice_number },
    { label: "data_emissao", value: (row) => dateKey(row.emission_date) },
    { label: "status", value: (row) => row.status },
    { label: "status_descricao", value: (row) => row.status_label },
    { label: "integracao_canal", value: getChannel },
    { label: "cliente", value: (row) => row.client_name },
    { label: "uf", value: (row) => row.uf ?? row.raw_json?.cliente?.endereco?.uf ?? row.raw_json?.cliente?.uf },
    { label: "valor", value: (row) => row.total_amount },
    { label: "numero_pedido", value: (row) => row.order_number },
    { label: "empresa_loja", value: getCompany },
    { label: "tipo", value: (row) => row.raw_json?.tipo },
    { label: "finalidade", value: (row) => row.raw_json?.finalidade },
    { label: "natureza_operacao", value: (row) => row.raw_json?.naturezaOperacao },
    { label: "origem", value: (row) => typeof row.raw_json?.origem === "object" ? JSON.stringify(row.raw_json.origem) : row.raw_json?.origem },
    { label: "ecommerce_id", value: (row) => row.raw_json?.ecommerce?.id },
    { label: "ecommerce_nome", value: (row) => row.raw_json?.ecommerce?.nome },
    { label: "data_inclusao", value: (row) => row.raw_json?.dataInclusao },
    { label: "data_prevista", value: (row) => row.raw_json?.dataPrevista },
    { label: "valor_produtos", value: (row) => row.raw_json?.valorProdutos },
    { label: "valor_frete", value: (row) => row.raw_json?.valorFrete },
    { label: "valor_desconto", value: (row) => row.raw_json?.valorDesconto }
  ])}\n`);

  function summaryRows(rowsByGroup) {
    return Array.from(rowsByGroup.entries()).map(([key, rows]) => {
      const summary = summarize(rows);
      return { key, count: summary.count, value: summary.value };
    }).sort((a, b) => b.value - a.value);
  }

  const statusRows = summaryRows(groupBy(invoices, (row) => clean(row.status, "(sem status)")));
  const channelStatusRows = summaryRows(groupBy(invoices, (row) => `${getChannel(row)} / status ${row.status}`));
  const companyRows = summaryRows(groupBy(invoices, getCompany));
  const natureRows = summaryRows(groupBy(invoices, getNature));
  const typeRows = summaryRows(groupBy(invoices, (row) => clean(row.raw_json?.tipo, "(sem tipo)")));
  const finalityRows = summaryRows(groupBy(invoices, (row) => clean(row.raw_json?.finalidade, "(sem finalidade)")));
  const originRows = summaryRows(groupBy(invoices, (row) => clean(typeof row.raw_json?.origem === "object" ? JSON.stringify(row.raw_json.origem) : row.raw_json?.origem, "(sem origem)")));

  function table(rows, limit = 40) {
    return mdTable(rows.slice(0, limit), [
      { key: "key", label: "Grupo" },
      { key: "count", label: "Qtde", format: formatCount },
      { key: "value", label: "Valor", format: formatMoney }
    ]);
  }

  const section = [
    "",
    "## Investigação de Notas Excedentes",
    "",
    `Arquivo CSV de possíveis excedentes: \`${csvPath}\``,
    "",
    "### Base Comparada",
    "",
    `- Base API candidata: status in (6,7): ${formatCount(baseSummary.count)} NFs, ${formatMoney(baseSummary.value)}.`,
    `- Alvo tela Olist: ${formatCount(EXPECTED_COUNT)} NFs, ${formatMoney(EXPECTED_REVENUE)}.`,
    `- Delta da base candidata: ${formatCount(baseScore.count_delta)} NFs, ${formatMoney(baseScore.value_delta)}.`,
    "",
    "### Status Separados",
    "",
    `- status 6: ${formatCount(status6.length)} NFs, ${formatMoney(summarize(status6).value)}.`,
    `- status 7: ${formatCount(status7.length)} NFs, ${formatMoney(summarize(status7).value)}.`,
    `- status 8: ${formatCount(status8.length)} NFs, ${formatMoney(summarize(status8).value)}.`,
    `- demais status: ${formatCount(otherStatus.length)} NFs, ${formatMoney(summarize(otherStatus).value)}.`,
    "",
    "### Melhor Filtro Encontrado",
    "",
    `- Filtro: ${best.label}`,
    `- Resultado: ${formatCount(best.count)} NFs, ${formatMoney(best.value)}.`,
    `- Delta quantidade: ${formatCount(best.count_delta)} (${percent(best.count_delta_pct)}).`,
    `- Delta valor: ${formatMoney(best.value_delta)} (${percent(best.value_delta_pct)}).`,
    `- Registros excluídos por esse filtro: ${formatCount(best.excluded_count)} NFs, ${formatMoney(best.excluded_value)}.`,
    "",
    best.count_delta_pct < 0.005 && best.value_delta_pct < 0.005
      ? "Esse filtro atinge o critério de aceite estatístico. Ainda precisa validação manual em tela antes de criar views oficiais."
      : "Nenhum filtro categórico encontrado atingiu a tolerância de 0,5%. O CSV lista as notas candidatas a excedente para conferência manual.",
    "",
    "### Combinações Mais Próximas",
    "",
    mdTable(candidates.slice(0, 30), [
      { key: "label", label: "Filtro" },
      { key: "count", label: "Qtde", format: formatCount },
      { key: "value", label: "Valor", format: formatMoney },
      { key: "count_delta", label: "Delta Qtde", format: formatCount },
      { key: "count_delta_pct", label: "Delta Qtde %", format: percent },
      { key: "value_delta", label: "Delta Valor", format: formatMoney },
      { key: "value_delta_pct", label: "Delta Valor %", format: percent },
      { key: "excluded_count", label: "Excluídas", format: formatCount },
      { key: "excluded_value", label: "Valor Excluído", format: formatMoney }
    ]),
    "",
    "### Agrupamento por Status",
    "",
    table(statusRows),
    "",
    "### Agrupamento por Integração/Canal e Status",
    "",
    table(channelStatusRows, 80),
    "",
    "### Agrupamento por Empresa/Conta/Loja",
    "",
    table(companyRows, 80),
    "",
    "### Agrupamento por Tipo/Natureza/Finalidade/Origem",
    "",
    "Natureza:",
    "",
    table(natureRows, 80),
    "",
    "Tipo:",
    "",
    table(typeRows, 40),
    "",
    "Finalidade:",
    "",
    table(finalityRows, 40),
    "",
    "Origem:",
    "",
    table(originRows, 80),
    "",
    "### Conclusão da Investigação de Excedentes",
    "",
    best.count_delta_pct < 0.005 && best.value_delta_pct < 0.005
      ? "Foi encontrado um filtro candidato dentro da tolerância. Não promover para views oficiais até a conferência manual confirmar que essas notas realmente não aparecem na aba emitidas da Olist."
      : "A API continua trazendo notas além da tela sem um filtro categórico único suficiente. A próxima validação precisa comparar manualmente o CSV de excedentes contra a tela da Olist para identificar qual campo visual não está exposto de forma direta no payload.",
    "",
    "Mantida a trava: não criar views fiscais oficiais e não migrar dashboard, margem, ROI ou SKUs."
  ].join("\n");

  const currentDoc = readFileSync(docPath, "utf8");
  const marker = "\n## Investigação de Notas Excedentes\n";
  const cleaned = currentDoc.includes(marker) ? currentDoc.slice(0, currentDoc.indexOf(marker)) : currentDoc;
  writeFileSync(docPath, `${cleaned.trimEnd()}\n${section}\n`);

  console.log(JSON.stringify({
    ok: true,
    csv: csvPath,
    doc: docPath,
    base: baseSummary,
    best: {
      label: best.label,
      count: best.count,
      value: best.value,
      count_delta_pct: best.count_delta_pct,
      value_delta_pct: best.value_delta_pct,
      accepted: best.count_delta_pct < 0.005 && best.value_delta_pct < 0.005
    },
    excess_rows_exported: bestExcluded.length
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
