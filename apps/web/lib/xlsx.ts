// Geração de planilhas .xlsx (exceljs) — usada pelos exports das sugestões.
// Formata de acordo com o padrão pt-BR: moeda R$, decimais com vírgula,
// cabeçalho congelado, autofiltro e larguras razoáveis.
import ExcelJS from "exceljs";

export type XlsxColumn = {
  header: string;
  key: string;
  width?: number;
  /** number = inteiro · money = R$ · decimal = 1 casa · text = texto */
  type?: "number" | "money" | "decimal" | "text";
};

const numFmt = {
  number: "#,##0",
  money: 'R$ #,##0.00',
  decimal: "#,##0.0",
  text: undefined
} as const;

export async function buildXlsx({
  sheetName,
  columns,
  rows,
  meta
}: {
  sheetName: string;
  columns: XlsxColumn[];
  rows: Record<string, string | number | null>[];
  /** Linhas de contexto (parâmetros usados, data) impressas antes do cabeçalho. */
  meta?: string[];
}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Oráculo";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: (meta?.length ?? 0) + 1 }]
  });

  // Contexto (parâmetros do cálculo) antes da tabela
  for (const line of meta ?? []) {
    const row = ws.addRow([line]);
    row.font = { size: 9, color: { argb: "FF667085" } };
  }

  const headerRow = ws.addRow(columns.map((col) => col.header));
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2A3D" } };
  headerRow.alignment = { vertical: "middle" };
  headerRow.height = 20;

  for (const item of rows) {
    ws.addRow(columns.map((col) => item[col.key] ?? null));
  }

  columns.forEach((col, idx) => {
    const column = ws.getColumn(idx + 1);
    column.width = col.width ?? 16;
    const fmt = numFmt[col.type ?? "text"];
    if (fmt) column.numFmt = fmt;
    if (col.type && col.type !== "text") column.alignment = { horizontal: "right" };
  });

  // Autofiltro sobre o cabeçalho + dados
  const headerRowNumber = (meta?.length ?? 0) + 1;
  ws.autoFilter = {
    from: { row: headerRowNumber, column: 1 },
    to: { row: headerRowNumber + rows.length, column: columns.length }
  };

  const buffer = await wb.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export function xlsxResponse(buffer: ArrayBuffer, filename: string) {
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}

/** Carimbo de data para nome de arquivo: 2026-07-16_1432 */
export function fileStamp() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  return fmt.format(now).replace(" ", "_").replace(":", "");
}
