import { NextRequest } from "next/server";
import { getCurrentUser } from "../../../../../lib/auth/session";
import { canAccessRequest } from "../../../../../lib/auth/access";
import { loadPickingList } from "../../data";

export const dynamic = "force-dynamic";

function csvEscape(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Não autorizado", { status: 401 });
  if (!(await canAccessRequest(user, "logistica"))) return new Response("Sem acesso a esta aba", { status: 403 });
  const { id } = await context.params;
  const data = await loadPickingList(id);
  if (!data || data.list.status !== "ready") return new Response("Lista não encontrada", { status: 404 });

  const lines = [
    ["SKU", "Produto", "Descritivo", "Itens vendidos", "Caixas", "Unidades avulsas"].map(csvEscape).join(";")
  ];
  for (const item of data.items) {
    lines.push([item.sku, item.product, item.description, item.sold_quantity, item.boxes, item.loose_units].map(csvEscape).join(";"));
  }
  const filename = data.list.slot_key
    ? `separacao-todos-marketplaces-${data.list.slot_key}.csv`
    : `separacao-personalizada-${data.list.id.slice(0, 8)}.csv`;
  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store"
    }
  });
}
