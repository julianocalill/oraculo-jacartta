import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

type Curve = "A" | "B" | "C";
type CurveFilter = "all" | Curve;

type CurveItem = {
  product_id: string;
  product_name: string | null;
  available_stock: number | null;
  curve: Curve;
  last_sale_at: string | null;
};

function asCurveFilter(value: string | null): CurveFilter {
  if (value === "A" || value === "B" || value === "C") return value;
  return "all";
}

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

async function loadItems(curveFilter: CurveFilter) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("oraculo_sales_curve");
  if (error) throw error;
  const items = (data ?? []) as CurveItem[];

  return (curveFilter === "all" ? items : items.filter((item) => item.curve === curveFilter))
    .sort((left, right) => String(left.product_name ?? "").localeCompare(String(right.product_name ?? ""), "pt-BR"));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const curveFilter = asCurveFilter(url.searchParams.get("curva"));
  const items = await loadItems(curveFilter);
  const header = [
    "Nome do produto",
    "Data da ultima venda",
    "Quantidade em estoque",
    "Curva de venda"
  ];
  const rows = items.map((item) => [
    item.product_name ?? "Sem nome",
    formatDate(item.last_sale_at),
    n(item.available_stock),
    item.curve
  ]);
  const csv = [
    header.map(csvCell).join(";"),
    ...rows.map((row) => row.map(csvCell).join(";"))
  ].join("\n");
  const suffix = curveFilter === "all" ? "todas" : curveFilter.toLowerCase();

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "content-disposition": `attachment; filename="curva-de-venda-${suffix}.csv"`,
      "content-type": "text/csv; charset=utf-8"
    }
  });
}
