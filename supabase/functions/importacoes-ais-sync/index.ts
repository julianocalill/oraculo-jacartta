// Sync de posições AIS dos navios das importações via aisstream.io.
//
// TROCA DE PROVEDOR (2026-08-10): antes usava a VesselAPI por REST. O plano
// gratuito dela dá 150 chamadas/mês e o sync consome ~360 (3 navios × 4x/dia),
// então a cota estourou em 19/07 e as posições ficaram congeladas por 22 dias
// mostrando navio na China com contêiner já entregue no Brasil. A aisstream é
// gratuita e sem cota, com a MESMA cobertura terrestre da VesselAPI paga.
//
// Consequência do modelo: aisstream é STREAM, não request/response. Não existe
// "me dá a última posição do MMSI X" — a gente abre o WebSocket, assina os
// MMSIs de interesse e espera o navio transmitir. Por isso:
//   * a função escuta uma janela fixa (listenSeconds) e encerra;
//   * navio fora do alcance das antenas costeiras (~200 km) simplesmente não
//     transmite na janela — isso é NORMAL, não é falha. Um run que não recebeu
//     nada é 'success' com positions_skipped, senão o /status passaria a gritar
//     falso positivo toda vez que a frota estivesse em alto-mar.
//
// Só rastreia navio com carga a bordo: MMSIs vêm das faturas NÃO entregues
// (view importacao_faturas_status, migration 20260810140000). Contêiner
// entregue = navio deixa de ser assunto nosso.
//
// Body opcional (POST JSON):
//   { "all": true }          — todos os navios do registro com MMSI
//   { "listenSeconds": 90 }  — tamanho da janela de escuta (padrão 75s)

import { createClient } from 'npm:@supabase/supabase-js@2';

const env = {
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  supabaseServiceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  aisStreamApiKey: Deno.env.get('AISSTREAM_API_KEY') ?? '',
  aisStreamUrl: Deno.env.get('AISSTREAM_URL') ?? 'wss://stream.aisstream.io/v0/stream',
  jobSecret: Deno.env.get('IMPORTACOES_AIS_JOB_SECRET') ?? ''
};

// Janela de escuta. Precisa caber no wall clock da Edge Function com folga
// para o upsert e o log do run.
const DEFAULT_LISTEN_SECONDS = 75;
const MAX_LISTEN_SECONDS = 120;
// Limite documentado da aisstream: no máximo 50 MMSIs por subscription.
const MAX_MMSI_FILTERS = 50;

type Navio = { name: string; aliases: string[] | null; mmsi: string | null };
type Fatura = { vessel_name: string | null; entregue: boolean | null };

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

/**
 * A aisstream manda o timestamp no formato do Go
 * ("2026-08-10 12:00:00.000000000 +0000 UTC"), que `new Date()` não entende.
 * Extrai a parte estável e devolve ISO; se não casar, cai para null e o
 * chamador usa o horário de recebimento.
 */
function parseAisTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const match = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!match) {
    const direct = new Date(value);
    return Number.isNaN(direct.getTime()) ? null : direct.toISOString();
  }

  const parsed = new Date(`${match[1]}T${match[2]}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function finiteOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Abre o WebSocket, assina os MMSIs e coleta a posição mais recente de cada um
 * durante a janela. Encerra assim que todos reportarem (caso feliz) ou quando
 * a janela expira. Nunca rejeita por silêncio: devolve o que conseguiu.
 */
function collectPositions(mmsis: string[], listenSeconds: number): Promise<{
  positions: Map<string, Position>;
  connectError: string | null;
}> {
  return new Promise((resolve) => {
    const positions = new Map<string, Position>();
    const pending = new Set(mmsis);
    const startedAt = Date.now();
    let settled = false;
    let connectError: string | null = null;
    let subscribedAt = 0;
    let socket: WebSocket;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(windowTimer);
      try {
        socket?.close();
      } catch {
        // socket já pode ter fechado sozinho
      }
      resolve({ positions, connectError });
    };

    const windowTimer = setTimeout(finish, listenSeconds * 1000);

    try {
      socket = new WebSocket(env.aisStreamUrl);
    } catch (error) {
      connectError = error instanceof Error ? error.message : String(error);
      finish();
      return;
    }

    socket.onopen = () => {
      // A subscription precisa chegar em até 3s da conexão, senão o servidor
      // derruba. BoundingBoxes é obrigatório mesmo filtrando por MMSI — o
      // mundo inteiro é o filtro neutro aqui.
      socket.send(
        JSON.stringify({
          APIKey: env.aisStreamApiKey,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FiltersShipMMSI: mmsis,
          FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport']
        })
      );
      subscribedAt = Date.now();
    };

    socket.onmessage = (event) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }

      // Erro de autenticação/subscription vem como texto, não como posição.
      if (typeof payload.error === 'string' && payload.error) {
        connectError = payload.error;
        finish();
        return;
      }

      const metadata = (payload.MetaData ?? payload.Metadata) as Record<string, unknown> | undefined;
      if (!metadata) return;

      const mmsi = String(metadata.MMSI ?? '');
      if (!mmsi || !pending.has(mmsi)) return;

      const messageType = String(payload.MessageType ?? '');
      const message = (payload.Message as Record<string, unknown> | undefined)?.[messageType] as
        | Record<string, unknown>
        | undefined;

      const latitude = finiteOrNull(message?.Latitude ?? metadata.latitude);
      const longitude = finiteOrNull(message?.Longitude ?? metadata.longitude);
      if (latitude == null || longitude == null) return;

      const observedAt = parseAisTimestamp(metadata.time_utc);
      const now = new Date().toISOString();

      positions.set(mmsi, {
        mmsi,
        vessel_name: typeof metadata.ShipName === 'string' ? metadata.ShipName.trim() || null : null,
        latitude,
        longitude,
        speed_knots: finiteOrNull(message?.Sog),
        course_degrees: finiteOrNull(message?.Cog),
        heading_degrees: finiteOrNull(message?.TrueHeading),
        provider: 'aisstream',
        observed_at: observedAt ?? now,
        received_at: now,
        updated_at: now
      });

      // Cada navio transmite várias vezes por minuto; a primeira já serve.
      pending.delete(mmsi);
      if (pending.size === 0) finish();
    };

    // A aisstream não manda mensagem de erro quando a chave é inválida: ela
    // simplesmente derruba o socket (close 1006) ~1s depois da subscription.
    // Sem essa distinção, chave errada e navio em alto-mar viram o mesmo
    // "falha na conexão" e a investigação recomeça do zero toda vez.
    const diagnoseClose = () => {
      if (connectError || positions.size > 0) return;
      const elapsed = Date.now() - startedAt;
      if (subscribedAt > 0 && Date.now() - subscribedAt < 5_000) {
        connectError =
          'aisstream rejeitou a conexão logo após a subscription — normalmente AISSTREAM_API_KEY inválida ou não ativada';
      } else if (elapsed < listenSeconds * 900) {
        connectError = `aisstream encerrou a conexão após ${Math.round(elapsed / 1000)}s`;
      }
    };

    socket.onerror = () => {
      diagnoseClose();
      finish();
    };

    socket.onclose = () => {
      diagnoseClose();
      finish();
    };
  });
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
    requireValue('AISSTREAM_API_KEY', env.aisStreamApiKey);
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
    const listenSeconds = Math.min(
      MAX_LISTEN_SECONDS,
      Math.max(15, Number((requestBody as { listenSeconds?: number }).listenSeconds) || DEFAULT_LISTEN_SECONDS)
    );

    const [naviosResponse, faturasResponse] = await Promise.all([
      supabase.from('importacao_navios').select('name, aliases, mmsi'),
      supabase.from('importacao_faturas_status').select('vessel_name, entregue')
    ]);

    if (naviosResponse.error) throw naviosResponse.error;
    if (faturasResponse.error) throw faturasResponse.error;

    const navios = (naviosResponse.data ?? []) as Navio[];
    const faturas = (faturasResponse.data ?? []) as Fatura[];

    // Só navios com carga a bordo: fatura entregue não gera rastreamento.
    const referencedNames = new Set(
      faturas
        .filter((fatura) => !fatura.entregue)
        .map((fatura) => normalizeName(fatura.vessel_name))
        .filter(Boolean)
    );

    const targets = navios.filter((navio) => {
      if (!navio.mmsi) return false;
      if (syncAll) return true;
      if (referencedNames.has(normalizeName(navio.name))) return true;
      return (navio.aliases ?? []).some((alias) => referencedNames.has(normalizeName(alias)));
    });

    const mmsis = [...new Set(targets.map((navio) => navio.mmsi as string))].slice(0, MAX_MMSI_FILTERS);

    // Sem navio em trânsito não há o que escutar — e abrir o socket à toa só
    // gera ruído no log. Run de sucesso com zero alvos é o estado correto.
    if (mmsis.length === 0) {
      await supabase.from('importacao_ais_sync_runs').insert({
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: 'success',
        vessels_targeted: 0,
        positions_updated: 0,
        positions_skipped: 0,
        error_message: null
      });

      return jsonResponse({ ok: true, targeted: 0, updated: 0, skipped: 0, silent: [] });
    }

    const { data: existingRows, error: existingError } = await supabase
      .from('importacao_posicoes')
      .select('mmsi, observed_at')
      .in('mmsi', mmsis);

    if (existingError) throw existingError;
    const existingByMmsi = new Map(
      (existingRows ?? []).map((row) => [row.mmsi as string, row as { observed_at: string | null }])
    );

    const { positions, connectError } = await collectPositions(mmsis, listenSeconds);

    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const [mmsi, position] of positions) {
      if (!isNewer(position, existingByMmsi.get(mmsi))) {
        skipped += 1;
        continue;
      }

      const { error } = await supabase
        .from('importacao_posicoes')
        .upsert(position, { onConflict: 'mmsi' });

      if (error) {
        errors.push(`${mmsi}: ${error.message}`);
        continue;
      }
      updated += 1;
    }

    // Navio que não transmitiu na janela: fora do alcance costeiro, fundeado
    // com AIS ocioso ou simplesmente sem estação por perto. Conta como pulado,
    // nunca como erro — é o comportamento esperado de AIS terrestre.
    const silent = mmsis.filter((mmsi) => !positions.has(mmsi));
    skipped += silent.length;

    if (connectError) errors.push(connectError);

    const status = errors.length === 0 ? 'success' : updated > 0 ? 'partial' : 'error';
    const notes = [
      silent.length > 0 ? `sem sinal na janela: ${silent.join(', ')}` : '',
      ...errors
    ].filter(Boolean);

    const { error: logError } = await supabase.from('importacao_ais_sync_runs').insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status,
      vessels_targeted: mmsis.length,
      positions_updated: updated,
      positions_skipped: skipped,
      // Mesmo em 'success' o detalhe fica registrado: "quem não deu sinal" é a
      // pergunta que se faz quando o mapa parece velho.
      error_message: notes.length > 0 ? notes.join(' | ').slice(0, 2000) : null
    });

    if (logError) throw logError;

    return jsonResponse({
      ok: errors.length === 0,
      targeted: mmsis.length,
      updated,
      skipped,
      silent,
      listenSeconds,
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
