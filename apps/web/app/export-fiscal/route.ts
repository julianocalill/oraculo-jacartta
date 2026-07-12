import { createSupabaseUserClient } from "../../lib/supabase/user";
import { getCurrentUser } from "../../lib/auth/session";

// Export CSV da receita fiscal diária (janela do dashboard) — botão "Exportar".
type FiscalDailyRow = {
  issued_date: string;
  invoices_count: number | string | null;
  billed_revenue: number | string | null;
  average_invoice_value: number | string | null;
};

function isIsoDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  if (!isIsoDate(start) || !isIsoDate(end)) {
    return new Response("Parâmetros start/end inválidos", { status: 400 });
  }

  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase
    .from("oraculo_fiscal_daily_revenue")
    .select("issued_date, invoices_count, billed_revenue, average_invoice_value")
    .gte("issued_date", start)
    .lte("issued_date", end)
    .order("issued_date", { ascending: true });

  if (error) {
    return new Response("Erro ao carregar dados fiscais", { status: 500 });
  }

  const rows = (data ?? []) as FiscalDailyRow[];
  const header = ["data_emissao", "nfs_validas", "receita_faturada", "ticket_medio"].map(csvCell).join(";");
  const body = rows.map((row) =>
    [row.issued_date, row.invoices_count, row.billed_revenue, row.average_invoice_value].map(csvCell).join(";")
  );
  const csv = "﻿" + [header, ...body].join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="receita-fiscal-${start}-a-${end}.csv"`
    }
  });
}
