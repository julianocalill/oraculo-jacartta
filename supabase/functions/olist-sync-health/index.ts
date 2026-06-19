import { createClient } from 'npm:@supabase/supabase-js@2';

type LatestRun = {
  started_at?: string | null;
  finished_at?: string | null;
  status?: string | null;
  error_message?: string | null;
};

const env = {
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  supabaseServiceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  olistSyncJobSecret: Deno.env.get('OLIST_SYNC_JOB_SECRET') ?? '',
  olistApiClientId: Deno.env.get('OLIST_API_CLIENT_ID') ?? '',
  olistOauthRedirectUri: Deno.env.get('OLIST_OAUTH_REDIRECT_URI') ?? '',
  olistOauthStateSecret: Deno.env.get('OLIST_OAUTH_STATE_SECRET') ?? ''
};

function requireValue(name: string, value: string) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function todayBrt() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function brtDate(value?: string | null) {
  if (!value) return null;

  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(value));
}

function hasTokenFailure(run?: LatestRun | null) {
  const message = String(run?.error_message ?? '').toLowerCase();
  return message.includes('invalid_grant') || message.includes('token is not active');
}

function runFailed(run?: LatestRun | null) {
  return Boolean(run && run.status && run.status !== 'success');
}

function buildOauthAuthorizeUrl() {
  if (!env.olistApiClientId || !env.olistOauthRedirectUri || !env.olistOauthStateSecret) {
    return null;
  }

  const url = new URL('https://id.olist.com/openid/authorize');
  url.searchParams.set('client_id', env.olistApiClientId);
  url.searchParams.set('redirect_uri', env.olistOauthRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', env.olistOauthStateSecret);

  return url.toString();
}

Deno.serve(async (req) => {
  try {
    requireValue('SUPABASE_URL', env.supabaseUrl);
    requireValue('SUPABASE_SERVICE_ROLE_KEY', env.supabaseServiceRoleKey);
    requireValue('OLIST_SYNC_JOB_SECRET', env.olistSyncJobSecret);

    if (req.headers.get('x-sync-secret') !== env.olistSyncJobSecret) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false }
    });

    const [
      tokenResult,
      ordersRunResult,
      stockRunResult,
      dailySalesResult
    ] = await Promise.all([
      supabase
        .from('olist_oauth_tokens')
        .select('updated_at, expires_at, token_type, scope')
        .eq('provider', 'olist')
        .maybeSingle(),
      supabase
        .from('olist_sync_runs')
        .select('started_at, finished_at, status, window_start, window_end, records_fetched, records_upserted, error_message')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('olist_stock_sync_runs')
        .select('started_at, finished_at, status, records_fetched, records_upserted, error_message')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('oraculo_daily_sales')
        .select('order_date, orders_count, effective_revenue')
        .order('order_date', { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

    if (tokenResult.error) throw tokenResult.error;
    if (ordersRunResult.error) throw ordersRunResult.error;
    if (stockRunResult.error) throw stockRunResult.error;
    if (dailySalesResult.error) throw dailySalesResult.error;

    const token = tokenResult.data;
    const latestOrdersRun = ordersRunResult.data as LatestRun | null;
    const latestStockRun = stockRunResult.data as LatestRun | null;
    const today = todayBrt();
    const tokenExpired = !token?.expires_at || new Date(token.expires_at).getTime() <= Date.now();
    const ordersNotRunToday = brtDate(latestOrdersRun?.started_at) !== today;
    const stockNotRunToday = brtDate(latestStockRun?.started_at) !== today;
    const needsReauth = tokenExpired || hasTokenFailure(latestOrdersRun) || hasTokenFailure(latestStockRun);

    const alerts = [
      tokenExpired ? 'Token Olist expirado ou ausente.' : '',
      hasTokenFailure(latestOrdersRun) || hasTokenFailure(latestStockRun)
        ? 'Olist recusou o refresh token. E necessario reautorizar o aplicativo.'
        : '',
      runFailed(latestOrdersRun) ? `Sync de pedidos falhou: ${latestOrdersRun?.error_message ?? 'sem mensagem'}` : '',
      runFailed(latestStockRun) ? `Sync de estoque falhou: ${latestStockRun?.error_message ?? 'sem mensagem'}` : '',
      ordersNotRunToday ? 'Sync de pedidos ainda nao rodou hoje.' : '',
      stockNotRunToday ? 'Sync de estoque ainda nao rodou hoje.' : ''
    ].filter(Boolean);

    return jsonResponse({
      ok: alerts.length === 0,
      checked_at: new Date().toISOString(),
      today_brt: today,
      needs_reauth: needsReauth,
      oauth_authorize_url: needsReauth ? buildOauthAuthorizeUrl() : null,
      alerts,
      token: {
        updated_at: token?.updated_at ?? null,
        expires_at: token?.expires_at ?? null,
        expired: tokenExpired,
        token_type: token?.token_type ?? null,
        scope: token?.scope ?? null
      },
      latest_orders_run: latestOrdersRun,
      latest_stock_run: latestStockRun,
      latest_daily_sales: dailySalesResult.data ?? null
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});
