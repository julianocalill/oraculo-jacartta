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
    // Environment variables may already be exported.
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

function normalizeListRows(payload) {
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

  return {
    id,
    invoice_number: invoiceNumber == null ? null : String(invoiceNumber),
    invoice_series: firstValue(row, ["serie", "serieNotaFiscal", "notaFiscal.serie", "nfe.serie"]),
    emission_date: firstValue(row, ["dataEmissao", "data_emissao", "emissao", "data", "notaFiscal.dataEmissao", "nfe.dataEmissao"]),
    cancellation_date: firstValue(row, ["dataCancelamento", "data_cancelamento", "notaFiscal.dataCancelamento", "nfe.dataCancelamento"]),
    status: firstValue(row, ["situacao", "status", "statusNotaFiscal", "notaFiscal.status", "nfe.status"]),
    status_label: firstValue(row, ["descricaoSituacao", "statusDescricao", "situacaoDescricao", "notaFiscal.descricaoSituacao"]),
    client_name: firstValue(row, ["cliente.nome", "cliente.razaoSocial", "nomeCliente", "destinatario.nome"]),
    client_document: firstValue(row, ["cliente.cpfCnpj", "cliente.cnpj", "cliente.cpf", "documentoCliente", "destinatario.cpfCnpj"]),
    uf: firstValue(row, ["cliente.endereco.uf", "cliente.uf", "enderecoEntrega.uf", "uf", "estado", "destinatario.uf", "destinatario.endereco.uf"]),
    total_amount: parseNumber(firstValue(row, [
      "valor",
      "valorTotal",
      "valor_total",
      "valorTotalNota",
      "valorNota",
      "total",
      "valorNotaComImpostos",
      "notaFiscal.valorTotal",
      "nfe.valorTotal"
    ])),
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

async function supabaseFetch(env, path, options = {}) {
  const supabaseUrl = requireEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceKey = requireEnv(env, ["SUPABASE_SERVICE_ROLE_KEY"]);
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}${path}`, {
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

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, context, maxAttempts = 8) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response;
    let text = "";
    try {
      response = await fetch(url, options);
      text = await response.text();
    } catch (error) {
      const waitMs = 1500 * (attempt + 1);
      console.warn(`[sync-olist-invoices] ${context} falhou em rede (${error.message}); aguardando ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }
    if (response.ok) return text ? JSON.parse(text) : {};

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1);
      console.warn(`[sync-olist-invoices] ${context} recebeu ${response.status}; aguardando ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    const error = new Error(`${context} failed (${response.status}): ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }

  const error = new Error(`${context} failed (429): limite de taxa excedido`);
  error.status = 429;
  throw error;
}

async function fetchInvoicePage(env, accessToken, endpoint, startDate, endDate, offset, limit) {
  const baseUrl = requireEnv(env, ["OLIST_API_BASE_URL"]).endsWith("/")
    ? env.OLIST_API_BASE_URL
    : `${env.OLIST_API_BASE_URL}/`;
  const url = new URL(endpoint.replace(/^\//, ""), baseUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("orderBy", "desc");
  url.searchParams.set("dataInicial", startDate);
  url.searchParams.set("dataFinal", endDate);
  return fetchWithRetry(url, { headers: olistHeaders(env, accessToken) }, `Olist ${endpoint} offset=${offset}`);
}

async function fetchInvoiceDetail(env, accessToken, endpoint, invoiceId) {
  const baseUrl = requireEnv(env, ["OLIST_API_BASE_URL"]).endsWith("/")
    ? env.OLIST_API_BASE_URL
    : `${env.OLIST_API_BASE_URL}/`;
  const url = new URL(`${endpoint.replace(/^\//, "")}/${encodeURIComponent(invoiceId)}`, baseUrl);
  return fetchWithRetry(url, { headers: olistHeaders(env, accessToken) }, `Olist ${endpoint}/${invoiceId}`, 5);
}

async function findResumeRun(env, endpoint, startDate, endDate) {
  const path = `/rest/v1/olist_invoice_sync_runs?select=*&endpoint=eq.${encodeURIComponent(endpoint)}&window_start=eq.${startDate}&window_end=eq.${endDate}&status=in.(running,failed)&order=started_at.desc&limit=50`;
  const rows = await supabaseFetch(env, path);
  return (rows ?? []).sort((left, right) => {
    const leftOffset = Number(left.metadata?.next_offset ?? 0);
    const rightOffset = Number(right.metadata?.next_offset ?? 0);
    if (rightOffset !== leftOffset) return rightOffset - leftOffset;
    return String(right.started_at ?? "").localeCompare(String(left.started_at ?? ""));
  })[0] ?? null;
}

async function createRun(env, endpoint, startDate, endDate, metadata) {
  const rows = await supabaseFetch(env, "/rest/v1/olist_invoice_sync_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      status: "running",
      endpoint,
      window_start: startDate,
      window_end: endDate,
      metadata
    }])
  });
  return rows?.[0];
}

async function patchRun(env, runId, patch) {
  await supabaseFetch(env, `/rest/v1/olist_invoice_sync_runs?id=eq.${runId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

async function upsertRows(env, table, rows) {
  if (rows.length === 0) return;
  for (let index = 0; index < rows.length; index += 500) {
    const batch = rows.slice(index, index + 500);
    await supabaseFetch(env, `/rest/v1/${table}?on_conflict=id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batch)
    });
  }
}

function parsePositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

async function main() {
  const env = loadEnv();
  const endpoint = arg("endpoint", "notas");
  const startDate = arg("start", new Date().toISOString().slice(0, 10));
  const endDate = arg("end", startDate);
  const pageSize = parsePositiveInt(arg("page-size", arg("limit", "100")), 100, 100);
  const maxPages = parsePositiveInt(arg("max-pages", "50"), 50);
  const delayMs = parsePositiveInt(arg("delay-ms", arg("page-delay-ms", "1000")), 1000);
  const detailDelayMs = parsePositiveInt(arg("detail-delay-ms", "300"), 300);
  const progressEvery = parsePositiveInt(arg("progress-every", "10"), 10);
  const resume = hasFlag("resume");
  const hydrateDetails = hasFlag("hydrate-details");

  const accessToken = await getAccessToken(env);
  const resumeRun = resume ? await findResumeRun(env, endpoint, startDate, endDate) : null;
  const startedMetadata = {
    source: "scripts/sync-olist-invoices.js",
    endpoint,
    page_size: pageSize,
    hydrate_details: hydrateDetails,
    next_offset: 0,
    started_at: new Date().toISOString()
  };
  const run = resumeRun ?? await createRun(env, endpoint, startDate, endDate, startedMetadata);
  if (!run?.id) throw new Error("Nao foi possivel criar ou retomar o run de sync.");

  if (resumeRun) {
    await patchRun(env, run.id, {
      status: "running",
      error_message: null,
      metadata: {
        ...(run.metadata ?? {}),
        resumed_at: new Date().toISOString(),
        hydrate_details: hydrateDetails
      }
    });
  }

  const runMetadata = run.metadata && typeof run.metadata === "object" ? run.metadata : {};
  let offset = resume ? Number(runMetadata.next_offset ?? 0) : 0;
  let totalFetched = Number(run.records_fetched ?? 0);
  let totalInvoices = Number(run.records_upserted ?? 0);
  let totalItems = Number(run.items_upserted ?? 0);
  let totalReported = Number(runMetadata.total_reported ?? 0);
  let pagesProcessed = 0;

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const payload = await fetchInvoicePage(env, accessToken, endpoint, startDate, endDate, offset, pageSize);
      const rows = normalizeListRows(payload);
      const pagination = payload && typeof payload === "object" ? payload.paginacao : null;
      totalReported = Number(pagination?.total ?? totalReported ?? 0);
      if (rows.length === 0) break;

      const invoices = [];
      const items = [];
      let detailErrors = 0;

      for (const row of rows) {
        const listInvoice = normalizeInvoice(row);
        if (!listInvoice) continue;

        let sourceRow = row;
        let invoice = listInvoice;
        if (hydrateDetails) {
          try {
            await sleep(detailDelayMs);
            const detailPayload = await fetchInvoiceDetail(env, accessToken, endpoint, listInvoice.id);
            if (detailPayload && typeof detailPayload === "object") {
              sourceRow = detailPayload;
              invoice = normalizeInvoice(detailPayload) ?? listInvoice;
            }
          } catch (error) {
            detailErrors += 1;
            sourceRow = row;
            invoice = listInvoice;
          }
        }

        invoices.push(invoice);
        items.push(...normalizeInvoiceItems(invoice, sourceRow));
      }

      await upsertRows(env, "olist_invoices", invoices);
      await upsertRows(env, "olist_invoice_items", items);

      totalFetched += rows.length;
      totalInvoices += invoices.length;
      totalItems += items.length;
      pagesProcessed += 1;
      offset += rows.length;

      const metadata = {
        ...(run.metadata ?? {}),
        source: "scripts/sync-olist-invoices.js",
        endpoint,
        page_size: pageSize,
        hydrate_details: hydrateDetails,
        total_reported: totalReported,
        next_offset: offset,
        last_page_size: rows.length,
        last_detail_errors: detailErrors,
        updated_at: new Date().toISOString()
      };

      await patchRun(env, run.id, {
        records_fetched: totalFetched,
        records_upserted: totalInvoices,
        items_upserted: totalItems,
        metadata
      });

      if (progressEvery > 0 && pagesProcessed % progressEvery === 0) {
        console.log(`[sync-olist-invoices] paginas=${pagesProcessed} offset=${offset} notas=${totalInvoices} itens=${totalItems} total_api=${totalReported || "?"}`);
      }

      if (rows.length < pageSize) break;
      await sleep(delayMs);
    }

    const completed = totalReported > 0 ? offset >= totalReported : pagesProcessed < maxPages;
    await patchRun(env, run.id, {
      status: completed ? "success" : "running",
      finished_at: completed ? new Date().toISOString() : null,
      records_fetched: totalFetched,
      records_upserted: totalInvoices,
      items_upserted: totalItems,
      metadata: {
        ...(run.metadata ?? {}),
        source: "scripts/sync-olist-invoices.js",
        endpoint,
        page_size: pageSize,
        hydrate_details: hydrateDetails,
        total_reported: totalReported,
        next_offset: offset,
        completed,
        updated_at: new Date().toISOString()
      }
    });

    console.log(JSON.stringify({
      ok: true,
      run_id: run.id,
      endpoint,
      window_start: startDate,
      window_end: endDate,
      pages_processed: pagesProcessed,
      next_offset: offset,
      total_reported: totalReported,
      records_fetched: totalFetched,
      invoices_upserted: totalInvoices,
      items_upserted: totalItems,
      completed
    }, null, 2));
  } catch (error) {
    await patchRun(env, run.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      records_fetched: totalFetched,
      records_upserted: totalInvoices,
      items_upserted: totalItems,
      error_message: error.message,
      metadata: {
        ...(run.metadata ?? {}),
        source: "scripts/sync-olist-invoices.js",
        endpoint,
        page_size: pageSize,
        hydrate_details: hydrateDetails,
        total_reported: totalReported,
        next_offset: offset,
        failed_at: new Date().toISOString()
      }
    }).catch(() => null);
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
