const EXCLUDED_STATUSES = new Set(["UNPAID", "CANCELLED", "IN_CANCEL"]);

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateFromShopee(value) {
  if (value instanceof Date) return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
  }
  return new Date(String(value ?? ""));
}

export function saoPauloDateHour(value) {
  const date = dateFromShopee(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${byType.year}-${byType.month}-${byType.day}`,
    hour: Number(byType.hour)
  };
}

function emptyMetrics() {
  return { gross: 0, orders: 0, units: 0, buyers: 0 };
}

function itemQuantity(item) {
  return numberValue(item?.model_quantity_purchased ?? item?.quantity_purchased ?? item?.quantity);
}

function itemUnitPrice(item) {
  return numberValue(
    item?.model_discounted_price ??
      item?.model_original_price ??
      item?.discounted_price ??
      item?.original_price
  );
}

function itemSku(item) {
  return String(item?.model_sku ?? item?.item_sku ?? "").trim();
}

function productKey(item) {
  const sku = itemSku(item);
  if (sku) return `sku:${sku.toLocaleUpperCase("pt-BR")}`;
  return `listing:${String(item?.item_id ?? "0")}:${String(item?.model_id ?? "0")}`;
}

function buyerKey(order) {
  const id = String(order?.buyer_user_id ?? "").trim();
  if (id) return `id:${id}`;
  const username = String(order?.buyer_username ?? "").trim().toLocaleLowerCase("pt-BR");
  return username ? `user:${username}` : null;
}

function addOrder(metrics, buyers, order) {
  metrics.gross += numberValue(order?.total_amount);
  metrics.orders += 1;
  for (const item of order?.item_list ?? []) metrics.units += itemQuantity(item);
  const buyer = buyerKey(order);
  if (buyer) buyers.add(buyer);
}

/**
 * Agrega exatamente o payload devolvido por order.get_order_detail. A função é
 * deliberadamente pura para que a regra exibida no dashboard seja testável sem
 * chamar a Shopee nem o Supabase.
 */
export function aggregateShopeeLiveOrders(orders, options) {
  const today = String(options.today);
  const previous = String(options.previous);
  const current = emptyMetrics();
  const prior = emptyMetrics();
  const currentBuyers = new Set();
  const priorBuyers = new Set();
  const hourlyToday = Array(24).fill(0);
  const hourlyPrevious = Array(24).fill(0);
  const products = new Map();
  let acceptedOrders = 0;

  for (const order of orders ?? []) {
    const status = String(order?.order_status ?? "").toUpperCase();
    if (EXCLUDED_STATUSES.has(status)) continue;
    const when = saoPauloDateHour(order?.create_time);
    if (!when || (when.date !== today && when.date !== previous)) continue;

    const isToday = when.date === today;
    const metrics = isToday ? current : prior;
    const buyers = isToday ? currentBuyers : priorBuyers;
    addOrder(metrics, buyers, order);
    acceptedOrders += 1;
    const gross = numberValue(order?.total_amount);
    (isToday ? hourlyToday : hourlyPrevious)[when.hour] += gross;

    if (!isToday) continue;
    for (const item of order?.item_list ?? []) {
      const quantity = itemQuantity(item);
      const unitPrice = itemUnitPrice(item);
      const key = productKey(item);
      const row = products.get(key) ?? {
        key,
        sku: itemSku(item) || null,
        item_id: item?.item_id != null ? String(item.item_id) : null,
        model_id: item?.model_id != null ? String(item.model_id) : null,
        product: String(item?.item_name ?? "Produto sem nome").trim() || "Produto sem nome",
        variation: String(item?.model_name ?? "").trim() || null,
        units: 0,
        gmv: 0,
        order_sns: new Set()
      };
      row.units += quantity;
      row.gmv += unitPrice * quantity;
      if (order?.order_sn != null) row.order_sns.add(String(order.order_sn));
      products.set(key, row);
    }
  }

  current.buyers = currentBuyers.size;
  prior.buyers = priorBuyers.size;
  current.gross = money(current.gross);
  prior.gross = money(prior.gross);

  return {
    current,
    previous: prior,
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      today: money(hourlyToday[hour]),
      previous: money(hourlyPrevious[hour])
    })),
    products: [...products.values()]
      .map((row) => ({
        key: row.key,
        sku: row.sku,
        item_id: row.item_id,
        model_id: row.model_id,
        product: row.product,
        variation: row.variation,
        units: row.units,
        gmv: money(row.gmv),
        orders: row.order_sns.size
      }))
      .sort((a, b) => b.gmv - a.gmv || b.units - a.units || a.product.localeCompare(b.product)),
    accepted_orders: acceptedOrders
  };
}
