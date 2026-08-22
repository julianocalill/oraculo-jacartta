// Export xlsx do estoque por depósito — reusa o builder da tela (regra #9).
import { NextRequest } from "next/server";
import { getCurrentUser } from "../../../../lib/auth/session";
import { canAccess } from "../../../../lib/auth/access";
import { buildXlsx, fileStamp, xlsxResponse, type XlsxColumn } from "../../../../lib/xlsx";
import { filterItems, loadEstoqueData } from "../data";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Não autorizado", { status: 401 });
  if (!canAccess(user, "logistica")) return new Response("Sem acesso a esta aba", { status: 403 });

  const params = req.nextUrl.searchParams;
  const filters = {
    deposito: params.get("deposito") ?? "all",
    sinal: params.get("sinal") ?? "all",
    busca: params.get("q") ?? ""
  };

  const data = await loadEstoqueData();
  const visible = filterItems(data.items, filters);

  const columns: XlsxColumn[] = [
    { header: "SKU", key: "sku", width: 18 },
    { header: "Produto", key: "nome", width: 44 },
    { header: "Sinal", key: "sinal", width: 18 },
    { header: "Disponível", key: "disponivel", type: "number", width: 12 },
    { header: "Reservado", key: "reservado", type: "number", width: 12 },
    ...data.depositColumns.map((deposito) => ({
      header: deposito.nome,
      key: `dep_${deposito.id}`,
      type: "number" as const,
      width: 14
    })),
    { header: "Custo unit.", key: "unit_cost", type: "money", width: 14 },
    { header: "Capital a custo", key: "capital_custo", type: "money", width: 16 },
    { header: "Peso bruto (kg)", key: "peso_bruto_kg", type: "decimal", width: 14 },
    { header: "Volume (m³)", key: "volume_m3", type: "decimal", width: 12 }
  ];

  const rows = visible.map((item) => {
    const row: Record<string, string | number | null> = {
      sku: item.sku,
      nome: item.nome,
      sinal: item.stock_signal,
      disponivel: item.disponivel,
      reservado: item.reservado,
      unit_cost: item.unit_cost,
      capital_custo: item.capital_custo,
      peso_bruto_kg: item.peso_bruto_kg,
      volume_m3: item.volume_m3
    };
    for (const deposito of data.depositColumns) {
      row[`dep_${deposito.id}`] = item.porDeposito[deposito.id]?.disponivel ?? null;
    }
    return row;
  });

  const meta = [
    `Estoque por depósito — gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    `Filtros: depósito=${filters.deposito}, sinal=${filters.sinal}${filters.busca ? `, busca="${filters.busca}"` : ""}`
  ];

  const buffer = await buildXlsx({ sheetName: "Estoque por depósito", columns, rows, meta });
  return xlsxResponse(buffer, `estoque-por-deposito_${fileStamp()}.xlsx`);
}
