#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
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

function positiveInt(name, fallback, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(arg(name, String(fallback)));
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback;
}

function requireEnv(env, keys) {
  for (const key of keys) {
    if (env[key]) return env[key];
  }
  throw new Error(`Missing required environment variable. Tried: ${keys.join(", ")}`);
}

function validateDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Parametro --${name} invalido: ${value}`);
  }
  return value;
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function parseJson(text, context) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context}: resposta nao veio em JSON`);
  }
}

async function supabaseFetch(env, path, options = {}) {
  const baseUrl = requireEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]).replace(/\/$/, "");
  const serviceKey = requireEnv(env, ["SUPABASE_SERVICE_ROLE_KEY"]);

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    let response;
    let text = "";
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
      text = await response.text();
    } catch (error) {
      if (attempt === 5) throw error;
      await sleep(750 * attempt);
      continue;
    }

    if (response.ok) return parseJson(text, `Supabase ${path}`) ?? null;
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      const retryAfter = Number(response.headers.get("retry-after") || "0");
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * attempt);
      continue;
    }

    const error = new Error(`Supabase request failed (${response.status}) for ${path.slice(0, 180)}: ${text.slice(0, 500)}`);
    error.status = response.status;
    throw error;
  }
}

async function getStoredRefreshToken(env) {
  const rows = await supabaseFetch(env, "/rest/v1/olist_oauth_tokens?provider=eq.olist&select=refresh_token&limit=1");
  return rows?.[0]?.refresh_token || "";
}

async function getAccessToken(env) {
  if (env.OLIST_API_BEARER_TOKEN) return env.OLIST_API_BEARER_TOKEN;

  const refreshToken = env.OLIST_API_REFRESH_TOKEN || await getStoredRefreshToken(env);
  if (!refreshToken) throw new Error("Nao encontrei refresh token da Olist.");

  const response = await fetch(requireEnv(env, ["OLIST_API_TOKEN_URL"]), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: requireEnv(env, ["OLIST_API_CLIENT_ID"]),
      client_secret: requireEnv(env, ["OLIST_API_CLIENT_SECRET"])
    })
  });

  const text = await response.text();
  const payload = parseJson(text, "Refresh token Olist") || {};
  if (!response.ok || !payload.access_token) {
    throw new Error(`Falha ao renovar token da Olist (${response.status}): ${text.slice(0, 300)}`);
  }

  await supabaseFetch(env, "/rest/v1/olist_oauth_tokens?on_conflict=provider", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      provider: "olist",
      access_token: payload.access_token,
      refresh_token: payload.refresh_token || refreshToken,
      expires_at: payload.expires_in
        ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
        : null,
      scope: payload.scope || null,
      token_type: payload.token_type || null,
      updated_at: new Date().toISOString()
    }])
  });

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

async function fetchOrderDetail(env, accessToken, orderId, stats = null) {
  const baseUrl = requireEnv(env, ["OLIST_API_BASE_URL"]).replace(/\/?$/, "/");
  const url = new URL(`pedidos/${encodeURIComponent(orderId)}`, baseUrl);

  for (let attempt = 1; attempt <= 7; attempt += 1) {
    let response;
    let text = "";
    try {
      response = await fetch(url, { headers: olistHeaders(env, accessToken) });
      text = await response.text();
    } catch (error) {
      if (attempt === 7) throw error;
      if (stats) stats.network_retries += 1;
      const waitMs = Math.min(30000, 1500 * 2 ** (attempt - 1));
      console.warn(`[backfill-order-items] pedido=${orderId} falha de rede; retry em ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    if (response.ok) return parseJson(text, `Olist pedidos/${orderId}`) || {};
    if (response.status === 429 || response.status >= 500) {
      if (response.status === 429 && stats) stats.rate_limit_events += 1;
      if (attempt === 7) {
        const error = new Error(`Olist pedidos/${orderId} falhou apos retries (${response.status}): ${text.slice(0, 300)}`);
        error.status = response.status;
        throw error;
      }
      const retryAfter = Number(response.headers.get("retry-after") || "0");
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(30000, 1500 * 2 ** (attempt - 1));
      console.warn(`[backfill-order-items] pedido=${orderId} recebeu ${response.status}; retry em ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    const error = new Error(`Olist pedidos/${orderId} falhou (${response.status}): ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
}

function unwrapOrder(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.pedido && typeof payload.pedido === "object") return payload.pedido;
  if (payload.data && !Array.isArray(payload.data) && typeof payload.data === "object") return payload.data;
  return payload;
}

function orderItems(order) {
  if (Array.isArray(order?.itens)) return order.itens;
  if (Array.isArray(order?.items)) return order.items;
  if (Array.isArray(order?.produtos)) return order.produtos;
  return [];
}

function normalizeOrder(candidate, rawOrder) {
  const order = unwrapOrder(rawOrder);
  return {
    id: String(order.id ?? candidate.order_id),
    numero_pedido: order.numeroPedido ?? order.numero_pedido ?? candidate.numero_pedido ?? null,
    situacao: order.situacao ?? order.status ?? null,
    data_criacao: order.data ?? order.dataCriacao ?? order.data_criacao ?? candidate.order_data_criacao ?? null,
    data_atualizacao: order.dataAtualizacao ?? order.dataAlteracao ?? order.data_atualizacao ?? null,
    cliente: order.cliente && typeof order.cliente === "object" ? order.cliente : {},
    transportador: order.transportador && typeof order.transportador === "object" ? order.transportador : {},
    payload: order,
    synced_at: new Date().toISOString()
  };
}

function normalizeItemRow(order, item, index) {
  const product = item?.produto && typeof item.produto === "object"
    ? item.produto
    : item?.product && typeof item.product === "object"
      ? item.product
      : {};
  const productId = product.id ?? item?.idProduto ?? item?.produtoId ?? null;
  const sku = product.sku ?? product.codigo ?? item?.sku ?? item?.codigo ?? null;
  const quantity = Number(item?.quantidade ?? item?.qtde ?? item?.qtd ?? 0);
  const unitValue = Number(item?.valorUnitario ?? item?.valor_unitario ?? item?.preco ?? item?.valor ?? 0);
  const explicitTotal = Number(item?.valorTotal ?? item?.valor_total ?? item?.total);
  const totalValue = Number.isFinite(explicitTotal)
    ? explicitTotal
    : Number.isFinite(quantity) && Number.isFinite(unitValue)
      ? quantity * unitValue
      : null;
  const lineNumber = index + 1;

  return {
    id: `${order.id}:${lineNumber}:${productId || sku || "item"}`,
    order_id: String(order.id),
    line_number: lineNumber,
    produto_id: productId == null ? null : String(productId),
    sku: sku == null ? null : String(sku),
    tipo: product.tipo == null ? null : String(product.tipo),
    descricao: product.descricao ?? product.nome ?? item?.descricao ?? item?.nome ?? null,
    quantidade: Number.isFinite(quantity) ? quantity : 0,
    valor_unitario: Number.isFinite(unitValue) ? unitValue : null,
    valor_total: Number.isFinite(totalValue) ? totalValue : null,
    info_adicional: item?.infoAdicional ?? item?.info_adicional ?? null,
    order_data_criacao: order.data_criacao,
    payload: item && typeof item === "object" ? item : {},
    synced_at: new Date().toISOString()
  };
}

async function upsertRows(env, table, rows, conflict = "id") {
  if (!rows.length) return;
  await supabaseFetch(env, `/rest/v1/${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}

async function candidateCount(env, start, end) {
  return Number(await supabaseFetch(env, "/rest/v1/rpc/oraculo_fiscal_order_item_backfill_candidate_count", {
    method: "POST",
    body: JSON.stringify({ p_start_date: start, p_end_date: end })
  }) || 0);
}

async function listCandidates(env, start, end, limit) {
  const rows = await supabaseFetch(env, "/rest/v1/rpc/oraculo_fiscal_order_item_backfill_queue_candidates", {
    method: "POST",
    body: JSON.stringify({
      p_start_date: start,
      p_end_date: end,
      p_limit: limit
    })
  });
  return Array.isArray(rows) ? rows : [];
}

async function markQueueItem(env, candidate, status, error = null) {
  if (!candidate.queue_id) return;
  await supabaseFetch(env, "/rest/v1/rpc/mark_olist_order_item_backfill_queue", {
    method: "POST",
    body: JSON.stringify({
      p_queue_id: candidate.queue_id,
      p_status: status,
      p_last_error: error?.message || null
    })
  });
}

async function findResumeRun(env, start, end) {
  const rows = await supabaseFetch(
    env,
    `/rest/v1/olist_order_items_backfill_runs?select=*&window_start=eq.${start}&window_end=eq.${end}&status=in.(running,partial,failed)&order=started_at.desc&limit=1`
  );
  return rows?.[0] || null;
}

async function createRun(env, start, end, candidatesTotal, options) {
  const rows = await supabaseFetch(env, "/rest/v1/olist_order_items_backfill_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify([{
      window_start: start,
      window_end: end,
      candidates_total: candidatesTotal,
      metadata: {
        source: "scripts/backfill-olist-order-items-for-valid-invoices.js",
        options,
        created_at: new Date().toISOString()
      }
    }])
  });
  return rows?.[0];
}

async function patchRun(env, runId, patch) {
  await supabaseFetch(env, `/rest/v1/olist_order_items_backfill_runs?id=eq.${runId}`, {
    method: "PATCH",
    body: JSON.stringify(patch)
  });
}

async function listPendingErrors(env, runId, limit) {
  const rows = await supabaseFetch(
    env,
    `/rest/v1/olist_order_items_backfill_errors?select=*&run_id=eq.${runId}&status=eq.pending&order=last_attempt_at.asc&limit=${limit}`
  );
  return Array.isArray(rows) ? rows : [];
}

async function recordOrderIssue(env, runId, candidate, status, error = null) {
  const existing = await supabaseFetch(
    env,
    `/rest/v1/olist_order_items_backfill_errors?select=id,attempt_count&run_id=eq.${runId}&order_id=eq.${encodeURIComponent(candidate.order_id)}&limit=1`
  );
  const previous = existing?.[0];
  const row = {
    run_id: runId,
    order_id: String(candidate.order_id),
    invoice_id: candidate.invoice_id || null,
    invoice_number: candidate.invoice_number || null,
    status,
    attempt_count: Number(previous?.attempt_count || 0) + 1,
    http_status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null,
    error_message: error?.message || (status === "no_items" ? "Detalhe do pedido nao retornou itens." : null),
    context: candidate,
    last_attempt_at: new Date().toISOString(),
    resolved_at: status === "resolved" ? new Date().toISOString() : null
  };

  if (previous?.id) {
    await supabaseFetch(env, `/rest/v1/olist_order_items_backfill_errors?id=eq.${previous.id}`, {
      method: "PATCH",
      body: JSON.stringify(row)
    });
  } else {
    await supabaseFetch(env, "/rest/v1/olist_order_items_backfill_errors", {
      method: "POST",
      body: JSON.stringify([row])
    });
  }
}

async function resolveOrderIssue(env, runId, orderId) {
  await supabaseFetch(
    env,
    `/rest/v1/olist_order_items_backfill_errors?run_id=eq.${runId}&order_id=eq.${encodeURIComponent(orderId)}&status=neq.resolved`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        last_attempt_at: new Date().toISOString()
      })
    }
  );
}

function candidateFromError(row) {
  return {
    ...(row.context && typeof row.context === "object" ? row.context : {}),
    order_id: row.order_id,
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number
  };
}

function runCoverageAudit(start, end) {
  const stdout = execFileSync(
    process.execPath,
    ["scripts/audit-olist-invoice-items-coverage.js", `--start=${start}`, `--end=${end}`, "--json"],
    { cwd: process.cwd(), encoding: "utf8", env: process.env, maxBuffer: 20 * 1024 * 1024 }
  );
  return JSON.parse(stdout);
}

async function main() {
  const env = loadEnv();
  const start = validateDate(arg("start", "2026-06-01"), "start");
  const end = validateDate(arg("end", "2026-06-19"), "end");
  if (start > end) throw new Error("--start deve ser menor ou igual a --end.");

  const limit = positiveInt("limit", 100, 10000);
  const delayMs = positiveInt("delay-ms", 750, 60000);
  const maxRuntimeMinutes = positiveInt("max-runtime-minutes", 15, 1440);
  const resume = hasFlag("resume");
  const skipAudit = hasFlag("skip-audit");
  const startedAt = Date.now();
  const deadline = startedAt + maxRuntimeMinutes * 60 * 1000;
  const effectiveDelayMs = limit > 500 ? Math.max(delayMs, 1000) : delayMs;
  const candidatesTotal = await candidateCount(env, start, end);
  const runtimeStats = {
    rate_limit_events: 0,
    network_retries: 0
  };
  const options = {
    start,
    end,
    limit,
    delay_ms_requested: delayMs,
    delay_ms_effective: effectiveDelayMs,
    max_runtime_minutes: maxRuntimeMinutes,
    resume,
    candidate_source: "olist_order_item_backfill_queue"
  };

  let run = resume ? await findResumeRun(env, start, end) : null;
  if (!run) run = await createRun(env, start, end, candidatesTotal, options);
  if (!run?.id) throw new Error("Nao foi possivel criar ou retomar o backfill.");

  await patchRun(env, run.id, {
    status: "running",
    finished_at: null,
    error_message: null,
    candidates_total: candidatesTotal,
    metadata: {
      ...(run.metadata || {}),
      options,
      resumed_at: resume ? new Date().toISOString() : null
    }
  });

  const accessToken = await getAccessToken(env);
  let checkpoint = resume ? run.checkpoint_order_id : null;
  let ordersProcessed = Number(run.orders_processed || 0);
  let ordersWithItems = Number(run.orders_with_items || 0);
  let ordersWithoutItems = Number(run.orders_without_items || 0);
  let ordersWithError = Number(run.orders_with_error || 0);
  let itemsUpserted = Number(run.items_upserted || 0);
  let processedThisInvocation = 0;
  let stoppedByRuntime = false;
  let exhausted = false;

  async function persistProgress(extraMetadata = {}) {
    await patchRun(env, run.id, {
      checkpoint_order_id: checkpoint,
      candidates_total: candidatesTotal,
      orders_processed: ordersProcessed,
      orders_with_items: ordersWithItems,
      orders_without_items: ordersWithoutItems,
      orders_with_error: ordersWithError,
      items_upserted: itemsUpserted,
      metadata: {
        ...(run.metadata || {}),
        options,
        processed_this_invocation: processedThisInvocation,
        updated_at: new Date().toISOString(),
        ...extraMetadata
      }
    });
  }

  async function processCandidate(candidate, isRetry = false) {
    let rawOrder = candidate.order_payload && orderItems(candidate.order_payload).length > 0
      ? candidate.order_payload
      : null;

    try {
      if (!rawOrder) {
        await sleep(effectiveDelayMs);
        rawOrder = await fetchOrderDetail(env, accessToken, candidate.order_id, runtimeStats);
      }

      const normalizedOrder = normalizeOrder(candidate, rawOrder);
      const items = orderItems(normalizedOrder.payload)
        .map((item, index) => normalizeItemRow(normalizedOrder, item, index));

      if (items.length === 0) {
        ordersWithoutItems += 1;
        await recordOrderIssue(env, run.id, candidate, "no_items");
        await markQueueItem(env, candidate, "no_items");
      } else {
        await upsertRows(env, "olist_order_items", items);
        ordersWithItems += 1;
        itemsUpserted += items.length;
        if (isRetry) await resolveOrderIssue(env, run.id, candidate.order_id);
      }
    } catch (error) {
      ordersWithError += 1;
      await recordOrderIssue(env, run.id, candidate, "pending", error);
      await markQueueItem(env, candidate, "error", error).catch(() => null);
      console.error(`[backfill-order-items] pedido=${candidate.order_id} erro=${error.message}`);
    }

    ordersProcessed += 1;
    processedThisInvocation += 1;
    if (!isRetry) checkpoint = String(candidate.order_id);
    if (processedThisInvocation % 25 === 0) {
      await persistProgress({ last_order_id: candidate.order_id, ...runtimeStats });
    }
  }

  try {
    if (resume && processedThisInvocation < limit) {
      const pendingErrors = await listPendingErrors(env, run.id, limit - processedThisInvocation);
      for (const row of pendingErrors) {
        if (Date.now() >= deadline) {
          stoppedByRuntime = true;
          break;
        }
        await processCandidate(candidateFromError(row), true);
      }
    }

    while (!stoppedByRuntime && processedThisInvocation < limit) {
      if (Date.now() >= deadline) {
        stoppedByRuntime = true;
        break;
      }

      const pageLimit = Math.min(100, limit - processedThisInvocation);
      const candidates = await listCandidates(env, start, end, pageLimit);
      if (candidates.length === 0) {
        exhausted = true;
        break;
      }

      for (const candidate of candidates) {
        if (Date.now() >= deadline || processedThisInvocation >= limit) {
          stoppedByRuntime = Date.now() >= deadline;
          break;
        }
        await processCandidate(candidate);
      }

      console.log(JSON.stringify({
        run_id: run.id,
        processed_this_invocation: processedThisInvocation,
        orders_with_items: ordersWithItems,
        orders_without_items: ordersWithoutItems,
        orders_with_error: ordersWithError,
        items_upserted: itemsUpserted,
        checkpoint_order_id: checkpoint
      }));
    }

    const pendingErrors = await listPendingErrors(env, run.id, 1);
    const status = exhausted && pendingErrors.length === 0 && ordersWithoutItems === 0
      ? "success"
      : "partial";
    const coverage = skipAudit ? null : runCoverageAudit(start, end);
    const orderCoverage = Number(coverage?.coverage?.order_items_invoice_pct || 0);
    const missingRevenue = Number(coverage?.coverage?.missing_order_items_revenue_pct || 100);
    const releaseGatePassed = orderCoverage >= 98 || missingRevenue < 0.5;
    const finishedAt = new Date().toISOString();
    const report = {
      ok: true,
      run_id: run.id,
      status,
      period: { start, end },
      candidates_total_at_start: candidatesTotal,
      processed_this_invocation: processedThisInvocation,
      totals: {
        orders_processed: ordersProcessed,
        orders_with_items: ordersWithItems,
        orders_without_items: ordersWithoutItems,
        orders_with_error: ordersWithError,
        items_upserted: itemsUpserted
      },
      runtime: runtimeStats,
      stopped_by_runtime: stoppedByRuntime,
      checkpoint_order_id: checkpoint,
      coverage: coverage?.coverage || null,
      release_gate_passed: releaseGatePassed,
      next_action: releaseGatePassed
        ? "auditar_e_criar_oraculo_fiscal_sku_sales_by_order_link"
        : "continuar_backfill_com_resume"
    };

    mkdirSync(join(process.cwd(), "reports"), { recursive: true });
    const reportPath = join(
      process.cwd(),
      "reports",
      `olist-order-items-backfill-${start}-${end}-${finishedAt.replace(/[:.]/g, "-")}.json`
    );
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    await patchRun(env, run.id, {
      status,
      finished_at: finishedAt,
      checkpoint_order_id: checkpoint,
      orders_processed: ordersProcessed,
      orders_with_items: ordersWithItems,
      orders_without_items: ordersWithoutItems,
      orders_with_error: ordersWithError,
      items_upserted: itemsUpserted,
      metadata: {
        ...(run.metadata || {}),
        options,
        report_path: reportPath,
        coverage: coverage?.coverage || null,
        release_gate_passed: releaseGatePassed,
        stopped_by_runtime: stoppedByRuntime,
        runtime: runtimeStats,
        updated_at: finishedAt
      }
    });

    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    await patchRun(env, run.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      checkpoint_order_id: checkpoint,
      orders_processed: ordersProcessed,
      orders_with_items: ordersWithItems,
      orders_without_items: ordersWithoutItems,
      orders_with_error: ordersWithError,
      items_upserted: itemsUpserted,
      error_message: error.message,
      metadata: {
        ...(run.metadata || {}),
        options,
        stopped_at: new Date().toISOString()
      }
    }).catch(() => null);
    throw error;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
