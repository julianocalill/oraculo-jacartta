#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const MANUAL_EXPECTED_COUNT = 71197;
const MANUAL_EXPECTED_REVENUE = 5243629.96;

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
    // CI or local shells may already provide the required variables.
  }
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

function requireEnv(env, keys) {
  for (const key of keys) {
    if (env[key]) return env[key];
  }
  throw new Error(`Missing required environment variable. Tried: ${keys.join(", ")}`);
}

function money(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2
  }).format(Number(value ?? 0));
}

function count(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value ?? 0));
}

function normalizeDateForFilter(dateKey, exclusiveEnd = false) {
  if (!exclusiveEnd) return dateKey;
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  const normalized = text
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => {
      if (!current || typeof current !== "object") return undefined;
      return current[part];
    }, row);
    if (value != null && String(value).trim() !== "") return value;
  }
  return null;
}

function normalizeRows(payload) {
  const container = payload && typeof payload === "object" ? payload : {};
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(container.itens)
      ? container.itens
      : Array.isArray(container.items)
        ? container.items
        : Array.isArray(container.data)
          ? container.data
          : Array.isArray(container.notas)
            ? container.notas
            : Array.isArray(container.notasFiscais)
              ? container.notasFiscais
              : Array.isArray(container.nfes)
                ? container.nfes
                : [];

  return rows.filter((row) => row && typeof row === "object");
}

function normalizeItems(row) {
  const items = firstValue(row, ["itens", "items", "produtos", "notaFiscal.itens", "nfe.itens"]);
  return Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : [];
}

function normalizeInvoice(row) {
  const invoiceNumber = firstValue(row, [
    "numero",
    "numeroNotaFiscal",
    "numeroNfe",
    "numeroNF",
    "notaFiscal.numero",
    "nfe.numero"
  ]);
  const accessKey = firstValue(row, [
    "chaveAcesso",
    "chave_acesso",
    "chaveAcessoNfe",
    "notaFiscal.chaveAcesso",
    "nfe.chaveAcesso"
  ]);
  const rawId = firstValue(row, ["id", "codigo", "idNotaFiscal", "idNfe", "notaFiscal.id", "nfe.id"]);
  const id = String(rawId ?? accessKey ?? invoiceNumber ?? "").trim();
  if (!id) return null;

  const totalAmount = parseNumber(firstValue(row, [
    "valor",
    "valorTotal",
    "valor_total",
    "valorTotalNota",
    "valorNota",
    "total",
    "valorNotaComImpostos",
    "notaFiscal.valorTotal",
    "nfe.valorTotal"
  ]));

  return {
    id,
    invoice_number: invoiceNumber == null ? null : String(invoiceNumber),
    invoice_series: firstValue(row, ["serie", "serieNotaFiscal", "notaFiscal.serie", "nfe.serie"]),
    emission_date: firstValue(row, ["dataEmissao", "data_emissao", "emissao", "data", "notaFiscal.dataEmissao", "nfe.dataEmissao"]),
    cancellation_date: firstValue(row, ["dataCancelamento", "data_cancelamento", "notaFiscal.dataCancelamento", "nfe.dataCancelamento"]),
    status: firstValue(row, ["situacao", "status", "statusNotaFiscal", "notaFiscal.status", "nfe.status"]),
    status_label: firstValue(row, ["descricaoSituacao", "statusDescricao", "situacaoDescricao", "notaFiscal.descricaoSituacao"]),
    client_name: firstValue(row, ["cliente.nome", "cliente.razaoSocial", "nomeCliente", "cliente", "destinatario.nome"]),
    client_document: firstValue(row, ["cliente.cpfCnpj", "cliente.cnpj", "cliente.cpf", "documentoCliente", "destinatario.cpfCnpj"]),
    uf: firstValue(row, ["cliente.endereco.uf", "cliente.uf", "enderecoEntrega.uf", "uf", "estado", "destinatario.uf", "destinatario.endereco.uf"]),
    total_amount: totalAmount,
    channel_name: firstValue(row, ["ecommerce.canalVenda", "canal", "canalVenda", "marketplace.nome"]),
    integration_name: firstValue(row, ["ecommerce.nome", "integracao", "integracao.nome", "origem.nome", "fonte"]),
    marketplace_name: firstValue(row, ["ecommerce.nome", "marketplace", "marketplace.nome"]),
    order_id: firstValue(row, ["pedido.id", "idPedido", "pedidoId", "idPedidoEcommerce"]),
    order_number: firstValue(row, [
      "ecommerce.numeroPedidoEcommerce",
      "ecommerce.numeroPedidoCanalVenda",
      "pedido.numero",
      "numeroPedido",
      "numero_pedido",
      "pedido.numeroPedido"
    ]),
    access_key: accessKey == null ? null : String(accessKey),
    raw_json: row,
    synced_at: new Date().toISOString()
  };
}

function normalizeInvoiceItems(invoice, row) {
  return normalizeItems(row).map((item, index) => {
    const itemId = firstValue(item, ["idItem", "id", "codigoItem"]);
    const productId = firstValue(item, ["idProduto", "produto.id", "produtoId", "codigoProduto"]);
    const sku = firstValue(item, ["codigo", "produto.codigo", "sku", "codigoProduto", "produto.sku"]);
    const quantity = parseNumber(firstValue(item, ["quantidade", "qtde", "qtd"]));
    const unitValue = parseNumber(firstValue(item, ["valorUnitario", "valor_unitario", "preco", "valor"]));
    const totalValue = parseNumber(firstValue(item, ["valorTotal", "valor_total", "total"]));

    return {
      id: `${invoice.id}:${itemId ?? index + 1}`,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      line_number: index + 1,
      product_id: productId == null ? null : String(productId),
      sku: sku == null ? null : String(sku),
      description: firstValue(item, ["descricao", "nome", "produto.nome", "produto.descricao"]),
      quantity,
      unit_value: unitValue,
      total_value: totalValue || quantity * unitValue,
      raw_json: item,
      synced_at: new Date().toISOString()
    };
  });
}

function normalizeStatusKey(status) {
  const key = String(status ?? "").trim();
  return key || "(sem status)";
}

function isCanceledInvoice(invoice) {
  const status = normalizeStatusKey(invoice.status).toLowerCase();
  const label = normalizeStatusKey(invoice.status_label).toLowerCase();
  return status === "8" || label.includes("cancel");
}

function isEmittedInvoice(invoice) {
  return normalizeStatusKey(invoice.status) === "6";
}

async function supabaseFetch(env, path, options = {}) {
  const supabaseUrl = requireEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceKey = requireEnv(env, ["SUPABASE_SERVICE_ROLE_KEY"]);
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
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

async function supabaseFetchAll(env, path, pageSize = 1000) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await supabaseFetch(env, `${path}${separator}limit=${pageSize}&offset=${offset}`);
    const batch = Array.isArray(page) ? page : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function getStoredRefreshToken(env) {
  const rows = await supabaseFetch(env, "/rest/v1/olist_oauth_tokens?provider=eq.olist&select=refresh_token&limit=1");
  return rows?.[0]?.refresh_token ?? "";
}

async function getAccessToken(env) {
  if (env.OLIST_API_BEARER_TOKEN) return env.OLIST_API_BEARER_TOKEN;

  const tokenUrl = requireEnv(env, ["OLIST_API_TOKEN_URL"]);
  const clientId = requireEnv(env, ["OLIST_API_CLIENT_ID"]);
  const clientSecret = requireEnv(env, ["OLIST_API_CLIENT_SECRET"]);
  const refreshToken = env.OLIST_API_REFRESH_TOKEN || await getStoredRefreshToken(env);
  if (!refreshToken) throw new Error("Missing OLIST_API_REFRESH_TOKEN and no stored Olist token was found.");

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Falha ao renovar token da Olist (${response.status}): ${text.slice(0, 300)}`);
  }
  if (!payload.access_token) throw new Error("A resposta de token da Olist nao trouxe access_token.");
  return payload.access_token;
}

function olistHeaders(env, accessToken) {
  const header = env.OLIST_API_AUTH_HEADER || "Authorization";
  const prefix = env.OLIST_API_AUTH_PREFIX == null ? "Bearer" : env.OLIST_API_AUTH_PREFIX;
  return {
    Accept: "application/json",
    [header]: prefix ? `${prefix} ${accessToken}` : accessToken
  };
}

async function fetchOlistInvoicePage(env, accessToken, endpoint, startDate, endDate, offset, limit) {
  const baseUrl = requireEnv(env, ["OLIST_API_BASE_URL"]).endsWith("/")
    ? env.OLIST_API_BASE_URL
    : `${env.OLIST_API_BASE_URL}/`;
  const url = new URL(endpoint.replace(/^\//, ""), baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("orderBy", "desc");
  url.searchParams.set("dataInicial", startDate);
  url.searchParams.set("dataFinal", endDate);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(url, { headers: olistHeaders(env, accessToken) });
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : {};

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    const error = new Error(`Olist ${endpoint} failed (${response.status}): ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }

  const error = new Error(`Olist ${endpoint} failed (429): limite de taxa excedido`);
  error.status = 429;
  throw error;
}

async function fetchOlistInvoiceDetail(env, accessToken, endpoint, invoiceId) {
  const baseUrl = requireEnv(env, ["OLIST_API_BASE_URL"]).endsWith("/")
    ? env.OLIST_API_BASE_URL
    : `${env.OLIST_API_BASE_URL}/`;
  const url = new URL(`${endpoint.replace(/^\//, "")}/${encodeURIComponent(invoiceId)}`, baseUrl);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, { headers: olistHeaders(env, accessToken) });
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : {};

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }

    const error = new Error(`Olist ${endpoint}/${invoiceId} failed (${response.status}): ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }

  const error = new Error(`Olist ${endpoint}/${invoiceId} failed (429): limite de taxa excedido`);
  error.status = 429;
  throw error;
}

async function discoverEndpoint(env, accessToken, startDate, endDate) {
  const configured = arg("endpoint", "");
  const candidates = configured
    ? [configured]
    : ["notas-fiscais", "notas", "nfe", "nfes", "notas-fiscais/nfe"];

  const attempts = [];
  for (const endpoint of candidates) {
    try {
      const payload = await fetchOlistInvoicePage(env, accessToken, endpoint, startDate, endDate, 0, 1);
      const rows = normalizeRows(payload);
      attempts.push({ endpoint, ok: true, rows: rows.length, keys: Object.keys(payload ?? {}).slice(0, 20) });
      if (rows.length > 0 || configured) return { endpoint, attempts };
    } catch (error) {
      attempts.push({
        endpoint,
        ok: false,
        status: error.status ?? null,
        error: error.message
      });
    }
  }
  return { endpoint: "", attempts };
}

async function fetchDirectOlistInvoices(env, accessToken, endpoint, startDate, endDate, maxPages) {
  const limit = Number(arg("limit", "100"));
  const pageDelayMs = Number(arg("page-delay-ms", "250"));
  const progressEvery = Number(arg("progress-every", "0"));
  const shouldHydrateDetails = hasFlag("hydrate-details");
  const detailDelayMs = Number(arg("detail-delay-ms", "250"));
  let offset = 0;
  const invoices = [];
  const invoiceItems = [];
  const rawRows = [];
  let pagination = null;
  let detailErrors = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchOlistInvoicePage(env, accessToken, endpoint, startDate, endDate, offset, limit);
    if (!pagination && payload && typeof payload === "object" && payload.paginacao) {
      pagination = payload.paginacao;
    }
    const rows = normalizeRows(payload);
    rawRows.push(...rows);
    if (rows.length === 0) break;

    for (const row of rows) {
      let sourceRow = row;
      const preliminaryInvoice = normalizeInvoice(row);
      if (shouldHydrateDetails && preliminaryInvoice?.id) {
        try {
          if (detailDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, detailDelayMs));
          const detailPayload = await fetchOlistInvoiceDetail(env, accessToken, endpoint, preliminaryInvoice.id);
          sourceRow = detailPayload && typeof detailPayload === "object" ? detailPayload : row;
        } catch {
          detailErrors += 1;
        }
      }

      const invoice = normalizeInvoice(sourceRow);
      if (!invoice) continue;
      invoices.push(invoice);
      invoiceItems.push(...normalizeInvoiceItems(invoice, sourceRow));
    }

    offset += rows.length;
    if (progressEvery > 0 && (page + 1) % progressEvery === 0) {
      console.error(`[audit-olist-invoices] paginas=${page + 1} registros=${invoices.length} offset=${offset}`);
    }
    if (rows.length < limit) break;
    if (pageDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
    }
  }

  return { invoices, invoiceItems, rawRows, pagination, detailErrors };
}

async function summarizeCurrentOrders(env, startDate, endDate) {
  const totals = { count: 0, revenue: 0 };
  for (let current = startDate; current <= endDate; current = addDays(current, 1)) {
    const snapshot = await supabaseFetch(env, "/rest/v1/rpc/oraculo_reconciliation_snapshot", {
      method: "POST",
      body: JSON.stringify({
        p_start_date: current,
        p_end_date: current
      })
    });
    const billed = snapshot?.olist_by_nf_billing_date ?? {};
    totals.count += Number(billed.nf_emitted_count ?? 0);
    totals.revenue += parseNumber(billed.nf_confirmed_revenue);
  }
  return totals;
}

async function summarizeCanonicalInvoices(env, startDate, endDate) {
  try {
    const exclusiveEnd = normalizeDateForFilter(endDate, true);
    const rows = await supabaseFetchAll(
      env,
      `/rest/v1/olist_invoices?select=id,total_amount,status,status_label,emission_date,order_number&emission_date=gte.${startDate}&emission_date=lt.${exclusiveEnd}&order=emission_date.asc,id.asc`
    );
    const invoices = rows ?? [];
    const emitted = invoices.filter((row) => isEmittedInvoice(row));
    const canceled = invoices.filter((row) => isCanceledInvoice(row));
    const invoiceIds = new Set(invoices.map((row) => String(row.id)));
    const itemRows = await supabaseFetchAll(
      env,
      "/rest/v1/olist_invoice_items?select=invoice_id"
    );
    const itemInvoiceIds = new Set(
      (itemRows ?? [])
        .map((row) => String(row.invoice_id))
        .filter((invoiceId) => invoiceIds.has(invoiceId))
    );
    return {
      exists: true,
      count: emitted.length,
      revenue: emitted.reduce((sum, row) => sum + parseNumber(row.total_amount), 0),
      total_count: invoices.length,
      canceled_count: canceled.length,
      canceled_revenue: canceled.reduce((sum, row) => sum + parseNumber(row.total_amount), 0),
      status_counts: invoices.reduce((acc, row) => {
        const key = normalizeStatusKey(row.status_label ?? row.status);
        acc[key] = Number(acc[key] ?? 0) + 1;
        return acc;
      }, {}),
      order_linked_count: invoices.filter((row) => row.order_number != null && String(row.order_number).trim() !== "").length,
      item_invoice_count: itemInvoiceIds.size
    };
  } catch (error) {
    if (error.status === 404) return { exists: false, count: 0, revenue: 0 };
    throw error;
  }
}

async function persistInvoices(env, endpoint, startDate, endDate, invoices, invoiceItems) {
  const run = await supabaseFetch(env, "/rest/v1/olist_invoice_sync_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      status: "running",
      endpoint,
      window_start: startDate,
      window_end: endDate,
      records_fetched: invoices.length,
      metadata: { source: "scripts/audit-olist-invoices.js" }
    }])
  });
  const runId = run?.[0]?.id;

  try {
    for (let index = 0; index < invoices.length; index += 500) {
      const batch = invoices.slice(index, index + 500);
      await supabaseFetch(env, "/rest/v1/olist_invoices?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(batch)
      });
    }

    for (let index = 0; index < invoiceItems.length; index += 500) {
      const batch = invoiceItems.slice(index, index + 500);
      await supabaseFetch(env, "/rest/v1/olist_invoice_items?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(batch)
      });
    }

    if (runId) {
      await supabaseFetch(env, `/rest/v1/olist_invoice_sync_runs?id=eq.${runId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "success",
          finished_at: new Date().toISOString(),
          records_upserted: invoices.length,
          items_upserted: invoiceItems.length
        })
      });
    }
  } catch (error) {
    if (runId) {
      await supabaseFetch(env, `/rest/v1/olist_invoice_sync_runs?id=eq.${runId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "failed",
          finished_at: new Date().toISOString(),
          error_message: error.message
        })
      }).catch(() => null);
    }
    throw error;
  }
}

function printSummary(summary) {
  console.log(`Periodo fiscal auditado: ${summary.startDate} a ${summary.endDate}`);
  console.log("");
  console.log("Esperado manual da tela Olist");
  console.log(`- NFs emitidas: ${count(MANUAL_EXPECTED_COUNT)}`);
  console.log(`- Valor total: ${money(MANUAL_EXPECTED_REVENUE)}`);
  console.log("");
  console.log("Supabase atual por dataFaturamento em olist_orders");
  console.log(`- Registros com dataFaturamento: ${count(summary.orders.count)}`);
  console.log(`- Receita inferida de pedidos: ${money(summary.orders.revenue)}`);
  console.log(`- Gap de NFs vs Olist: ${count(MANUAL_EXPECTED_COUNT - summary.orders.count)}`);
  console.log(`- Gap de receita vs Olist: ${money(MANUAL_EXPECTED_REVENUE - summary.orders.revenue)}`);
  console.log("");
  console.log("Tabela canonica olist_invoices");
  console.log(`- Existe no banco: ${summary.canonical.exists ? "sim" : "nao"}`);
  console.log(`- NFs totais salvas: ${count(summary.canonical.total_count)}`);
  console.log(`- NFs emitidas salvas: ${count(summary.canonical.count)}`);
  console.log(`- NFs canceladas salvas: ${count(summary.canonical.canceled_count)}`);
  console.log(`- Receita salva: ${money(summary.canonical.revenue)}`);
  console.log(`- Receita cancelada salva: ${money(summary.canonical.canceled_revenue)}`);
  console.log(`- Status salvos: ${JSON.stringify(summary.canonical.status_counts ?? {})}`);
  console.log(`- NFs com vinculo de pedido: ${count(summary.canonical.order_linked_count)}`);
  console.log(`- NFs com itens salvos: ${count(summary.canonical.item_invoice_count)}`);
  console.log("");
  console.log("Endpoint fiscal Olist");
  console.log(`- Endpoint selecionado: ${summary.endpoint || "nao identificado"}`);
  for (const attempt of summary.attempts) {
    const suffix = attempt.ok
      ? `ok, ${attempt.rows} linha(s), chaves: ${(attempt.keys ?? []).join(", ")}`
      : `falhou${attempt.status ? ` ${attempt.status}` : ""}: ${attempt.error}`;
    console.log(`- ${attempt.endpoint}: ${suffix}`);
  }
  if (summary.direct) {
    console.log("");
    console.log("Leitura direta do endpoint fiscal");
    console.log(`- NFs lidas totais: ${count(summary.direct.count)}`);
    console.log(`- NFs emitidas lidas: ${count(summary.direct.emittedCount)}`);
    console.log(`- NFs canceladas lidas: ${count(summary.direct.canceledCount)}`);
    console.log(`- Receita emitida lida: ${money(summary.direct.emittedRevenue)}`);
    console.log(`- Itens de NF lidos: ${count(summary.direct.items)}`);
    console.log(`- NFs lidas com vinculo de pedido: ${count(summary.direct.orderLinkedCount)}`);
    if (summary.direct.detailErrors) {
      console.log(`- Erros ao hidratar detalhe: ${count(summary.direct.detailErrors)}`);
    }
    if (summary.direct.pagination) {
      console.log(`- Paginacao API: ${JSON.stringify(summary.direct.pagination)}`);
    }
    if (summary.direct.statusCounts) {
      console.log(`- Status lidos: ${JSON.stringify(summary.direct.statusCounts)}`);
    }
    console.log(`- Gap de NFs emitidas vs Olist manual: ${count(MANUAL_EXPECTED_COUNT - summary.direct.emittedCount)}`);
    console.log(`- Gap de receita emitida vs Olist manual: ${money(MANUAL_EXPECTED_REVENUE - summary.direct.emittedRevenue)}`);
  }
  console.log("");
  console.log("Conclusao");
  console.log("- dataFaturamento em olist_orders nao representa a tela fiscal de Notas Fiscais.");
  console.log("- As metricas oficiais devem migrar somente depois que o endpoint fiscal e a tabela canonica baterem com a Olist.");
}

async function main() {
  const env = loadEnv();
  const startDate = arg("start", "2026-06-01");
  const endDate = arg("end", "2026-06-19");
  const maxPages = Number(arg("max-pages", "1000"));
  const skipDirect = hasFlag("skip-direct");
  const persist = hasFlag("persist");

  const orders = await summarizeCurrentOrders(env, startDate, endDate);
  const canonical = await summarizeCanonicalInvoices(env, startDate, endDate);
  const accessToken = await getAccessToken(env);
  const discovery = await discoverEndpoint(env, accessToken, startDate, endDate);

  let direct = null;
  if (discovery.endpoint && !skipDirect) {
    const result = await fetchDirectOlistInvoices(env, accessToken, discovery.endpoint, startDate, endDate, maxPages);
    const emittedInvoices = result.invoices.filter((row) => isEmittedInvoice(row));
    const canceledInvoices = result.invoices.filter((row) => isCanceledInvoice(row));
    direct = {
      count: result.invoices.length,
      revenue: result.invoices.reduce((sum, row) => sum + parseNumber(row.total_amount), 0),
      emittedCount: emittedInvoices.length,
      emittedRevenue: emittedInvoices.reduce((sum, row) => sum + parseNumber(row.total_amount), 0),
      canceledCount: canceledInvoices.length,
      items: result.invoiceItems.length,
      orderLinkedCount: result.invoices.filter((row) => row.order_number != null && String(row.order_number).trim() !== "").length,
      detailErrors: result.detailErrors,
      pagination: result.pagination,
      statusCounts: result.invoices.reduce((acc, row) => {
        const key = normalizeStatusKey(row.status_label ?? row.status);
        acc[key] = Number(acc[key] ?? 0) + 1;
        return acc;
      }, {})
    };

    if (persist) {
      await persistInvoices(env, discovery.endpoint, startDate, endDate, result.invoices, result.invoiceItems);
    }
  }

  const summary = {
    startDate,
    endDate,
    orders,
    canonical,
    endpoint: discovery.endpoint,
    attempts: discovery.attempts,
    direct
  };

  if (hasFlag("json")) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printSummary(summary);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
