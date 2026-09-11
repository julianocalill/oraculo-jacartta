// Shopee Open Platform — autorização da conta Giracasa.
//
// POST autenticado por x-sync-secret gera o link assinado de autorização.
// GET recebe code, shop_id e o state assinado, troca o code por tokens e grava
// somente no schema giracasa. Tokens e partner_key nunca aparecem na resposta.

import { createClient } from "npm:@supabase/supabase-js@2";

const SHOPEE_HOST = "https://partner.shopeemobile.com";
const AUTH_PATH = "/api/v2/shop/auth_partner";
const TOKEN_PATH = "/api/v2/auth/token/get";
const STATE_MAX_AGE_SECONDS = 15 * 60;

const env = {
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  supabaseServiceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  partnerId: Deno.env.get("GIRACASA_SHOPEE_PARTNER_ID") ?? "",
  partnerKey: Deno.env.get("GIRACASA_SHOPEE_PARTNER_KEY") ?? "",
  redirectUri: Deno.env.get("GIRACASA_SHOPEE_REDIRECT_URI") ?? "",
  syncSecret: Deno.env.get("GIRACASA_SHOPEE_SYNC_SECRET") ?? "",
  stateSecret: Deno.env.get("GIRACASA_SHOPEE_OAUTH_STATE_SECRET") ?? ""
};

const enc = new TextEncoder();

function requireValue(name: string, value: string) {
  if (!value) throw new Error(`Configuracao ausente: ${name}`);
}

function callbackUrl() {
  return `${env.supabaseUrl.replace(/\/$/, "")}/functions/v1/giracasa-shopee-oauth-callback`;
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function textResponse(title: string, message: string, status = 200) {
  return new Response(`${title}\n\n${message}\n`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
  });
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function signPublicPath(path: string, timestamp: number) {
  return hmacSha256Hex(env.partnerKey, `${env.partnerId}${path}${timestamp}`);
}

async function createState() {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = `${issuedAt}.${crypto.randomUUID()}`;
  const signature = await hmacSha256Hex(env.stateSecret, payload);
  return `${payload}.${signature}`;
}

async function validState(state: string) {
  const [issuedAtText, nonce, signature, ...extra] = state.split(".");
  if (!issuedAtText || !nonce || !signature || extra.length) return false;
  const issuedAt = Number(issuedAtText);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > now + 30 || now - issuedAt > STATE_MAX_AGE_SECONDS) return false;
  const expected = await hmacSha256Hex(env.stateSecret, `${issuedAtText}.${nonce}`);
  return safeEqual(signature, expected);
}

async function authorizationUrl() {
  const timestamp = Math.floor(Date.now() / 1000);
  const state = await createState();
  const redirect = new URL(env.redirectUri);
  redirect.searchParams.set("state", state);
  const url = new URL(`${SHOPEE_HOST}${AUTH_PATH}`);
  url.searchParams.set("partner_id", env.partnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", await signPublicPath(AUTH_PATH, timestamp));
  url.searchParams.set("redirect", redirect.toString());
  return url.toString();
}

async function exchangeCode(code: string, shopId: number) {
  const timestamp = Math.floor(Date.now() / 1000);
  const url = new URL(`${SHOPEE_HOST}${TOKEN_PATH}`);
  url.searchParams.set("partner_id", env.partnerId);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", await signPublicPath(TOKEN_PATH, timestamp));
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      code,
      shop_id: shopId,
      partner_id: Number(env.partnerId)
    })
  });
  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`A Shopee respondeu um conteudo invalido (HTTP ${response.status}).`);
  }
  if (!response.ok || payload.error) {
    throw new Error(`Falha ao trocar code por token: ${String(payload.error || response.status)} ${String(payload.message || "")}`.trim());
  }
  return payload;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

Deno.serve(async (req) => {
  try {
    requireValue("SUPABASE_URL", env.supabaseUrl);
    requireValue("SUPABASE_SERVICE_ROLE_KEY", env.supabaseServiceRoleKey);
    requireValue("GIRACASA_SHOPEE_PARTNER_ID", env.partnerId);
    requireValue("GIRACASA_SHOPEE_PARTNER_KEY", env.partnerKey);
    requireValue("GIRACASA_SHOPEE_REDIRECT_URI", env.redirectUri);
    requireValue("GIRACASA_SHOPEE_SYNC_SECRET", env.syncSecret);
    requireValue("GIRACASA_SHOPEE_OAUTH_STATE_SECRET", env.stateSecret);

    if (req.method === "POST") {
      const provided = req.headers.get("x-sync-secret") ?? "";
      if (!safeEqual(provided, env.syncSecret)) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
      return jsonResponse({ ok: true, authorization_url: await authorizationUrl(), expires_in: STATE_MAX_AGE_SECONDS });
    }

    const url = new URL(req.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      return textResponse("Autorizacao Shopee nao concluida", url.searchParams.get("message") ?? oauthError, 400);
    }

    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const shopIdFromCallback = positiveInteger(url.searchParams.get("shop_id"));
    if (!code || !state || !shopIdFromCallback) {
      return textResponse("Parametros ausentes", "Use o link de autorizacao gerado pelo Oraculo.", 400);
    }
    if (!(await validState(state))) {
      return textResponse("Autorizacao expirada", "Gere um novo link e tente novamente.", 401);
    }

    const token = await exchangeCode(code, shopIdFromCallback);
    const accessToken = typeof token.access_token === "string" ? token.access_token : "";
    const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token : "";
    const shopIds = Array.isArray(token.shop_id_list) ? token.shop_id_list.map(positiveInteger).filter(Boolean) : [];
    const shopId = positiveInteger(shopIds[0]) ?? shopIdFromCallback;
    if (!accessToken || !refreshToken || shopId !== shopIdFromCallback) {
      throw new Error("A resposta da Shopee nao trouxe tokens validos para a loja autorizada.");
    }

    const now = new Date().toISOString();
    const expireIn = Number(token.expire_in ?? 0);
    const expiresAt = Number.isFinite(expireIn) && expireIn > 0
      ? new Date(Date.now() + expireIn * 1000).toISOString()
      : null;
    const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: "giracasa" }
    });

    const { error: configError } = await supabase.from("shopee_app_config").upsert({
      partner_id: env.partnerId,
      partner_key: env.partnerKey,
      is_active: true,
      updated_at: now
    }, { onConflict: "partner_id" });
    if (configError) throw configError;

    const { error: shopError } = await supabase.from("shopee_shops").upsert({
      shop_id: shopId,
      partner_id: Number(env.partnerId),
      shop_name: "Giracasa — Shopee",
      is_active: true,
      updated_at: now
    }, { onConflict: "shop_id" });
    if (shopError) throw shopError;

    const { error: tokenError } = await supabase.from("shopee_tokens").upsert({
      shop_id: shopId,
      partner_id: Number(env.partnerId),
      access_token: accessToken,
      refresh_token: refreshToken,
      access_token_expires_at: expiresAt,
      refresh_token_expires_at: null,
      raw_response: {
        request_id: token.request_id ?? null,
        expire_in: token.expire_in ?? null,
        shop_id_list: token.shop_id_list ?? null,
        merchant_id_list: token.merchant_id_list ?? null
      },
      updated_at: now
    }, { onConflict: "shop_id" });
    if (tokenError) throw tokenError;

    return textResponse(
      "Shopee Giracasa conectada",
      `Loja ${shopId} autorizada. Os tokens foram salvos no Supabase sem ativar a operacao.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("giracasa-shopee-oauth-callback", message);
    return req.method === "POST"
      ? jsonResponse({ ok: false, error: message }, 500)
      : textResponse("Erro ao conectar Shopee", message, 500);
  }
});
