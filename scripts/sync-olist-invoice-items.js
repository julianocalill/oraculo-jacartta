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

function normalizeItems(row) {
  const items = firstValue(row, ["itens", "items", "produtos", "notaFiscal.itens", "nfe.itens"]);
  return Array.isArray(items) ? items.filter((item) => item && typeof item === "object") : [];
}

function normalizeInvoice(row) {
  const invoiceNumber = firstValue(row, ["numero", "numeroNotaFiscal", "numeroNfe", "numeroNF"]);
  const accessKey = firstValue(row, ["chaveAcesso", "chave_acesso", "chaveAcessoNfe"]);
  const rawId = firstValue(row, ["id", "codigo", "idNotaFiscal", "idNfe"]);
  const id = String(rawId ?? accessKey ?? invoiceNumber ?? "").trim();
  if (!id) return null;
  return {
    id,
    invoice_number: invoiceNumber == null ? null : String(invoiceNumber),
    invoice_series: firstValue(row, ["serie", "serieNotaFiscal"]),
    emission_date: firstValue(row, ["dataEmissao", "data_emissao", "emissao", "data"]),
    cancellation_date: firstValue(row, ["dataCancelamento", "data_cancelamento"]),
    status: firstValue(row, ["situacao", "status", "statusNotaFiscal"]),
    status_label: firstValue(row, ["descricaoSituacao", "statusDescricao", "situacaoDescricao"]),
    client_name: firstValue(row, ["cliente.nome", "cliente.razaoSocial", "nomeCliente"]),
    client_document: firstValue(row, ["cliente.cpfCnpj", "cliente.cnpj", "cliente.cpf", "documentoCliente"]),
    uf: firstValue(row, ["cliente.endereco.uf", "cliente.uf", "enderecoEntrega.uf", "uf"]),
    total_amount: parseNumber(firstValue(row, ["valor", "valorTotal", "valor_total", "valorNota", "total"])),
    channel_name: firstValue(row, ["ecommerce.canalVenda", "canal", "canalVenda"]),
    integration_name: firstValue(row, ["ecommerce.nome", "integracao", "integracao.nome"]),
    marketplace_name: firstValue(row, ["ecommerce.nome", "marketplace", "marketplace.nome"]),
    order_id: firstValue(row, ["pedido.id", "idPedido", "pedidoId", "idPedidoEcommerce"]),
    order_number: firstValue(row, ["ecommerce.numeroPedidoEcommerce", "ecommerce.numeroPedidoCanalVenda", "pedido.numero", "numeroPedido"]),
    access_key: accessKey == null ? null : String(accessKey),
    raw_json: row,
    synced_at: new Date().toISOString()
  };
}

function normalizeInvoiceItems(invoice, row) {
  return normalizeItems(row).map((item, index) => {
    const itemId = firstValue(item, ["idItem", "id", "codigoItem"]);
    const productId = firstValue(item, ["idProduto", "produto.id", "produtoId", "codigoProduto"]);
    const sku = firstValue(item, ["codigo", "produto.codigo", "sku", "codigoProduto"]);
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
      description: firstValue(item, ["descricao", "nome", "produto.nome"]),
      quantity,
      unit_value: unitValue,
      total_value: totalValue || quantity * unitValue,
      raw_json: item,
      synced_at: new Date().toISOString()
    };
  });
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
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
  if (!response.ok) {
    const error = new Error(`Supabase request failed (${response.status}): ${text.slice(0, 500)}`);
    error.status = response.status;
    throw error;
  }
  return text ? JSON.parse(text) : null;
}

async function getAccessToken(env) {
  if (env.OLIST_API_BEARER_TOKEN) return env.OLIST_API_BEARER_TOKEN;
  const rows = await supabaseFetch(env, "/rest/v1/olist_oauth_tokens?provider=eq.olist&select=refresh_token&limit=1");
  const refreshToken = env.OLIST_API_REFRESH_TOKEN || rows?.[0]?.refresh_token;
  if (!refreshToken) throw new Error("Missing Olist refresh token.");
  const response = await fetch(requireEnv(env, ["OLIST_API_TOKEN_URL"]), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: requireEnv(env, ["OLIST_API_CLIENT_ID"]),
      client_secret: requireEnv(env, ["OLIST_API_CLIENT_SECRET"])
    })
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || !payload.access_token) throw new Error(`Falha ao renovar token Olist: ${text.slice(0, 300)}`);
  return payload.access_token;
}

function olistHeaders(env, accessToken) {
  const header = env.OLIST_API_AUTH_HEADER || "Authorization";
  const prefix = env.OLIST_API_AUTH_PREFIX == null ? "Bearer" : env.OLIST_API_AUTH_PREFIX;
  return { Accept: "application/json", [header]: prefix ? `${prefix} ${accessToken}` : accessToken };
}

async function fetchWithRetry(url, options, context, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response;
    let text = "";
    try {
      response = await fetch(url, options);
      text = await response.text();
    } catch (error) {
      const waitMs = 1500 * (attempt + 1);
      console.warn(`[sync-olist-invoice-items] ${context} rede: ${error.message}; aguardando ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }
    if (response.ok) return text ? JSON.parse(text) : {};
    if (response.status === 429 || response.status >= 500) {
      const waitMs = Number(response.headers.get("retry-after") ?? "0") * 1000 || 1500 * (attempt + 1);
      console.warn(`[sync-olist-invoice-items] ${context} ${response.status}; aguardando ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`${context} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  throw new Error(`${context} failed: limite de tentativas excedido`);
}

async function fetchInvoiceDetail(env, accessToken, endpoint, invoiceId) {
  const baseUrl = requireEnv(env, ["OLIST_API_BASE_URL"]).replace(/\/?$/, "/");
  const url = new URL(`${endpoint}/${encodeURIComponent(invoiceId)}`, baseUrl);
  return fetchWithRetry(url, { headers: olistHeaders(env, accessToken) }, `Olist ${endpoint}/${invoiceId}`);
}

async function findResumeRun(env, endpoint, startDate, endDate) {
  const rows = await supabaseFetch(env, `/rest/v1/olist_invoice_sync_runs?select=*&endpoint=eq.${encodeURIComponent(endpoint)}&window_start=eq.${startDate}&window_end=eq.${endDate}&status=in.(running,failed)&order=started_at.desc&limit=50`);
  return (rows ?? []).sort((left, right) => Number(right.metadata?.next_offset ?? 0) - Number(left.metadata?.next_offset ?? 0))[0] ?? null;
}

async function createRun(env, endpoint, startDate, endDate, metadata) {
  const rows = await supabaseFetch(env, "/rest/v1/olist_invoice_sync_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{ status: "running", endpoint, window_start: startDate, window_end: endDate, metadata }])
  });
  return rows?.[0];
}

async function patchRun(env, id, patch) {
  await supabaseFetch(env, `/rest/v1/olist_invoice_sync_runs?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

async function upsertRows(env, table, rows) {
  if (rows.length === 0) return;
  await supabaseFetch(env, `/rest/v1/${table}?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}

function intArg(name, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(arg(name, String(fallback)));
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), max) : fallback;
}

async function main() {
  const env = loadEnv();
  const listEndpoint = arg("endpoint", "notas");
  const runEndpoint = `${listEndpoint}:items`;
  const startDate = arg("start", "2026-06-01");
  const endDate = arg("end", "2026-06-19");
  // --ids-file=<path>: processa exatamente esses ids de NF (um por linha) em vez
  // de varrer olist_invoices pela janela — usado para backfill direcionado das
  // NFs ainda sem linhas em olist_invoice_items (evita re-hidratar as demais).
  const idsFile = arg("ids-file", "");
  const targetIds = idsFile
    ? readFileSync(idsFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : null;
  const pageSize = intArg("page-size", 50, 500);
  const maxPages = intArg("max-pages", 1);
  const delayMs = intArg("delay-ms", 500);
  const progressEvery = intArg("progress-every", 1);
  const resume = hasFlag("resume");
  const status = arg("status", "");

  const run = resume
    ? (await findResumeRun(env, runEndpoint, startDate, endDate)) ?? await createRun(env, runEndpoint, startDate, endDate, { next_offset: 0 })
    : await createRun(env, runEndpoint, startDate, endDate, { next_offset: 0 });
  if (!run?.id) throw new Error("Nao foi possivel criar/retomar run de itens.");

  const accessToken = await getAccessToken(env);
  let offset = resume ? Number(run.metadata?.next_offset ?? 0) : 0;
  let fetched = Number(run.records_fetched ?? 0);
  let invoicesUpdated = Number(run.records_upserted ?? 0);
  let itemsUpserted = Number(run.items_upserted ?? 0);
  let pagesProcessed = 0;

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const statusFilter = status ? `&status=eq.${encodeURIComponent(status)}` : "";
      const invoices = targetIds
        ? targetIds.slice(offset, offset + pageSize).map((id) => ({ id }))
        : await supabaseFetch(
            env,
            `/rest/v1/olist_invoices?select=id,invoice_number&emission_date=gte.${startDate}&emission_date=lt.${endDate}T23:59:59${statusFilter}&order=emission_date.asc,id.asc&limit=${pageSize}&offset=${offset}`
          );
      if (!Array.isArray(invoices) || invoices.length === 0) break;

      const updatedInvoices = [];
      const invoiceItems = [];
      let detailErrors = 0;

      for (const invoiceRef of invoices) {
        try {
          await sleep(delayMs);
          const detail = await fetchInvoiceDetail(env, accessToken, listEndpoint, invoiceRef.id);
          const invoice = normalizeInvoice(detail);
          if (invoice) {
            updatedInvoices.push(invoice);
            invoiceItems.push(...normalizeInvoiceItems(invoice, detail));
          }
        } catch {
          detailErrors += 1;
        }
      }

      await upsertRows(env, "olist_invoices", updatedInvoices);
      await upsertRows(env, "olist_invoice_items", invoiceItems);

      offset += invoices.length;
      fetched += invoices.length;
      invoicesUpdated += updatedInvoices.length;
      itemsUpserted += invoiceItems.length;
      pagesProcessed += 1;

      await patchRun(env, run.id, {
        records_fetched: fetched,
        records_upserted: invoicesUpdated,
        items_upserted: itemsUpserted,
        metadata: {
          ...(run.metadata ?? {}),
          source: "scripts/sync-olist-invoice-items.js",
          list_endpoint: listEndpoint,
          next_offset: offset,
          page_size: pageSize,
          status_filter: status || null,
          last_detail_errors: detailErrors,
          updated_at: new Date().toISOString()
        }
      });

      if (progressEvery > 0 && pagesProcessed % progressEvery === 0) {
        console.log(`[sync-olist-invoice-items] paginas=${pagesProcessed} offset=${offset} invoices=${invoicesUpdated} itens=${itemsUpserted}`);
      }
    }

    await patchRun(env, run.id, {
      status: pagesProcessed < maxPages ? "success" : "running",
      finished_at: pagesProcessed < maxPages ? new Date().toISOString() : null,
      records_fetched: fetched,
      records_upserted: invoicesUpdated,
      items_upserted: itemsUpserted,
      metadata: {
        ...(run.metadata ?? {}),
        source: "scripts/sync-olist-invoice-items.js",
        list_endpoint: listEndpoint,
        next_offset: offset,
        page_size: pageSize,
        status_filter: status || null,
        updated_at: new Date().toISOString()
      }
    });

    console.log(JSON.stringify({ ok: true, run_id: run.id, pages_processed: pagesProcessed, next_offset: offset, invoices_fetched: fetched, invoices_updated: invoicesUpdated, items_upserted: itemsUpserted }, null, 2));
  } catch (error) {
    await patchRun(env, run.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      records_fetched: fetched,
      records_upserted: invoicesUpdated,
      items_upserted: itemsUpserted,
      error_message: error.message,
      metadata: { ...(run.metadata ?? {}), next_offset: offset, failed_at: new Date().toISOString() }
    }).catch(() => null);
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
