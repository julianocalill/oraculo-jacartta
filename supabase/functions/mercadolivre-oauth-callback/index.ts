import { createClient } from "npm:@supabase/supabase-js@2";

const env = {
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  supabaseServiceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  appId: Deno.env.get("MERCADOLIVRE_APP_ID") ?? "",
  clientSecret: Deno.env.get("MERCADOLIVRE_CLIENT_SECRET") ?? "",
  redirectUri: Deno.env.get("MERCADOLIVRE_OAUTH_REDIRECT_URI") ?? ""
};

function textResponse(title: string, message: string, status = 200) {
  return new Response(`${title}\n\n${message}\n`, {
    status,
    // O gateway público do Supabase força text/plain + nosniff para HTML.
    // Manter a resposta textual evita exibir tags cruas no navegador.
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function requireEnv(name: string, value: string) {
  if (!value) throw new Error(`Configuração ausente: ${name}`);
}

async function parseJson(response: Response, context: string) {
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${context}: resposta inválida (${response.status})`);
  }
  if (!response.ok) {
    const description = payload.error_description ?? payload.message ?? payload.error ?? `HTTP ${response.status}`;
    throw new Error(`${context}: ${String(description)}`);
  }
  return payload;
}

async function exchangeCode(code: string, codeVerifier: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.appId,
    client_secret: env.clientSecret,
    code,
    redirect_uri: env.redirectUri,
    code_verifier: codeVerifier
  });
  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  return parseJson(response, "Falha ao trocar o código OAuth");
}

async function getCurrentSeller(accessToken: string) {
  const response = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }
  });
  return parseJson(response, "Falha ao validar a conta Mercado Livre");
}

Deno.serve(async (req) => {
  const startedAt = new Date().toISOString();
  let runId: string | null = null;
  const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  try {
    requireEnv("SUPABASE_URL", env.supabaseUrl);
    requireEnv("SUPABASE_SERVICE_ROLE_KEY", env.supabaseServiceRoleKey);
    requireEnv("MERCADOLIVRE_APP_ID", env.appId);
    requireEnv("MERCADOLIVRE_CLIENT_SECRET", env.clientSecret);
    requireEnv("MERCADOLIVRE_OAUTH_REDIRECT_URI", env.redirectUri);

    const url = new URL(req.url);
    const oauthError = url.searchParams.get("error");
    if (oauthError) return textResponse("Autorizacao nao concluida", url.searchParams.get("error_description") ?? oauthError, 400);

    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    if (!code || !state) return textResponse("Parametros ausentes", "A resposta OAuth nao trouxe code e state.", 400);

    const { data: stateRows, error: stateError } = await supabase
      .from("mercadolivre_oauth_states")
      .update({ consumed_at: new Date().toISOString() })
      .eq("state", state)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("code_verifier, redirect_uri")
      .limit(1);
    if (stateError) throw stateError;
    const oauthState = stateRows?.[0];
    if (!oauthState) return textResponse("Autorizacao expirada", "Gere um novo link de conexao e tente novamente.", 401);
    if (oauthState.redirect_uri !== env.redirectUri) throw new Error("A URI de retorno não corresponde ao estado OAuth.");

    const { data: run, error: runError } = await supabase
      .from("mercadolivre_connection_runs")
      .insert({ started_at: startedAt, status: "running", meta: { flow: "oauth_callback" } })
      .select("id")
      .single();
    if (runError) throw runError;
    runId = run.id;

    const token = await exchangeCode(code, oauthState.code_verifier);
    const accessToken = typeof token.access_token === "string" ? token.access_token : "";
    const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token : "";
    const sellerId = Number(token.user_id);
    if (!accessToken || !refreshToken || !Number.isSafeInteger(sellerId)) throw new Error("A resposta OAuth não trouxe tokens e seller_id válidos.");

    const seller = await getCurrentSeller(accessToken);
    const verifiedSellerId = Number(seller.id);
    if (!Number.isSafeInteger(verifiedSellerId) || verifiedSellerId !== sellerId) throw new Error("O seller retornado por /users/me não corresponde ao token.");

    const now = new Date().toISOString();
    const expiresIn = Number(token.expires_in ?? 0);
    const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
    const { error: accountError } = await supabase.from("mercadolivre_accounts").upsert({
      seller_id: sellerId,
      site_id: typeof seller.site_id === "string" ? seller.site_id : null,
      nickname: typeof seller.nickname === "string" ? seller.nickname : null,
      email: typeof seller.email === "string" ? seller.email : null,
      country_id: typeof seller.country_id === "string" ? seller.country_id : null,
      is_active: true,
      authorized_at: now,
      last_verified_at: now,
      raw_json: seller,
      updated_at: now
    }, { onConflict: "seller_id" });
    if (accountError) throw accountError;

    const { error: tokenError } = await supabase.from("mercadolivre_tokens").upsert({
      seller_id: sellerId,
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: typeof token.token_type === "string" ? token.token_type : null,
      scope: typeof token.scope === "string" ? token.scope : null,
      expires_at: expiresAt,
      raw_response: {
        token_type: token.token_type ?? null,
        expires_in: token.expires_in ?? null,
        scope: token.scope ?? null,
        user_id: token.user_id ?? null
      },
      updated_at: now
    }, { onConflict: "seller_id" });
    if (tokenError) throw tokenError;

    await supabase.from("mercadolivre_connection_runs").update({
      seller_id: sellerId,
      finished_at: new Date().toISOString(),
      status: "success",
      meta: { flow: "oauth_callback", site_id: seller.site_id ?? null, nickname: seller.nickname ?? null }
    }).eq("id", runId);
    await supabase.from("mercadolivre_oauth_states").delete().lt("expires_at", new Date().toISOString());

    return textResponse("Mercado Livre conectado", `A conta ${String(seller.nickname ?? sellerId)} foi validada e conectada ao Oraculo.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("mercadolivre-oauth-callback", message);
    if (runId) {
      await supabase.from("mercadolivre_connection_runs").update({
        finished_at: new Date().toISOString(), status: "failed", error_message: message
      }).eq("id", runId);
    }
    return textResponse("Erro ao conectar Mercado Livre", message, 500);
  }
});
