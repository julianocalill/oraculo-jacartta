// Sync de posições AIS dos navios das importações via VesselAPI.
//
// Substitui a coleta local do MVP rastreamento-importacoes: busca a última
// posição conhecida (LastKnownPosition) de cada navio com MMSI referenciado
// pelas faturas ativas e faz upsert em importacao_posicoes — somente quando a
// posição recebida é mais recente que a armazenada, como no MVP.
//
// Body opcional (POST JSON): { "all": true } sincroniza todos os navios do
// registro com MMSI, não só os referenciados por faturas.

import { createClient } from 'npm:@supabase/supabase-js@2';

const env = {
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  supabaseServiceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  vesselApiKey: Deno.env.get('VESSELAPI_API_KEY') ?? '',
  vesselApiBaseUrl: Deno.env.get('VESSELAPI_BASE_URL') ?? 'https://api.vesselapi.com/v1',
  jobSecret: Deno.env.get('IMPORTACOES_AIS_JOB_SECRET') ?? ''
};

type Navio = { name: string; aliases: string[] | null; mmsi: string | null };
type Fatura = { vessel_name: string | null };

type Position = {
  mmsi: string;
  vessel_name: string | null;
  latitude: number;
  longitude: number;
  speed_knots: number | null;
  course_degrees: number | null;
  heading_degrees: number | null;
  provider: string;
  observed_at: string | null;
  received_at: string;
  updated_at: string;
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

function normalizeName(value: string | null | undefined) {
  return (value ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
}

async function fetchLastPosition(mmsi: string): Promise<Position | null> {
  const url = new URL(`${env.vesselApiBaseUrl.replace(/\/$/, '')}/vessel/${encodeURIComponent(mmsi)}/position`);
  url.searchParams.set('filter.idType', 'mmsi');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.vesselApiKey}`, Accept: 'application/json' }
  });

  if (response.status === 404) return null;

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      body?.error?.message || `VesselAPI respondeu com HTTP ${response.status} para MMSI ${mmsi}`
    );
  }

  const data = body.vesselPosition || body.vessel_position || body.data || body;
  if (!data || !Number.isFinite(Number(data.latitude)) || !Number.isFinite(Number(data.longitude))) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    mmsi: String(data.mmsi ?? mmsi),
    vessel_name: data.vessel_name || null,
    latitude: Number(data.latitude),
    longitude: Number(data.longitude),
    speed_knots: data.sog == null ? null : Number(data.sog),
    course_degrees: data.cog == null ? null : Number(data.cog),
    heading_degrees: data.heading == null ? null : Number(data.heading),
    provider: 'vesselapi',
    observed_at: data.timestamp || null,
    received_at: now,
    updated_at: now
  };
}

function isNewer(incoming: Position, existing: { observed_at: string | null } | undefined) {
  if (!existing) return true;
  if (!incoming.observed_at) return false;
  if (!existing.observed_at) return true;
  return new Date(incoming.observed_at).getTime() > new Date(existing.observed_at).getTime();
}

Deno.serve(async (req) => {
  const startedAt = new Date().toISOString();

  try {
    requireValue('SUPABASE_URL', env.supabaseUrl);
    requireValue('SUPABASE_SERVICE_ROLE_KEY', env.supabaseServiceRoleKey);
    requireValue('VESSELAPI_API_KEY', env.vesselApiKey);
    requireValue('IMPORTACOES_AIS_JOB_SECRET', env.jobSecret);

    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    if (req.headers.get('x-sync-secret') !== env.jobSecret) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const requestBody = req.headers.get('content-type')?.includes('application/json')
      ? await req.json().catch(() => ({}))
      : {};
    const syncAll = Boolean((requestBody as { all?: boolean }).all);

    const [naviosResponse, faturasResponse] = await Promise.all([
      supabase.from('importacao_navios').select('name, aliases, mmsi'),
      supabase.from('importacao_faturas').select('vessel_name')
    ]);

    if (naviosResponse.error) throw naviosResponse.error;
    if (faturasResponse.error) throw faturasResponse.error;

    const navios = (naviosResponse.data ?? []) as Navio[];
    const faturas = (faturasResponse.data ?? []) as Fatura[];

    // Nomes de navio citados nas faturas (forma manual da planilha/cadastro)
    const referencedNames = new Set(
      faturas.map((fatura) => normalizeName(fatura.vessel_name)).filter(Boolean)
    );

    const targets = navios.filter((navio) => {
      if (!navio.mmsi) return false;
      if (syncAll) return true;
      if (referencedNames.has(normalizeName(navio.name))) return true;
      return (navio.aliases ?? []).some((alias) => referencedNames.has(normalizeName(alias)));
    });

    const mmsis = [...new Set(targets.map((navio) => navio.mmsi as string))];

    const { data: existingRows, error: existingError } = await supabase
      .from('importacao_posicoes')
      .select('mmsi, observed_at')
      .in('mmsi', mmsis.length > 0 ? mmsis : ['-']);

    if (existingError) throw existingError;
    const existingByMmsi = new Map(
      (existingRows ?? []).map((row) => [row.mmsi as string, row as { observed_at: string | null }])
    );

    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const mmsi of mmsis) {
      try {
        const position = await fetchLastPosition(mmsi);
        if (!position || !isNewer(position, existingByMmsi.get(mmsi))) {
          skipped += 1;
          continue;
        }

        const { error } = await supabase
          .from('importacao_posicoes')
          .upsert(position, { onConflict: 'mmsi' });

        if (error) throw error;
        updated += 1;
      } catch (error) {
        errors.push(`${mmsi}: ${error instanceof Error ? error.message : String(error)}`);
      }

      // gentileza com o rate limit do plano gratuito
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const status = errors.length === 0 ? 'success' : updated > 0 ? 'partial' : 'error';
    const { error: logError } = await supabase.from('importacao_ais_sync_runs').insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      vessels_targeted: mmsis.length,
      positions_updated: updated,
      positions_skipped: skipped,
      error_message: errors.length > 0 ? errors.join(' | ').slice(0, 2000) : null
    });

    if (logError) throw logError;

    return jsonResponse({
      ok: errors.length === 0,
      targeted: mmsis.length,
      updated,
      skipped,
      errors
    });
  } catch (error) {
    console.error(error);

    try {
      const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      await supabase.from('importacao_ais_sync_runs').insert({
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: 'error',
        vessels_targeted: 0,
        positions_updated: 0,
        positions_skipped: 0,
        error_message: (error instanceof Error ? error.message : String(error)).slice(0, 2000)
      });
    } catch {
      // log best-effort
    }

    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500
    );
  }
});
