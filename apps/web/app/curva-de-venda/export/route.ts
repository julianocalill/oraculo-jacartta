import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

type Curve = "A" | "B" | "C";
type CurveFilter = "all" | Curve;

type ProductRow = {
  id: string;
  product_name: string | null;
  available_stock: number | null;
};

type CurveItem = ProductRow & {
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

function daysSince(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(Math.floor((Date.now() - parsed.getTime()) / 86_400_000), 0);
}

function curveForDays(days: number | null): Curve {
  if (days == null) return "C";
  if (days <= 90) return "A";
  if (days <= 180) return "B";
  return "C";
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

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchAllSimpleStockProducts() {
  const supabase = createSupabaseAdminClient();
  const pageSize = 1000;
  const rows: ProductRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("olist_products")
      .select("id, nome, disponivel")
      .gt("disponivel", 0)
      .or("tipo.is.null,tipo.neq.K")
      .order("nome", { ascending: true, nullsFirst: false })
      .range(from, from + pageSize - 1);

    if (error) throw error;

    const page = (data ?? []) as Array<{
      id: string;
      nome: string | null;
      disponivel: number | null;
    }>;
    rows.push(...page.map((row) => ({
      id: row.id,
      product_name: row.nome,
      available_stock: row.disponivel
    })));

    if (page.length < pageSize) break;
  }

  return rows;
}

async function fetchLastSalesByProduct(productIds: string[]) {
  const supabase = createSupabaseAdminClient();
  const lastSales = new Map<string, string>();
  const pageSize = 1000;

  for (const productChunk of chunk(productIds, 200)) {
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("olist_order_items")
        .select("produto_id, order_data_criacao")
        .in("produto_id", productChunk)
        .not("order_data_criacao", "is", null)
        .order("order_data_criacao", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const page = (data ?? []) as Array<{
        produto_id: string | null;
        order_data_criacao: string | null;
      }>;

      for (const row of page) {
        if (!row.produto_id || !row.order_data_criacao || lastSales.has(row.produto_id)) continue;
        lastSales.set(row.produto_id, row.order_data_criacao);
      }

      if (productChunk.every((productId) => lastSales.has(productId)) || page.length < pageSize) break;
    }
  }

  return lastSales;
}

async function loadItems(curveFilter: CurveFilter) {
  const products = await fetchAllSimpleStockProducts();
  const lastSalesByProduct = await fetchLastSalesByProduct(products.map((product) => product.id));
  const items: CurveItem[] = products.map((product) => {
    const lastSale = lastSalesByProduct.get(product.id) ?? null;
    const days = daysSince(lastSale);
    return {
      ...product,
      last_sale_at: lastSale,
      curve: curveForDays(days)
    };
  });

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
