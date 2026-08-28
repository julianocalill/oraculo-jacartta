// Planejamento diário de envios Full/FBS/Onsite na Agenda.
//
// Uma tarefa por loja e próxima coleta, com checklist por SKU. A quantidade
// mantém a cobertura configurada APÓS a coleta:
//   enviar = teto(velocidade × (cobertura + dias até coleta)) − Full − trânsito
//
// A função só lê os canais e escreve na Agenda. Não chama APIs externas, não
// renova tokens e é idempotente por loja × data de coleta.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAGE_SIZE = 1000;
const DAY_MS = 86_400_000;
const SP_TZ = "America/Sao_Paulo";

type Channel = "shopee" | "mercadolivre" | "amazon";

type Config = {
  id: string;
  channel: Channel;
  store_key: string;
  store_name: string;
  pickup_weekday: number | null;
  coverage_days: number;
  max_suggestions: number;
  assignee_user_id: string | null;
  enabled: boolean;
};

type Suggestion = {
  key: string;
  sku: string | null;
  title: string;
  quantity: number;
  velocity: number;
  stock: number;
  transit: number;
  coverage: number;
  priority: number;
  source: string;
};

type Stats = {
  configsProcessed: number;
  tasksCreated: number;
  tasksUpdated: number;
  suggestionsWritten: number;
  errors: string[];
};

// deno-lint-ignore no-explicit-any
async function fetchAll<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function todaySaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function addDays(dateOnly: string, days: number) {
  const date = new Date(`${dateOnly}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextPickup(today: string, pickupWeekday: number) {
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  let daysUntil = (pickupWeekday - weekday + 7) % 7;
  // A rodada das 07:05 planeja sempre a PRÓXIMA coleta; no próprio dia a
  // separação já deveria estar pronta, então abre o ciclo da semana seguinte.
  if (daysUntil === 0) daysUntil = 7;
  return { dueDay: addDays(today, daysUntil), daysUntil };
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: number) {
  return Math.max(0, Math.ceil(value));
}

function formatQty(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatDate(dateOnly: string) {
  const [year, month, day] = dateOnly.split("-");
  return `${day}/${month}/${year}`;
}

function channelLabel(channel: Channel) {
  if (channel === "shopee") return "Shopee FBS";
  if (channel === "mercadolivre") return "Mercado Livre Full";
  return "Amazon Onsite";
}

function descriptionFor(config: Config, dueDay: string, daysUntil: number, suggestions: Suggestion[]) {
  const units = suggestions.reduce((sum, item) => sum + item.quantity, 0);
  const source = config.channel === "amazon"
    ? "vendas fiscais Amazon + depósito Amazon Onsite do Olist (a SP-API ainda não está ativa)"
    : config.channel === "shopee"
      ? "velocidade, estoque e trânsito informados pelo FBS da Shopee"
      : "vendas, estoque Full e trânsito do Mercado Livre";

  return [
    `Coleta em ${formatDate(dueDay)} · ${formatQty(units)} unidades em ${formatQty(suggestions.length)} SKUs.`,
    `Meta: ${config.coverage_days} dias de cobertura após a coleta; cálculo inclui os ${daysUntil} dias até ela.`,
    `Fonte: ${source}.`,
    "A lista é recalculada diariamente até a tarefa ser concluída."
  ].join("\n");
}

function subtaskTitle(item: Suggestion) {
  const sku = item.sku ? `${item.sku} · ` : "";
  const coverage = item.velocity > 0 ? `${Math.floor(item.coverage)}d atuais` : "sem velocidade";
  const transit = item.transit > 0 ? ` · ${formatQty(item.transit)} em trânsito` : "";
  return `${sku}ENVIAR ${formatQty(item.quantity)} un · ${item.title} · ${coverage}${transit}`;
}

// deno-lint-ignore no-explicit-any
async function syncDiscoveredStores(supabase: any) {
  const [{ data: shops, error: shopsError }, { data: accounts, error: accountsError }] = await Promise.all([
    supabase.from("shopee_shops").select("shop_id,shop_name").eq("is_active", true),
    supabase.from("mercadolivre_accounts").select("seller_id,nickname").eq("is_active", true)
  ]);
  if (shopsError) throw new Error(shopsError.message);
  if (accountsError) throw new Error(accountsError.message);

  const rows = [
    ...(shops ?? []).map((shop: { shop_id: number; shop_name: string | null }) => ({
      channel: "shopee",
      store_key: String(shop.shop_id),
      store_name: shop.shop_name || String(shop.shop_id)
    })),
    ...(accounts ?? []).map((account: { seller_id: number; nickname: string | null }) => ({
      channel: "mercadolivre",
      store_key: String(account.seller_id),
      store_name: account.nickname || String(account.seller_id)
    })),
    { channel: "amazon", store_key: "amazon-onsite", store_name: "Amazon Onsite" }
  ];

  const { error } = await supabase
    .from("oraculo_full_planning_configs")
    .upsert(rows, { onConflict: "channel,store_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

// deno-lint-ignore no-explicit-any
async function shopeeSuggestions(supabase: any, config: Config, daysUntil: number) {
  type Sbs = {
    whs_id: string;
    item_id: string;
    model_id: string | null;
    shop_item_id: string | null;
    shop_model_id: string | null;
    item_name: string | null;
    model_name: string | null;
    sellable_qty: number;
    in_transit_qty: number;
    selling_speed: number;
  };
  type Product = {
    item_id: string;
    model_id: string | null;
    item_sku: string | null;
    model_sku: string | null;
    model_stock: number | null;
    stock_total: number | null;
  };

  const shopId = Number(config.store_key);
  const [sbs, products] = await Promise.all([
    fetchAll<Sbs>((from, to) => supabase
      .from("shopee_sbs_inventory")
      .select("whs_id,item_id,model_id,shop_item_id,shop_model_id,item_name,model_name,sellable_qty,in_transit_qty,selling_speed")
      .eq("shop_id", shopId)
      .order("id")
      .range(from, to)),
    fetchAll<Product>((from, to) => supabase
      .from("shopee_products")
      .select("item_id,model_id,item_sku,model_sku,model_stock,stock_total")
      .eq("shop_id", shopId)
      .order("item_id")
      .range(from, to))
  ]);

  const productMap = new Map<string, Product>();
  for (const product of products) {
    productMap.set(`${product.item_id}:${product.model_id || "0"}`, product);
  }

  const grouped = new Map<string, Sbs[]>();
  for (const row of sbs) {
    const itemId = row.shop_item_id || row.item_id;
    const modelId = row.shop_model_id || row.model_id || "0";
    const key = `${itemId}:${modelId}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  const horizon = config.coverage_days + daysUntil;
  const suggestions: Suggestion[] = [];
  for (const [key, rows] of grouped) {
    const speed = rows.reduce((sum, row) => sum + number(row.selling_speed), 0);
    if (speed <= 0 || /\bkit\b/i.test(rows[0].item_name ?? "")) continue;
    const stock = rows.reduce((sum, row) => sum + number(row.sellable_qty), 0);
    const transit = rows.reduce((sum, row) => sum + number(row.in_transit_qty), 0);
    const product = productMap.get(key);
    const localStock = number(product?.model_stock ?? product?.stock_total);
    const quantity = Math.min(integer(speed * horizon - stock - transit), Math.max(0, Math.floor(localStock)));
    if (quantity <= 0) continue;
    const coverage = (stock + transit) / speed;
    suggestions.push({
      key,
      sku: product?.model_sku?.trim() || product?.item_sku?.trim() || null,
      title: [rows[0].item_name || rows[0].item_id, rows[0].model_name].filter(Boolean).join(" — "),
      quantity,
      velocity: speed,
      stock,
      transit,
      coverage,
      priority: stock + transit <= 0 ? 0 : coverage < 7 ? 1 : 2,
      source: `FBS:${rows.map((row) => row.whs_id).sort().join(",")}`
    });
  }

  return suggestions
    .sort((a, b) => a.priority - b.priority || a.coverage - b.coverage || b.velocity - a.velocity)
    .slice(0, config.max_suggestions);
}

// deno-lint-ignore no-explicit-any
async function mercadoLivreSuggestions(supabase: any, config: Config, daysUntil: number) {
  type Item = {
    mlb_id: string;
    title: string | null;
    sku: string | null;
    status: string | null;
    logistic_type: string | null;
    full_stock: number;
    sold_qty_30d: number;
    sold_qty_60d: number;
    snapshot_days_30d: number;
    in_stock_days_30d: number;
    last_sale_at: string | null;
  };
  type Transit = { mlb_id: string; qty: number };

  const sellerId = Number(config.store_key);
  const [items, transitRows] = await Promise.all([
    fetchAll<Item>((from, to) => supabase
      .from("mercadolivre_items")
      .select("mlb_id,title,sku,status,logistic_type,full_stock,sold_qty_30d,sold_qty_60d,snapshot_days_30d,in_stock_days_30d,last_sale_at")
      .eq("seller_id", sellerId)
      .eq("logistic_type", "fulfillment")
      .neq("status", "closed")
      .order("mlb_id")
      .range(from, to)),
    fetchAll<Transit>((from, to) => supabase
      .from("mercadolivre_transit")
      .select("mlb_id,qty")
      .eq("seller_id", sellerId)
      .order("mlb_id")
      .range(from, to))
  ]);
  const transit = new Map(transitRows.map((row) => [row.mlb_id, number(row.qty)]));
  const horizon = config.coverage_days + daysUntil;
  const now = Date.now();
  const suggestions: Suggestion[] = [];

  for (const item of items) {
    if (number(item.sold_qty_60d) <= 0) continue;
    let velocity: number;
    if (number(item.snapshot_days_30d) >= 15) {
      const ratio = Math.max(number(item.in_stock_days_30d) / number(item.snapshot_days_30d), 0.1);
      velocity = number(item.sold_qty_30d) / (30 * ratio);
    } else {
      const idle = item.last_sale_at
        ? Math.min(Math.floor((now - new Date(item.last_sale_at).getTime()) / DAY_MS), 60)
        : 60;
      velocity = number(item.sold_qty_60d) / Math.max(60 - idle, 3);
    }
    if (velocity <= 0) continue;
    const stock = number(item.full_stock);
    const inTransit = transit.get(item.mlb_id) ?? 0;
    const quantity = integer(velocity * horizon - stock - inTransit);
    if (quantity <= 0) continue;
    const coverage = (stock + inTransit) / velocity;
    suggestions.push({
      key: item.mlb_id,
      sku: item.sku?.trim() || null,
      title: item.title || item.mlb_id,
      quantity,
      velocity,
      stock,
      transit: inTransit,
      coverage,
      priority: stock + inTransit <= 0 ? 0 : coverage < 7 ? 1 : 2,
      source: item.mlb_id
    });
  }

  return suggestions
    .sort((a, b) => a.priority - b.priority || a.coverage - b.coverage || b.velocity - a.velocity)
    .slice(0, config.max_suggestions);
}

// deno-lint-ignore no-explicit-any
async function amazonSuggestions(supabase: any, config: Config, daysUntil: number) {
  type AmazonRow = {
    sku: string;
    title: string;
    sold_qty_30d: number;
    sold_qty_60d: number;
    onsite_stock: number;
    local_available: number;
    last_sale_day: string | null;
  };
  const { data, error } = await supabase.rpc("oraculo_amazon_full_candidates");
  if (error) throw new Error(error.message);
  const horizon = config.coverage_days + daysUntil;
  const suggestions: Suggestion[] = [];

  for (const row of (data ?? []) as AmazonRow[]) {
    const velocity = number(row.sold_qty_30d) > 0
      ? number(row.sold_qty_30d) / 30
      : number(row.sold_qty_60d) / 60;
    if (velocity <= 0) continue;
    const stock = number(row.onsite_stock);
    const quantity = Math.min(integer(velocity * horizon - stock), Math.floor(number(row.local_available)));
    if (quantity <= 0) continue;
    const coverage = stock / velocity;
    suggestions.push({
      key: row.sku,
      sku: row.sku,
      title: row.title || row.sku,
      quantity,
      velocity,
      stock,
      transit: 0,
      coverage,
      priority: stock <= 0 ? 0 : coverage < 7 ? 1 : 2,
      source: "Olist:Amazon Onsite"
    });
  }

  return suggestions
    .sort((a, b) => a.priority - b.priority || a.coverage - b.coverage || b.velocity - a.velocity)
    .slice(0, config.max_suggestions);
}

// deno-lint-ignore no-explicit-any
async function writeTask(
  supabase: any,
  config: Config,
  dueDay: string,
  daysUntil: number,
  suggestions: Suggestion[],
  stats: Stats
) {
  const sourceKey = `full:${config.channel}:${config.store_key}`;
  const { data: existing, error: existingError } = await supabase
    .from("oraculo_agenda_tasks")
    .select("id,status")
    .eq("source_key", sourceKey)
    .eq("due_day", dueDay)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  // Uma tarefa já concluída é um documento operacional congelado. A próxima
  // rodada só abrirá a coleta da semana seguinte.
  if (existing?.status === "concluida") return;

  if (suggestions.length === 0) {
    if (existing) {
      const { error } = await supabase.from("oraculo_agenda_tasks").update({
        status: "concluida",
        completed_at: new Date().toISOString(),
        completed_by: config.assignee_user_id,
        description: `Sem necessidade de envio para a coleta de ${formatDate(dueDay)}. A tarefa foi dispensada automaticamente após o recálculo.`,
        metadata: { channel: config.channel, store_key: config.store_key, auto_resolved: true },
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("id", existing.id);
      if (error) throw new Error(error.message);
      stats.tasksUpdated++;
    }
    return;
  }

  const totalUnits = suggestions.reduce((sum, item) => sum + item.quantity, 0);
  const now = new Date().toISOString();
  const taskPayload = {
    title: `Full · ${channelLabel(config.channel)} · ${config.store_name} · ${formatQty(totalUnits)} un`,
    description: descriptionFor(config, dueDay, daysUntil, suggestions),
    due_day: dueDay,
    status: "pendente",
    created_by: config.assignee_user_id,
    completed_at: null,
    completed_by: null,
    task_kind: "full_replenishment",
    source_key: sourceKey,
    metadata: {
      channel: config.channel,
      store_key: config.store_key,
      store_name: config.store_name,
      pickup_day: dueDay,
      coverage_days: config.coverage_days,
      days_until_pickup: daysUntil,
      suggestions: suggestions.length,
      total_units: totalUnits
    },
    generated_at: now,
    updated_at: now
  };

  let taskId: string;
  if (existing) {
    const { error } = await supabase.from("oraculo_agenda_tasks").update(taskPayload).eq("id", existing.id);
    if (error) throw new Error(error.message);
    taskId = existing.id;
    stats.tasksUpdated++;
  } else {
    const { data: created, error } = await supabase
      .from("oraculo_agenda_tasks")
      .insert(taskPayload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    taskId = created.id;
    stats.tasksCreated++;
  }

  const { error: clearParticipantsError } = await supabase
    .from("oraculo_agenda_task_participants")
    .delete()
    .eq("task_id", taskId)
    .neq("user_id", config.assignee_user_id);
  if (clearParticipantsError) throw new Error(clearParticipantsError.message);
  const { error: participantError } = await supabase
    .from("oraculo_agenda_task_participants")
    .upsert({ task_id: taskId, user_id: config.assignee_user_id }, { onConflict: "task_id,user_id" });
  if (participantError) throw new Error(participantError.message);

  const rows = suggestions.map((item, index) => ({
    task_id: taskId,
    source_key: item.key,
    title: subtaskTitle(item),
    position: index + 1
  }));
  const { error: subtaskError } = await supabase
    .from("oraculo_agenda_subtasks")
    .upsert(rows, { onConflict: "task_id,source_key" });
  if (subtaskError) throw new Error(subtaskError.message);

  const activeKeys = new Set(rows.map((row) => row.source_key));
  const { data: oldRows, error: oldRowsError } = await supabase
    .from("oraculo_agenda_subtasks")
    .select("id,source_key")
    .eq("task_id", taskId)
    .not("source_key", "is", null);
  if (oldRowsError) throw new Error(oldRowsError.message);
  const staleIds = (oldRows ?? [])
    .filter((row: { id: string; source_key: string }) => !activeKeys.has(row.source_key))
    .map((row: { id: string }) => row.id);
  if (staleIds.length > 0) {
    const { error } = await supabase.from("oraculo_agenda_subtasks").delete().in("id", staleIds);
    if (error) throw new Error(error.message);
  }
  stats.suggestionsWritten += rows.length;
}

// deno-lint-ignore no-explicit-any
async function processConfig(supabase: any, config: Config, today: string, stats: Stats) {
  if (!config.enabled || config.pickup_weekday == null || !config.assignee_user_id) return;
  const { dueDay, daysUntil } = nextPickup(today, config.pickup_weekday);
  let suggestions: Suggestion[];
  if (config.channel === "shopee") {
    suggestions = await shopeeSuggestions(supabase, config, daysUntil);
  } else if (config.channel === "mercadolivre") {
    suggestions = await mercadoLivreSuggestions(supabase, config, daysUntil);
  } else {
    suggestions = await amazonSuggestions(supabase, config, daysUntil);
  }

  await writeTask(supabase, config, dueDay, daysUntil, suggestions, stats);
  const { error } = await supabase.from("oraculo_full_planning_configs").update({
    last_generated_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString()
  }).eq("id", config.id);
  if (error) throw new Error(error.message);
  stats.configsProcessed++;
}

// Validação segura das fontes: calcula todas as lojas com um horizonte de
// preparação de 3 dias, sem criar tarefa nem alterar configuração.
// deno-lint-ignore no-explicit-any
async function previewConfig(supabase: any, config: Config, stats: Stats) {
  const suggestions = config.channel === "shopee"
    ? await shopeeSuggestions(supabase, config, 3)
    : config.channel === "mercadolivre"
      ? await mercadoLivreSuggestions(supabase, config, 3)
      : await amazonSuggestions(supabase, config, 3);
  stats.configsProcessed++;
  stats.suggestionsWritten += suggestions.length;
}

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get("SHOPEE_SYNC_SECRET");
  if (!expectedSecret || req.headers.get("x-sync-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const startedAt = new Date().toISOString();
  const { data: run, error: runError } = await supabase
    .from("oraculo_full_planning_runs")
    .insert({ started_at: startedAt, status: "running" })
    .select("id")
    .single();
  if (runError) {
    return new Response(JSON.stringify({ error: runError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const stats: Stats = {
    configsProcessed: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    suggestionsWritten: 0,
    errors: []
  };
  const dryRun = new URL(req.url).searchParams.get("dry_run") === "true";

  try {
    await syncDiscoveredStores(supabase);
    const { data, error } = await supabase
      .from("oraculo_full_planning_configs")
      .select("id,channel,store_key,store_name,pickup_weekday,coverage_days,max_suggestions,assignee_user_id,enabled")
      .order("channel")
      .order("store_name");
    if (error) throw new Error(error.message);

    const today = todaySaoPaulo();
    for (const config of (data ?? []) as Config[]) {
      try {
        if (dryRun) await previewConfig(supabase, config, stats);
        else await processConfig(supabase, config, today, stats);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stats.errors.push(`${config.channel}/${config.store_name}: ${message}`);
        await supabase.from("oraculo_full_planning_configs").update({
          last_error: message,
          updated_at: new Date().toISOString()
        }).eq("id", config.id);
      }
    }

    const status = stats.errors.length === 0 ? "success" : stats.configsProcessed > 0 ? "partial" : "failed";
    await supabase.from("oraculo_full_planning_runs").update({
      finished_at: new Date().toISOString(),
      status,
      configs_processed: stats.configsProcessed,
      tasks_created: stats.tasksCreated,
      tasks_updated: stats.tasksUpdated,
      suggestions_written: stats.suggestionsWritten,
      error_message: stats.errors.join(" · ") || null,
      metadata: { today, dry_run: dryRun, errors: stats.errors }
    }).eq("id", run.id);

    return new Response(JSON.stringify({ run_id: run.id, status, ...stats }, null, 2), {
      status: status === "failed" ? 500 : 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("oraculo_full_planning_runs").update({
      finished_at: new Date().toISOString(),
      status: "failed",
      error_message: message,
      metadata: { errors: [...stats.errors, message] }
    }).eq("id", run.id);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
