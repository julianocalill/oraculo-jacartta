import { createClient } from 'npm:@supabase/supabase-js@2';

const env = {
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  supabaseServiceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  olistApiTokenUrl: Deno.env.get('OLIST_API_TOKEN_URL') ?? '',
  olistApiClientId: Deno.env.get('OLIST_API_CLIENT_ID') ?? '',
  olistApiClientSecret: Deno.env.get('OLIST_API_CLIENT_SECRET') ?? '',
  olistOauthRedirectUri: Deno.env.get('OLIST_OAUTH_REDIRECT_URI') ?? '',
  olistOauthStateSecret: Deno.env.get('OLIST_OAUTH_STATE_SECRET') ?? ''
};

function requireValue(name: string, value: string) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function renderMessage(title: string, message: string) {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #111; color: #f7f7f7; display: grid; min-height: 100vh; place-items: center; }
      main { width: min(560px, calc(100vw - 40px)); border: 1px solid #333; border-radius: 12px; padding: 28px; background: #1c1c1c; }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { color: #cfcfcf; line-height: 1.55; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}

async function exchangeCode(code: string) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: env.olistApiClientId,
    client_secret: env.olistApiClientSecret,
    redirect_uri: env.olistOauthRedirectUri
  });

  const response = await fetch(env.olistApiTokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`Falha ao trocar code por token (${response.status}): ${text.slice(0, 300)}`);
  }

  if (!payload.refresh_token) {
    throw new Error('A resposta da Olist nao trouxe refresh_token.');
  }

  return payload as Record<string, unknown>;
}

Deno.serve(async (req) => {
  try {
    requireValue('SUPABASE_URL', env.supabaseUrl);
    requireValue('SUPABASE_SERVICE_ROLE_KEY', env.supabaseServiceRoleKey);
    requireValue('OLIST_API_TOKEN_URL', env.olistApiTokenUrl);
    requireValue('OLIST_API_CLIENT_ID', env.olistApiClientId);
    requireValue('OLIST_API_CLIENT_SECRET', env.olistApiClientSecret);
    requireValue('OLIST_OAUTH_REDIRECT_URI', env.olistOauthRedirectUri);
    requireValue('OLIST_OAUTH_STATE_SECRET', env.olistOauthStateSecret);

    const url = new URL(req.url);
    const code = url.searchParams.get('code') ?? '';
    const state = url.searchParams.get('state') ?? '';
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    if (error) {
      return htmlResponse(renderMessage('Autorizacao recusada', errorDescription || error), 400);
    }

    if (!code) {
      return htmlResponse(renderMessage('Code ausente', 'A Olist nao enviou o parametro code.'), 400);
    }

    if (state !== env.olistOauthStateSecret) {
      return htmlResponse(renderMessage('State invalido', 'A autorizacao foi rejeitada por seguranca.'), 401);
    }

    const payload = await exchangeCode(code);
    const expiresIn = Number(payload.expires_in ?? 0);
    const expiresAt = expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const { error: upsertError } = await supabase
      .from('olist_oauth_tokens')
      .upsert({
        provider: 'olist',
        access_token: typeof payload.access_token === 'string' ? payload.access_token : null,
        refresh_token: payload.refresh_token,
        expires_at: expiresAt,
        scope: typeof payload.scope === 'string' ? payload.scope : null,
        token_type: typeof payload.token_type === 'string' ? payload.token_type : null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'provider' });

    if (upsertError) throw upsertError;

    return htmlResponse(renderMessage(
      'Olist conectada',
      'O refresh token foi salvo no Supabase. A sincronizacao diaria ja pode usar essa autorizacao.'
    ));
  } catch (error) {
    console.error(error);
    return htmlResponse(renderMessage(
      'Erro ao conectar Olist',
      error instanceof Error ? error.message : String(error)
    ), 500);
  }
});
