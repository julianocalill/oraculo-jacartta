import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

type StockCurve = "A" | "B" | "C" | "sem_venda";
type StockCurveFilter = "all" | Exclude<StockCurve, "sem_venda">;

type StockCurveItem = {
  product_id: string;
  product_name: string | null;
  available_stock: number | null;
  average_daily_sales: number | null;
  average_monthly_sales: number | null;
  coverage_months: number | null;
  curve: StockCurve;
};

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function decimal(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value);
}

function asCurveFilter(value: string | null): StockCurveFilter {
  if (value === "A" || value === "B" || value === "C") return value;
  return "all";
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

async function loadItems(curveFilter: StockCurveFilter) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("oraculo_stock_coverage_curve");
  if (error) throw error;
  const items = (data ?? []) as StockCurveItem[];

  return (curveFilter === "all" ? items : items.filter((item) => item.curve === curveFilter))
    .sort((left, right) => {
      if (left.curve !== right.curve) return String(left.curve).localeCompare(String(right.curve), "pt-BR");
      return (right.coverage_months ?? Number.POSITIVE_INFINITY) - (left.coverage_months ?? Number.POSITIVE_INFINITY);
    });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const curveFilter = asCurveFilter(url.searchParams.get("curva"));
  const items = await loadItems(curveFilter);
  const header = [
    "Produto",
    "Estoque Atual",
    "Media Diaria",
    "Media Mensal",
    "Meses de Cobertura",
    "Curva"
  ];
  const rows = items.map((item) => [
    item.product_name ?? "Sem nome",
    n(item.available_stock),
    n(item.average_daily_sales) <= 0 ? "Sem venda" : decimal(item.average_daily_sales, 2),
    n(item.average_monthly_sales) <= 0 ? "Sem venda" : decimal(item.average_monthly_sales, 2),
    item.coverage_months == null ? "Sem venda" : decimal(item.coverage_months, 1),
    item.curve === "sem_venda" ? "Sem venda" : item.curve
  ]);
  const csv = [
    header.map(csvCell).join(";"),
    ...rows.map((row) => row.map(csvCell).join(";"))
  ].join("\n");
  const suffix = curveFilter === "all" ? "todas" : curveFilter.toLowerCase();

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "content-disposition": `attachment; filename="curva-de-estoque-${suffix}.csv"`,
      "content-type": "text/csv; charset=utf-8"
    }
  });
}
