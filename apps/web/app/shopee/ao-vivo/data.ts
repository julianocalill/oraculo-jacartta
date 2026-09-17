import { getRequestOperation } from "../../../lib/operation-context";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

export type LiveMetrics = { gross: number; orders: number; units: number; buyers: number };
export type LiveHour = { hour: number; today: number; previous: number };
export type LiveProduct = {
  key: string;
  sku: string | null;
  product: string;
  variation: string | null;
  units: number;
  orders: number;
  gmv: number;
  shops: string[];
};
export type LiveShop = {
  shopId: number;
  shopName: string;
  current: LiveMetrics;
  previous: LiveMetrics;
  status: string;
  isComplete: boolean;
  usable: boolean;
  lastSuccess: string | null;
  apiThrough: string | null;
  error: string | null;
};

type SnapshotRow = {
  shop_id: number;
  shop_name: string | null;
  today_date: string | null;
  previous_date: string | null;
  status: string;
  is_complete: boolean;
  current_metrics: unknown;
  previous_metrics: unknown;
  hourly: unknown;
  products: unknown;
  api_through_at: string | null;
  last_success_at: string | null;
  error_message: string | null;
};

type ProductJson = {
  key?: unknown;
  sku?: unknown;
  product?: unknown;
  variation?: unknown;
  units?: unknown;
  orders?: unknown;
  gmv?: unknown;
};

const EMPTY_METRICS: LiveMetrics = { gross: 0, orders: 0, units: 0, buyers: 0 };
const STALE_AFTER_MS = 12 * 60 * 1000;

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metrics(value: unknown): LiveMetrics {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    gross: numberValue(row.gross),
    orders: numberValue(row.orders),
    units: numberValue(row.units),
    buyers: numberValue(row.buyers)
  };
}

function brDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addMetrics(target: LiveMetrics, source: LiveMetrics) {
  target.gross += source.gross;
  target.orders += source.orders;
  target.units += source.units;
  target.buyers += source.buyers;
}

export async function loadShopeeLiveMonitor(shopFilter: number | null) {
  const operation = await getRequestOperation();
  const supabase = createSupabaseAdminClient({ operation });
  const [{ data: shopRows, error: shopsError }, { data: snapshotRows, error: snapshotsError }] = await Promise.all([
    supabase.from("shopee_shops").select("shop_id, shop_name").eq("is_active", true).order("shop_name"),
    supabase.from("shopee_live_monitor_snapshots").select(
      "shop_id,shop_name,today_date,previous_date,status,is_complete,current_metrics,previous_metrics,hourly,products,api_through_at,last_success_at,error_message"
    )
  ]);
  if (shopsError) throw shopsError;
  if (snapshotsError) throw snapshotsError;

  const allShops = (shopRows ?? []).map((row) => ({
    shop_id: Number(row.shop_id),
    shop_name: row.shop_name as string | null
  }));
  const selectedShops = shopFilter == null ? allShops : allShops.filter((shop) => shop.shop_id === shopFilter);
  const snapshots = new Map((snapshotRows ?? []).map((row) => [Number(row.shop_id), row as SnapshotRow]));
  const today = brDate();
  const now = Date.now();

  const shops: LiveShop[] = selectedShops.map((shop) => {
    const snapshot = snapshots.get(shop.shop_id);
    const lastSuccessMs = snapshot?.last_success_at ? Date.parse(snapshot.last_success_at) : 0;
    const usable = Boolean(
      snapshot &&
      snapshot.today_date === today &&
      Number.isFinite(lastSuccessMs) &&
      now - lastSuccessMs <= STALE_AFTER_MS
    );
    return {
      shopId: shop.shop_id,
      shopName: shop.shop_name ?? snapshot?.shop_name ?? String(shop.shop_id),
      current: usable ? metrics(snapshot?.current_metrics) : { ...EMPTY_METRICS },
      previous: usable ? metrics(snapshot?.previous_metrics) : { ...EMPTY_METRICS },
      status: snapshot?.status ?? "pending",
      isComplete: Boolean(snapshot?.is_complete),
      usable,
      lastSuccess: snapshot?.last_success_at ?? null,
      apiThrough: snapshot?.api_through_at ?? null,
      error: snapshot?.error_message ?? null
    };
  });

  const current = { ...EMPTY_METRICS };
  const previous = { ...EMPTY_METRICS };
  const hourly: LiveHour[] = Array.from({ length: 24 }, (_, hour) => ({ hour, today: 0, previous: 0 }));
  const productMap = new Map<string, LiveProduct>();

  for (const shop of shops) {
    if (!shop.usable) continue;
    addMetrics(current, shop.current);
    addMetrics(previous, shop.previous);
    const snapshot = snapshots.get(shop.shopId);
    const sourceHours = Array.isArray(snapshot?.hourly) ? snapshot.hourly : [];
    for (const raw of sourceHours) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const hour = numberValue(row.hour);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
      hourly[hour].today += numberValue(row.today);
      hourly[hour].previous += numberValue(row.previous);
    }

    const sourceProducts = Array.isArray(snapshot?.products) ? snapshot.products as ProductJson[] : [];
    for (const raw of sourceProducts) {
      const rawKey = String(raw.key ?? "");
      const key = rawKey.startsWith("sku:") ? rawKey : `${shop.shopId}:${rawKey}`;
      if (!key) continue;
      const existing = productMap.get(key) ?? {
        key,
        sku: raw.sku == null || String(raw.sku).trim() === "" ? null : String(raw.sku),
        product: String(raw.product ?? "Produto sem nome"),
        variation: raw.variation == null || String(raw.variation).trim() === "" ? null : String(raw.variation),
        units: 0,
        orders: 0,
        gmv: 0,
        shops: []
      };
      existing.units += numberValue(raw.units);
      existing.orders += numberValue(raw.orders);
      existing.gmv += numberValue(raw.gmv);
      if (!existing.shops.includes(shop.shopName)) existing.shops.push(shop.shopName);
      productMap.set(key, existing);
    }
  }

  const usableTimes = shops
    .filter((shop) => shop.usable && shop.apiThrough)
    .map((shop) => Date.parse(shop.apiThrough as string))
    .filter(Number.isFinite);

  return {
    today,
    allShops,
    shops: shops.sort((a, b) => b.current.gross - a.current.gross),
    current,
    previous,
    hourly,
    products: [...productMap.values()].sort((a, b) => b.gmv - a.gmv || b.units - a.units),
    complete: shops.length > 0 && shops.every((shop) => shop.usable && shop.status === "success" && shop.isComplete),
    availableShops: shops.filter((shop) => shop.usable).length,
    expectedShops: shops.length,
    throughAt: usableTimes.length ? new Date(Math.min(...usableTimes)).toISOString() : null
  };
}
