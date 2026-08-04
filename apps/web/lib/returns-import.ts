// Parser da planilha de devoluções do TikTok Shop -> linhas de oraculo_returns.
//
// Módulo puro (só depende de exceljs): não toca em Supabase, não usa APIs do
// Next. Assim dá para rodar contra o arquivo real num script antes de subir.
//
// Decisões vindas da medição do arquivo de julho/2026 (1.728 linhas, 3 abas):
//
//  1. MAPEAR POR NOME DE CABEÇALHO, NUNCA POR POSIÇÃO. As abas têm layouts
//     diferentes: "tiktok Donacor" tem 19 colunas; "aliver" e "jacartta", 25.
//     Faltam na Donacor: Return Quantity, Return Sub Status, Refund Time,
//     Compensation Status/Amount. Coluna ausente vira nulo, não erro.
//
//  2. A LOJA VEM DO NOME DA ABA. Não existe coluna de loja no arquivo.
//
//  3. TIPOS SUJOS NA MESMA COLUNA. "Return unit price" vem 234.9 (número) numa
//     aba e "R$ 62,90" (texto) noutra; "Return Quantity" vem "1" (texto).
//
//  4. "Return unit price" É O VALOR TOTAL DO ESTORNO, apesar do nome. Medido:
//     em 302 de 325 linhas com quantidade ele é IGUAL ao Order Amount, e em
//     nenhuma das 1.728 linhas ele o excede — inclusive nas 33 linhas com
//     qty = 2. Multiplicar por qty dobraria o estorno (R$ 74,30 onde o pedido
//     inteiro custou R$ 37,15). Grava-se como veio.
//
//  5. SEM "Return Quantity" (aba Donacor) assume-se 1 e marca-se qty_assumed.
//
//  6. Datas em dd/MM/yyyy HH:mm:ss, horário de São Paulo (UTC-3 o ano todo
//     desde 2019 — sem horário de verão).

import ExcelJS from "exceljs";

export type ReturnRow = {
  channel: "tiktok";
  return_id: string;
  account_ref: string;
  order_ref: string | null;
  sku_channel: string | null;
  sku_olist: string | null;
  product_name: string | null;
  qty: number;
  qty_assumed: boolean;
  opened_at: string | null;
  closed_at: string | null;
  status: "aberta" | "aceita" | "recusada" | "cancelada";
  return_type: "refund_only" | "return_and_refund" | null;
  reason_raw: string | null;
  reason_group: string;
  refund_amount: number | null;
  order_amount: number | null;
  buyer_note: string | null;
  source: "upload";
  raw: Record<string, unknown>;
};

export type ReturnRowError = {
  sheet: string;
  row: number;
  field: string;
  message: string;
};

export type ParseResult = {
  rows: ReturnRow[];
  errors: ReturnRowError[];
  sheets: string[];
  /** Motivos vistos no arquivo que não estavam no de-para (caíram em 'outros'). */
  unknownReasons: string[];
  stats: {
    rowsRead: number;
    duplicates: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  };
};

// Return Status -> status canônico. "Refund rejected" (635 das 1.728 linhas de
// julho) NÃO é perda: entra como 'recusada' e fica fora de todo agregado.
const STATUS_MAP: Record<string, ReturnRow["status"]> = {
  completed: "aceita",
  "in process": "aberta",
  "to process": "aberta",
  "refund rejected": "recusada",
  canceled: "cancelada",
  cancelled: "cancelada"
};

const TYPE_MAP: Record<string, NonNullable<ReturnRow["return_type"]>> = {
  "return and refund": "return_and_refund",
  "refund only": "refund_only"
};

function text(value: unknown): string | null {
  if (value == null) return null;
  // Célula com hyperlink/rich text vem como objeto no exceljs.
  const raw =
    typeof value === "object" && value !== null
      ? String((value as { text?: unknown; result?: unknown }).text ??
          (value as { result?: unknown }).result ??
          "")
      : String(value);
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Aceita 234.9, "R$ 62,90", "1.234,56" e "1234.56". */
export function parseMoney(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = text(value);
  if (!raw) return null;
  let cleaned = raw.replace(/[^0-9,.-]/g, "");
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  if (lastComma > lastDot) {
    // pt-BR: ponto é milhar, vírgula é decimal
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** dd/MM/yyyy HH:mm:ss (São Paulo) -> ISO. Aceita Date nativo do Excel. */
export function parseDateTime(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  const raw = text(value);
  if (!raw) return null;
  const match = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) return null;
  const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = match;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** "tiktok Donacor" -> "Donacor"; "tiktok jacartta " -> "Jacartta". */
export function accountFromSheetName(sheetName: string): string {
  const cleaned = sheetName.replace(/^tiktok\s*/i, "").trim();
  const base = cleaned.length > 0 ? cleaned : sheetName.trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function headerIndex(row: ExcelJS.Row): Map<string, number> {
  const index = new Map<string, number>();
  (row.values as unknown[]).forEach((value, position) => {
    const header = text(value);
    if (header) index.set(header.toLowerCase(), position);
  });
  return index;
}

const REQUIRED_HEADERS = ["return order id", "order id", "return status", "return type"];

export async function parseTikTokReturnsWorkbook(
  buffer: ArrayBuffer | Buffer,
  reasonMap: Map<string, string>
): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as ArrayBuffer);

  const rows: ReturnRow[] = [];
  const errors: ReturnRowError[] = [];
  const sheets: string[] = [];
  const unknownReasons = new Set<string>();
  const seen = new Set<string>();
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let rowsRead = 0;
  let duplicates = 0;

  workbook.eachSheet((sheet) => {
    if (sheet.rowCount < 2) return; // abas vazias ("Planilha3") são ignoradas
    const columns = headerIndex(sheet.getRow(1));
    const missing = REQUIRED_HEADERS.filter((header) => !columns.has(header));
    if (missing.length > 0) {
      errors.push({
        sheet: sheet.name,
        row: 1,
        field: missing.join(", "),
        message: `aba ignorada: colunas obrigatórias ausentes (${missing.join(", ")})`
      });
      return;
    }

    sheets.push(sheet.name);
    const account = accountFromSheetName(sheet.name);
    const cell = (values: unknown[], header: string) => {
      const position = columns.get(header);
      return position == null ? null : values[position] ?? null;
    };

    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const values = sheet.getRow(rowNumber).values as unknown[];
      const returnId = text(cell(values, "return order id"));
      if (!returnId) continue; // linha em branco no meio da aba
      rowsRead += 1;

      if (seen.has(returnId)) {
        duplicates += 1;
        errors.push({
          sheet: sheet.name,
          row: rowNumber,
          field: "Return Order ID",
          message: `id repetido no arquivo (${returnId}); a última ocorrência prevalece`
        });
      }
      seen.add(returnId);

      const statusRaw = text(cell(values, "return status"));
      const status = statusRaw ? STATUS_MAP[statusRaw.toLowerCase()] : undefined;
      if (!status) {
        errors.push({
          sheet: sheet.name,
          row: rowNumber,
          field: "Return Status",
          message: `status desconhecido: ${statusRaw ?? "(vazio)"} — linha descartada`
        });
        continue;
      }

      const openedAt = parseDateTime(cell(values, "time requested"));
      if (!openedAt) {
        errors.push({
          sheet: sheet.name,
          row: rowNumber,
          field: "Time Requested",
          message: "data inválida ou ausente — linha descartada"
        });
        continue;
      }

      const typeRaw = text(cell(values, "return type"));
      const returnType = typeRaw ? TYPE_MAP[typeRaw.toLowerCase()] ?? null : null;

      const qtyRaw = cell(values, "return quantity");
      const qtyParsed = parseMoney(qtyRaw);
      const qtyAssumed = qtyParsed == null || qtyParsed <= 0;
      const qty = qtyAssumed ? 1 : qtyParsed;

      const reasonRaw = text(cell(values, "return reason"));
      const reasonGroup = reasonRaw ? reasonMap.get(reasonRaw) ?? null : null;
      if (reasonRaw && !reasonGroup) unknownReasons.add(reasonRaw);

      byStatus[status] = (byStatus[status] ?? 0) + 1;
      const typeKey = returnType ?? "(sem tipo)";
      byType[typeKey] = (byType[typeKey] ?? 0) + 1;

      rows.push({
        channel: "tiktok",
        return_id: returnId,
        account_ref: account,
        order_ref: text(cell(values, "order id")),
        sku_channel: text(cell(values, "seller sku")),
        // A NF da Olist usa o mesmo SKU; a reconciliação faz
        // coalesce(sku_olist, sku_channel), então não se inventa aqui.
        sku_olist: null,
        product_name: text(cell(values, "product name")),
        qty,
        qty_assumed: qtyAssumed,
        opened_at: openedAt,
        closed_at: parseDateTime(cell(values, "refund time")),
        status,
        return_type: returnType,
        reason_raw: reasonRaw,
        reason_group: reasonGroup ?? "outros",
        // Ver decisão 4 no topo: é o total, não o unitário. Não multiplicar.
        refund_amount: parseMoney(cell(values, "return unit price")),
        order_amount: parseMoney(cell(values, "order amount")),
        buyer_note: text(cell(values, "buyer note")),
        source: "upload",
        raw: {
          sheet: sheet.name,
          return_status: statusRaw,
          return_sub_status: text(cell(values, "return sub status")),
          order_status: text(cell(values, "order status")),
          order_substatus: text(cell(values, "order substatus")),
          payment_method: text(cell(values, "payment method")),
          sku_id: text(cell(values, "sku id")),
          sku_name: text(cell(values, "sku name")),
          buyer_username: text(cell(values, "buyer username")),
          tracking_id: text(cell(values, "return logistics tracking id")),
          dispute_status: text(cell(values, "dispute status")),
          appeal_status: text(cell(values, "appeal status")),
          compensation_status: text(cell(values, "compensation status")),
          compensation_amount: parseMoney(cell(values, "compensation amount"))
        }
      });
    }
  });

  return {
    rows,
    errors,
    sheets,
    unknownReasons: [...unknownReasons],
    stats: { rowsRead, duplicates, byStatus, byType }
  };
}
