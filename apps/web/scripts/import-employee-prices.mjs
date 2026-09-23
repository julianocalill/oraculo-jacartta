import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const input = process.argv[2];
if (!input) throw new Error("Informe o caminho da planilha .xlsx.");

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(path.resolve(input));
const sheet = workbook.getWorksheet("NUMERADOR");
if (!sheet) throw new Error('A planilha precisa ter a aba "NUMERADOR".');

const expected = ["CÓDIGO", "DESCRIÇÃO DO PRODUTO", "FORNECEDOR", "CUSTO", "PREÇO P/ COLABORADOR"];
const headers = expected.map((_, index) => String(sheet.getCell(1, index + 1).value ?? "").trim());
if (headers.some((header, index) => header !== expected[index])) {
  throw new Error(`Cabeçalhos inesperados: ${headers.join(" | ")}`);
}

function resolved(cell) {
  const value = cell.value;
  return value && typeof value === "object" && "result" in value ? value.result : value;
}

const products = [];
sheet.eachRow((row, rowNumber) => {
  if (rowNumber === 1) return;
  const code = resolved(row.getCell(1));
  if (code == null || code === "") return;
  const product = resolved(row.getCell(2));
  const price = resolved(row.getCell(5));
  if (!Number.isFinite(Number(code)) || typeof product !== "string" || !Number.isFinite(Number(price))) {
    throw new Error(`Linha ${rowNumber} sem código, descrição ou preço calculado.`);
  }
  products.push([Number(code), product.trim(), Math.round(Number(price) * 100)]);
});

if (products.length === 0) throw new Error("Nenhum produto encontrado.");

const dateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).formatToParts(new Date());
const datePart = (type) => dateParts.find((part) => part.type === type)?.value;
const importedAt = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;

const lines = [
  "export type EmployeePriceProduct = readonly [codigo: number, produto: string, precoCentavos: number];",
  "",
  "// Gerado por scripts/import-employee-prices.mjs a partir da planilha aprovada.",
  "// Apenas código, descrição e preço final são publicados; custo e fórmula ficam fora da tela.",
  `export const EMPLOYEE_PRICE_UPDATED_AT = ${JSON.stringify(importedAt)};`,
  "",
  "export const EMPLOYEE_PRICE_PRODUCTS: readonly EmployeePriceProduct[] = [",
  ...products.map(([code, product, cents]) => `  [${code}, ${JSON.stringify(product)}, ${cents}],`),
  "] as const;",
  ""
];

const output = path.resolve("app/precos-colaboradores/data.ts");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, lines.join("\n"), "utf8");
console.log(`Importados ${products.length} preços para ${output}.`);
