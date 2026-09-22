// Recria a janela do PDF como lista personalizada, sem cursor nem WhatsApp.
// --new cria outra fotografia mesmo quando já existe lista dessa janela.
const originalListId = 'd70a93fc-f504-4779-bd3b-75881cbd184a';
const start = '2026-09-21T17:30:00Z';
const end = '2026-09-22T10:00:00Z';
const createNew = process.argv.includes('--new');
const base = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const webhook = process.env.N8N_SEPARATION_WEBHOOK_URL;
const secret = process.env.N8N_SEPARATION_WEBHOOK_SECRET;
if (![base, key, webhook, secret].every(Boolean)) throw new Error('Ambiente da separação incompleto.');

async function db(path, options = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
      ...options.headers },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

const query = new URLSearchParams({ select: 'id,status,created_at',
  operation_id: 'eq.uberlandia', kind: 'eq.custom',
  cursor_start: `eq.${start}`, cursor_end: `eq.${end}`, order: 'created_at.desc' });
const lists = await db(`logistica_picking_listas?${query}`);
const existing = createNew ? null : lists.find((list) => list.id !== originalListId);
if (existing) {
  console.log(JSON.stringify({ reused: true, id: existing.id, status: existing.status }));
  process.exit(0);
}

const active = await db('logistica_picking_listas?select=id,status&operation_id=eq.uberlandia&status=in.(pending,syncing,processing)&limit=1');
if (active.length) throw new Error(`Outra lista está em andamento: ${active[0].id}`);

const [list] = await db('logistica_picking_listas?select=id', {
  method: 'POST',
  body: JSON.stringify({ operation_id: 'uberlandia', kind: 'custom', trigger_source: 'custom_form',
    status: 'pending', cursor_start: start, cursor_end: end,
    period_start: start, period_end: end, whatsapp_status: 'not_requested' }),
});
if (!list?.id) throw new Error('Lista não foi criada.');
const response = await fetch(webhook, {
  method: 'POST', signal: AbortSignal.timeout(10000),
  headers: { 'Content-Type': 'application/json', 'x-oraculo-separation-secret': secret },
  body: JSON.stringify({ list_id: list.id, sync_orders: false, lookback_days: 1,
    advance_cursor: false, send_whatsapp: false, operation_id: 'uberlandia' }),
});
if (!response.ok) {
  await db('rpc/logistica_picking_fail', { method: 'POST',
    body: JSON.stringify({ p_lista_id: list.id,
      p_message: `Worker recusou lista corrigida (${response.status})` }) });
  throw new Error(`Worker recusou lista corrigida (${response.status})`);
}
console.log(JSON.stringify({ queued: true, id: list.id, original_untouched: originalListId,
  cursor_advanced: false, whatsapp_sent: false }));
