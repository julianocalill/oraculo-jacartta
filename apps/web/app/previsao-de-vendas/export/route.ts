// Export CSV da Previsão de Vendas por SKU — consome as MESMAS RPCs da página
// (regra: export nunca recalcula). Gate manual porque route handler não passa
// pela página.

import { getCurrentUser } from "../../../lib/auth/session";
import { canAccessRequest } from "../../../lib/auth/access";
import { asTargetWeek, loadForecastView } from "../data";

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csvNumber(value: number | null | undefined, digits = 2) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(n(value));
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!(await canAccessRequest(user, "previsao-de-vendas"))) {
    return new Response("Sem acesso a esta aba", { status: 403 });
  }

  const url = new URL(request.url);
  const target = asTargetWeek(url.searchParams.get("semana"));
  const { week, skus } = await loadForecastView(target);
  if (week?.forecast_units == null) return new Response(
    week?.calc_note ?? 'Previsão indisponível: dados insuficientes.', { status: 409 });

  const header = [
    "Produto",
    "SKU",
    "Unidades na base",
    "Média/semana",
    "Previsão (un)",
    "Cenário baixo",
    "Cenário alto",
    "SKU novo"
  ];
  const rows = skus.map((sku) => [
    sku.product_name ?? "Sem nome",
    sku.sku,
    csvNumber(sku.units_base, 0),
    csvNumber(sku.avg_units_week),
    csvNumber(sku.forecast_units),
    csvNumber(sku.forecast_low),
    csvNumber(sku.forecast_high),
    sku.is_new ? "Sim" : "Não"
  ]);

  const csv = [
    header.map(csvCell).join(";"),
    ...rows.map((row) => row.map(csvCell).join(";"))
  ].join("\n");

  const suffix = week?.target_week_start ?? "proxima-semana";
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "content-disposition": `attachment; filename="previsao-de-vendas-${suffix}.csv"`,
      "content-type": "text/csv; charset=utf-8"
    }
  });
}
