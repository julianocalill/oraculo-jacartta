// TikTok Shop — callback de autorização OAuth.
//
// URL registrada no Partner Center ("URL de redirecionamento"):
//   https://bbtiipnmdxfxnxbemgjr.supabase.co/functions/v1/tiktok-oauth-callback
//
// Fluxo: o seller (Donacor) abre o link de autorização do serviço
// (https://services.tiktokshop.com/open/authorize?service_id=<service_id>),
// autoriza, e o TikTok redireciona para cá com ?code=<auth_code>. Esta função:
//   1. troca o auth_code por access_token + refresh_token (auth.tiktok-shops.com);
//   2. lista as lojas autorizadas (/authorization/202309/shops) para capturar o
//      shop_cipher (obrigatório em toda chamada de loja);
//   3. grava tiktok_tokens + tiktok_shops (service_role-only).
//
// Deploy com --no-verify-jwt (endpoint público, mesmo padrão do
// mercadolivre-oauth-callback). Um code inválido apenas falha na troca.

import { createClient } from "npm:@supabase/supabase-js@2";

const AUTH_HOST = "https://auth.tiktok-shops.com";
const API_HOST = "https://open-api.tiktokglobalshop.com";

const enc = new TextEncoder();

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
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Assinatura padrão do TikTok Shop Open API: secret + path + (params ordenados
// como chave+valor, exceto sign/access_token) + body + secret, HMAC-SHA256.
async function signRequest(
  appSecret: string,
  path: string,
  params: Record<string, string>,
  body = ""
): Promise<string> {
  const sorted = Object.keys(params)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  return hmacSha256Hex(appSecret, `${appSecret}${path}${sorted}${body}${appSecret}`);
}

// deno-lint-ignore no-explicit-any
async function tiktokJson(res: Response, context: string): Promise<any> {
  const json = await res.json().catch(() => null);
  if (!json) throw new Error(`${context}: resposta não-JSON (HTTP ${res.status})`);
  if (json.code !== 0) throw new Error(`${context}: ${json.code} ${json.message}`);
  return json.data;
}

async function exchangeCode(appKey: string, appSecret: string, authCode: string) {
  const qs = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    auth_code: authCode,
    grant_type: "authorized_code"
  });
  const res = await fetch(`${AUTH_HOST}/api/v2/token/get?${qs}`);
  return tiktokJson(res, "Falha ao trocar o auth_code");
}

async function getAuthorizedShops(appKey: string, appSecret: string, accessToken: string) {
  const path = "/authorization/202309/shops";
  const params: Record<string, string> = {
    app_key: appKey,
    timestamp: String(Math.floor(Date.now() / 1000))
  };
  params.sign = await signRequest(appSecret, path, params);
  const res = await fetch(`${API_HOST}${path}?${new URLSearchParams(params)}`, {
    headers: { "x-tts-access-token": accessToken, "Content-Type": "application/json" }
  });
  return tiktokJson(res, "Falha ao listar lojas autorizadas");
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code") ?? "";
    if (!code) return textResponse("Parametro ausente", "A resposta OAuth nao trouxe ?code.", 400);

    const { data: config } = await supabase
      .from("tiktok_app_config")
      .select("app_key, app_secret")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!config?.app_key || !config?.app_secret) {
      return textResponse("Configuracao ausente", "Cadastre app_key/app_secret em tiktok_app_config antes de autorizar.", 500);
    }

    const token = await exchangeCode(config.app_key, config.app_secret, code);
    const accessToken = typeof token.access_token === "string" ? token.access_token : "";
    const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token : "";
    const openId = typeof token.open_id === "string" ? token.open_id : "";
    if (!accessToken || !refreshToken || !openId) {
      throw new Error("A resposta OAuth não trouxe access_token/refresh_token/open_id.");
    }

    const now = new Date().toISOString();
    const tsToIso = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
    };

    const { error: tokenError } = await supabase.from("tiktok_tokens").upsert({
      app_key: config.app_key,
      open_id: openId,
      seller_name: token.seller_name ?? null,
      seller_base_region: token.seller_base_region ?? null,
      access_token: accessToken,
      refresh_token: refreshToken,
      access_token_expires_at: tsToIso(token.access_token_expire_in),
      refresh_token_expires_at: tsToIso(token.refresh_token_expire_in),
      raw_response: {
        open_id: token.open_id ?? null,
        seller_name: token.seller_name ?? null,
        seller_base_region: token.seller_base_region ?? null,
        user_type: token.user_type ?? null,
        access_token_expire_in: token.access_token_expire_in ?? null,
        refresh_token_expire_in: token.refresh_token_expire_in ?? null
      },
      updated_at: now
    }, { onConflict: "open_id" });
    if (tokenError) throw tokenError;

    const shopsData = await getAuthorizedShops(config.app_key, config.app_secret, accessToken);
    // deno-lint-ignore no-explicit-any
    const shops: any[] = shopsData?.shops ?? [];
    for (const s of shops) {
      const { error: shopError } = await supabase.from("tiktok_shops").upsert({
        shop_id: String(s.id),
        open_id: openId,
        shop_name: s.name ?? null,
        region: s.region ?? null,
        seller_type: s.seller_type ?? null,
        cipher: s.cipher ?? null,
        shop_code: s.code ?? null,
        is_active: true,
        updated_at: now
      }, { onConflict: "shop_id" });
      if (shopError) throw shopError;
    }

    const names = shops.map((s) => s.name ?? s.id).join(", ") || "(nenhuma loja retornada)";
    return textResponse(
      "TikTok Shop conectado",
      `Seller ${String(token.seller_name ?? openId)} autorizado. Lojas: ${names}. Tokens gravados no Oraculo.`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("tiktok-oauth-callback", message);
    return textResponse("Erro ao conectar TikTok Shop", message, 500);
  }
});
