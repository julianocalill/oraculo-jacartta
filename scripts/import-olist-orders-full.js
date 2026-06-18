#!/usr/bin/env node

const { readFileSync } = require("node:fs");
const { join } = require("node:path");

function loadEnv() {
  const envPath = join(process.cwd(), ".env");
  const file = readFileSync(envPath, "utf8");
  const env = {};

  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    env[key] = value;
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

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function parseJson(text, context) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context}: resposta nao veio em JSON`);
  }
}

function normalizeOrderRows(payload) {
  const container = payload && typeof payload === "object" ? payload : {};
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(container.itens)
      ? container.itens
      : Array.isArray(container.items)
        ? container.items
        : Array.isArray(container.data)
          ? container.data
          : Array.isArray(container.pedidos)
            ? container.pedidos
            : [];

  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const id = String(
        row.id ??
        row.codigo ??
        row.numero ??
        row.numeroPedido ??
        row.numero_pedido ??
        row.numeroPedidoEcommerce ??
        ""
      ).trim();

      if (!id) {
        throw new Error("Encontrado pedido sem identificador.");
      }

      return {
        id,
        numero_pedido: row.numeroPedido ?? row.numero_pedido ?? row.numero ?? null,
        situacao: row.situacao ?? row.status ?? null,
        data_criacao: row.dataCriacao ?? row.data_criacao ?? row.created_at ?? null,
        data_atualizacao: row.dataAtualizacao ?? row.data_atualizacao ?? row.updated_at ?? null,
        cliente: row.cliente && typeof row.cliente === "object" ? row.cliente : {},
        transportador: row.transportador && typeof row.transportador === "object" ? row.transportador : {},
        payload: row,
        synced_at: new Date().toISOString()
      };
    });
}

async function supabaseFetch(env, path, options = {}) {
  const url = new URL(path, env.SUPABASE_URL.endsWith("/") ? env.SUPABASE_URL : `${env.SUPABASE_URL}/`);
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers
  });
  const text = await response.text();
  return { response, text };
}

async function getStoredRefreshToken(env) {
  const { response, text } = await supabaseFetch(
    env,
    `rest/v1/olist_oauth_tokens?provider=eq.olist&select=refresh_token&limit=1`
  );

  if (!response.ok) {
    throw new Error(`Falha ao ler refresh token salvo (${response.status}): ${text.slice(0, 300)}`);
  }

  const rows = parseJson(text, "Falha ao ler refresh token salvo");
  return Array.isArray(rows) && rows[0] ? String(rows[0].refresh_token || "") : "";
}

async function refreshAccessToken(env, refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.OLIST_API_CLIENT_ID,
    client_secret: env.OLIST_API_CLIENT_SECRET
  });

  const response = await fetch(env.OLIST_API_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Falha ao renovar token da Olist (${response.status}): ${text.slice(0, 300)}`);
  }

  const payload = parseJson(text, "Falha ao renovar token da Olist");
  if (typeof payload.access_token !== "string") {
    throw new Error("A resposta de token da Olist nao trouxe access_token.");
  }

  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : refreshToken,
    expiresAt: Number(payload.expires_in ?? 0) > 0
      ? new Date(Date.now() + Number(payload.expires_in) * 1000).toISOString()
      : null,
    scope: typeof payload.scope === "string" ? payload.scope : null,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : null
  };
}

async function saveToken(env, token) {
  const { response, text } = await supabaseFetch(env, "rest/v1/olist_oauth_tokens?on_conflict=provider", {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify([
      {
        provider: "olist",
        access_token: token.accessToken,
        refresh_token: token.refreshToken,
        expires_at: token.expiresAt,
        scope: token.scope,
        token_type: token.tokenType,
        updated_at: new Date().toISOString()
      }
    ])
  });

  if (!response.ok) {
    throw new Error(`Falha ao salvar token renovado (${response.status}): ${text.slice(0, 300)}`);
  }
}

async function fetchOrdersPage(env, accessToken, startDate, endDate, limit, offset) {
  const baseUrl = env.OLIST_API_BASE_URL.endsWith("/")
    ? env.OLIST_API_BASE_URL
    : `${env.OLIST_API_BASE_URL}/`;
  const url = new URL("pedidos", baseUrl);

  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("orderBy", "desc");
  url.searchParams.set("dataInicial", startDate);
  url.searchParams.set("dataFinal", endDate);

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      [env.OLIST_API_AUTH_HEADER || "Authorization"]: env.OLIST_API_AUTH_PREFIX
        ? `${env.OLIST_API_AUTH_PREFIX} ${accessToken}`
        : accessToken
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Falha ao buscar pedidos da Olist (${response.status}): ${text.slice(0, 300)}`);
  }

  return parseJson(text, "Falha ao buscar pedidos da Olist");
}

async function upsertOrders(env, rows) {
  for (const group of chunk(rows, 50)) {
    const { response, text } = await supabaseFetch(env, "rest/v1/olist_orders?on_conflict=id", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(group)
    });

    if (!response.ok) {
      throw new Error(`Falha ao gravar pedidos (${response.status}): ${text.slice(0, 300)}`);
    }
  }
}

async function insertRun(env, run) {
  const { response, text } = await supabaseFetch(env, "rest/v1/olist_sync_runs", {
    method: "POST",
    headers: {
      Prefer: "return=minimal"
    },
    body: JSON.stringify([run])
  });

  if (!response.ok) {
    throw new Error(`Falha ao registrar execução (${response.status}): ${text.slice(0, 300)}`);
  }
}

async function main() {
  const env = loadEnv();
  requireEnv(env, "SUPABASE_URL");
  requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  requireEnv(env, "OLIST_API_BASE_URL");
  requireEnv(env, "OLIST_API_TOKEN_URL");
  requireEnv(env, "OLIST_API_CLIENT_ID");
  requireEnv(env, "OLIST_API_CLIENT_SECRET");
  requireEnv(env, "OLIST_API_AUTH_HEADER");
  requireEnv(env, "OLIST_SYNC_JOB_SECRET");

  const startDate = process.env.ORDER_BACKFILL_START_DATE || "2023-06-17";
  const endDate = process.env.ORDER_BACKFILL_END_DATE || toIsoDate(new Date());
  const windowDays = Number(process.env.ORDER_BACKFILL_WINDOW_DAYS || "30");
  const limit = Number(process.env.ORDER_PAGE_LIMIT || "100");

  const storedRefreshToken = await getStoredRefreshToken(env);
  if (!storedRefreshToken) {
    throw new Error("Nao encontrei refresh_token salvo em olist_oauth_tokens.");
  }

  const token = await refreshAccessToken(env, storedRefreshToken);
  await saveToken(env, token);

  const accessToken = token.accessToken;
  let windowStart = new Date(startDate);
  const finalEnd = new Date(`${endDate}T23:59:59.999Z`);
  let totalFetched = 0;
  let totalUpserted = 0;
  let windowsProcessed = 0;

  while (windowStart <= finalEnd) {
    const rawWindowEnd = addDays(windowStart, windowDays - 1);
    const windowEnd = rawWindowEnd > finalEnd ? finalEnd : rawWindowEnd;
    const windowStartIso = toIsoDate(windowStart);
    const windowEndIso = toIsoDate(windowEnd);

    const run = {
      started_at: new Date().toISOString(),
      finished_at: null,
      status: "running",
      window_start: windowStartIso,
      window_end: windowEndIso,
      records_fetched: 0,
      records_upserted: 0,
      error_message: null
    };

    try {
      let offset = 0;
      const rows = [];

      for (let page = 0; page < 1000; page += 1) {
        const payload = await fetchOrdersPage(env, accessToken, windowStartIso, windowEndIso, limit, offset);
        const normalized = normalizeOrderRows(payload);

        if (normalized.length === 0) {
          break;
        }

        rows.push(...normalized);
        offset += normalized.length;

        if (normalized.length < limit) {
          break;
        }
      }

      await upsertOrders(env, rows);

      run.status = "success";
      run.finished_at = new Date().toISOString();
      run.records_fetched = rows.length;
      run.records_upserted = rows.length;
      await insertRun(env, run);

      totalFetched += rows.length;
      totalUpserted += rows.length;
      windowsProcessed += 1;
      console.log(`[${windowStartIso} → ${windowEndIso}] ${rows.length} pedidos`);
    } catch (error) {
      run.status = "failed";
      run.finished_at = new Date().toISOString();
      run.error_message = error instanceof Error ? error.message : String(error);
      await insertRun(env, run);
      throw error;
    }

    windowStart = addDays(windowEnd, 1);
  }

  console.log(JSON.stringify({
    ok: true,
    windowsProcessed,
    totalFetched,
    totalUpserted,
    startDate,
    endDate
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
