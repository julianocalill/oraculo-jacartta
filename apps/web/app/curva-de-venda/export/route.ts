import { createSupabaseUserClient } from "../../../lib/supabase/user";
import { getCurrentUser } from "../../../lib/auth/session";
import { canAccess } from "../../../lib/auth/access";
import { formatBrDate } from "../../../lib/date";

type Curve = "A" | "B" | "C";
type CurveFilter = "all" | Curve;

type CurveItem = {
  product_id: string;
  sku?: string | null;
  product_name: string | null;
  available_stock: number | null;
  curve: Curve;
  last_sale_at: string | null;
  units_sold?: number | null;
  share_pct?: number | null;
  cum_share_pct?: number | null;
};

function asCurveFilter(value: string | null): CurveFilter {
  if (value === "A" || value === "B" || value === "C") return value;
  return "all";
}

function asIsoDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? null : value;
}

function asPeriod(start: string | null, end: string | null) {
  const from = asIsoDate(start);
  const to = asIsoDate(end);
  if (!from || !to || from > to) return null;
  return { from, to };
}

// Espelha o select da tela: "marketplaces" = tudo menos os pedidos sem canal
// (atacado B2B), qualquer outro valor é o nome do canal na Olist.
const MARKETPLACES = "marketplaces";

function asChannelFilter(value: string | null) {
  if (!value || value === "all") return "all";
  return value;
}

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csvNumber(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n(value));
}

async function loadItems(
  curveFilter: CurveFilter,
  period: { from: string; to: string } | null,
  channel: string
) {
  const supabase = await createSupabaseUserClient();
  const { data, error } = period
    ? await supabase.rpc("oraculo_sales_curve_volume", {
        p_start: period.from,
        p_end: period.to,
        p_channel: channel === "all" || channel === MARKETPLACES ? null : channel,
        p_exclude_no_channel: channel === MARKETPLACES
      })
    : await supabase.rpc("oraculo_sales_curve");
  if (error) throw error;
  const items = (data ?? []) as CurveItem[];
  const filtered = curveFilter === "all" ? items : items.filter((item) => item.curve === curveFilter);

  // Com período a ordem que importa é a do ranking (unidades desc, como a RPC já
  // devolve); sem período mantém a ordem alfabética de antes.
  if (period) return filtered;
  return filtered.sort((left, right) =>
    String(left.product_name ?? "").localeCompare(String(right.product_name ?? ""), "pt-BR")
  );
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!canAccess(user, "curva-de-venda")) return new Response("Sem acesso a esta aba", { status: 403 });

  const url = new URL(request.url);
  const curveFilter = asCurveFilter(url.searchParams.get("curva"));
  const period = asPeriod(url.searchParams.get("de"), url.searchParams.get("ate"));
  const channel = asChannelFilter(url.searchParams.get("canal"));
  const items = await loadItems(curveFilter, period, channel);
  const header = period
    ? [
        "Nome do produto",
        "SKU",
        "Unidades vendidas",
        "% do volume",
        "% acumulado",
        "Data da ultima venda",
        "Quantidade em estoque",
        "Curva de venda"
      ]
    : ["Nome do produto", "Data da ultima venda", "Quantidade em estoque", "Curva de venda"];
  const rows = items.map((item) =>
    period
      ? [
          item.product_name ?? "Sem nome",
          item.sku ?? "",
          csvNumber(item.units_sold),
          csvNumber(item.share_pct),
          csvNumber(item.cum_share_pct),
          formatBrDate(item.last_sale_at, ""),
          n(item.available_stock),
          item.curve
        ]
      : [
          item.product_name ?? "Sem nome",
          formatBrDate(item.last_sale_at, ""),
          n(item.available_stock),
          item.curve
        ]
  );
  const csv = [
    header.map(csvCell).join(";"),
    ...rows.map((row) => row.map(csvCell).join(";"))
  ].join("\n");
  const curveSuffix = curveFilter === "all" ? "todas" : curveFilter.toLowerCase();
  const channelSuffix = channel === "all"
    ? ""
    : `-${channel.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const suffix = period
    ? `${curveSuffix}-${period.from}-a-${period.to}${channelSuffix}`
    : curveSuffix;

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "content-disposition": `attachment; filename="curva-de-venda-${suffix}.csv"`,
      "content-type": "text/csv; charset=utf-8"
    }
  });
}
