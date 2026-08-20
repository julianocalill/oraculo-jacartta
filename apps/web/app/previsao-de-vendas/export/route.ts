// Export CSV da Previsão de Vendas por SKU — consome as MESMAS RPCs da página
// (regra: export nunca recalcula). Gate manual porque route handler não passa
// pela página.

import { createSupabaseUserClient } from "../../../lib/supabase/user";
import { getCurrentUser } from "../../../lib/auth/session";
import { canAccess } from "../../../lib/auth/access";
import { asTargetWeek, type ForecastSku, type ForecastWeek } from "../data";

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

const STATUS_LABEL: Record<ForecastSku["stock_status"], string> = {
  ruptura: "Ruptura",
  risco_alto: "Risco alto",
  risco: "Risco",
  atencao: "Atenção",
  ok: "OK",
  sem_estoque_mapeado: "Sem estoque mapeado"
};

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!canAccess(user, "previsao-de-vendas")) {
    return new Response("Sem acesso a esta aba", { status: 403 });
  }

  const url = new URL(request.url);
  const target = asTargetWeek(url.searchParams.get("semana"));
  const args = { p_target_week_start: target };

  const supabase = await createSupabaseUserClient();
  const [weekRes, skusRes] = await Promise.all([
    supabase.rpc("oraculo_sales_forecast_week", args),
    supabase.rpc("oraculo_sales_forecast_skus", args)
  ]);
  if (weekRes.error) throw weekRes.error;
  if (skusRes.error) throw skusRes.error;

  const week = ((weekRes.data ?? []) as ForecastWeek[])[0] ?? null;
  const skus = (skusRes.data ?? []) as ForecastSku[];

  const header = [
    "Produto",
    "SKU",
    "Unidades na base",
    "Média/semana",
    "Previsão (un)",
    "Cenário baixo",
    "Cenário alto",
    "Estoque disponível",
    "Cobertura (semanas)",
    "Situação",
    "Sugestão de compra",
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
    sku.available_stock != null ? csvNumber(sku.available_stock, 0) : "",
    sku.coverage_weeks != null ? csvNumber(sku.coverage_weeks) : "",
    STATUS_LABEL[sku.stock_status],
    csvNumber(sku.purchase_suggestion, 0),
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
