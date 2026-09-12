import { expectedSeparationSlot, separationFreshness } from "@oraculo/domain/separation.js";
import { getRequestOperation } from "../../../lib/operation-context";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { createSupabaseUserClient } from "../../../lib/supabase/user";

export type PickingStatus = "pending" | "syncing" | "processing" | "ready" | "blocked" | "failed";

export type PickingList = {
  id: string;
  kind: "official" | "custom";
  trigger_source: "schedule" | "refresh_button" | "custom_form";
  status: PickingStatus;
  slot_key: string | null;
  cursor_start: string;
  cursor_end: string;
  period_start: string;
  period_end: string;
  requested_by: string | null;
  requested_by_email: string | null;
  generated_at: string | null;
  olist_sync_finished_at: string | null;
  orders_count: number;
  orders_without_items: number;
  rows_count: number;
  units_sold: number;
  boxes_total: number;
  loose_units_total: number;
  marketplace_count: number;
  unmapped_count: number;
  whatsapp_status: "not_requested" | "pending" | "sent" | "failed";
  whatsapp_sent_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  print_count: number;
  last_printed_at: string | null;
};

export type PickingItem = {
  position: number;
  sku: string | null;
  product: string;
  description: string;
  sold_quantity: number;
  boxes: number;
  loose_units: number;
};

export type PickingPrint = {
  id: number;
  lista_id: string;
  printed_by_email: string | null;
  printed_at: string;
};

const LIST_COLUMNS = "id,kind,trigger_source,status,slot_key,cursor_start,cursor_end,period_start,period_end,requested_by,requested_by_email,generated_at,olist_sync_finished_at,orders_count,orders_without_items,rows_count,units_sold,boxes_total,loose_units_total,marketplace_count,unmapped_count,whatsapp_status,whatsapp_sent_at,last_error,created_at,updated_at";

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeList(row: Record<string, unknown>, printCount = 0, lastPrintedAt: string | null = null): PickingList {
  return {
    ...(row as unknown as Omit<PickingList, "print_count" | "last_printed_at" | "orders_count" | "orders_without_items" | "rows_count" | "units_sold" | "boxes_total" | "loose_units_total" | "marketplace_count" | "unmapped_count">),
    orders_count: numberValue(row.orders_count),
    orders_without_items: numberValue(row.orders_without_items),
    rows_count: numberValue(row.rows_count),
    units_sold: numberValue(row.units_sold),
    boxes_total: numberValue(row.boxes_total),
    loose_units_total: numberValue(row.loose_units_total),
    marketplace_count: numberValue(row.marketplace_count),
    unmapped_count: numberValue(row.unmapped_count),
    print_count: printCount,
    last_printed_at: lastPrintedAt
  };
}

export async function loadSeparationPageData(now = new Date()) {
  const operation = await getRequestOperation();
  const userClient = await createSupabaseUserClient();
  const admin = createSupabaseAdminClient({ operation });

  const [listsResult, syncResult] = await Promise.all([
    userClient
      .from("logistica_picking_listas")
      .select(LIST_COLUMNS)
      .eq("operation_id", operation)
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("olist_order_sync_runs")
      .select("status,started_at,finished_at,error_message,metadata")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  if (listsResult.error) throw listsResult.error;
  const rawLists = (listsResult.data ?? []) as Array<Record<string, unknown>>;
  const ids = rawLists.map((row) => String(row.id));
  const printStats = new Map<string, { count: number; last: string | null }>();
  let prints: PickingPrint[] = [];

  if (ids.length > 0) {
    const { data, error } = await userClient
      .from("logistica_picking_impressoes")
      .select("id,lista_id,printed_by_email,printed_at")
      .eq("operation_id", operation)
      .in("lista_id", ids)
      .order("printed_at", { ascending: false });
    if (error) throw error;
    prints = ((data ?? []) as PickingPrint[]).slice(0, 50);
    for (const row of (data ?? []) as PickingPrint[]) {
      const current = printStats.get(row.lista_id) ?? { count: 0, last: null };
      current.count += 1;
      current.last ??= row.printed_at;
      printStats.set(row.lista_id, current);
    }
  }

  const lists = rawLists.map((row) => {
    const stats = printStats.get(String(row.id));
    return normalizeList(row, stats?.count ?? 0, stats?.last ?? null);
  });
  const expected = expectedSeparationSlot(now);
  const expectedList = lists.find((list) => list.kind === "official" && list.slot_key === expected.slotKey) ?? null;
  let freshness = separationFreshness(expected, expectedList);
  if (
    freshness.state === "processing"
    && expectedList
    && now.getTime() - Date.parse(expectedList.updated_at) > 20 * 60 * 1000
  ) {
    freshness = { state: "stale", reason: "A atualização ficou sem resposta por mais de 20 minutos. Tente novamente." };
  }
  const latestReady = lists.find((list) => list.status === "ready") ?? null;
  const sync = syncResult.data as {
    status?: string;
    started_at?: string;
    finished_at?: string | null;
    error_message?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;

  return {
    lists,
    expected,
    expectedList,
    latestReady,
    prints,
    freshness,
    sync: sync ? {
      status: sync.status ?? "unknown",
      activityAt: sync.finished_at ?? sync.started_at ?? null,
      error: sync.error_message ?? null
    } : null
  };
}

export async function loadPickingList(id: string) {
  const operation = await getRequestOperation();
  const supabase = await createSupabaseUserClient();
  const [{ data: list, error }, { data: items, error: itemsError }] = await Promise.all([
    supabase.from("logistica_picking_listas").select(LIST_COLUMNS).eq("operation_id", operation).eq("id", id).maybeSingle(),
    supabase
      .from("logistica_picking_itens")
      .select("position,sku,product,description,sold_quantity,boxes,loose_units")
      .eq("operation_id", operation)
      .eq("lista_id", id)
      .order("position", { ascending: true })
  ]);
  if (error) throw error;
  if (itemsError) throw itemsError;
  if (!list) return null;
  return {
    list: normalizeList(list as Record<string, unknown>),
    items: ((items ?? []) as Array<Record<string, unknown>>).map((item) => ({
      position: numberValue(item.position),
      sku: item.sku ? String(item.sku) : null,
      product: String(item.product),
      description: String(item.description),
      sold_quantity: numberValue(item.sold_quantity),
      boxes: numberValue(item.boxes),
      loose_units: numberValue(item.loose_units)
    })) as PickingItem[]
  };
}
