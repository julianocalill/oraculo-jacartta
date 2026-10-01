const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { createRequire } = Module;
const webRequire = createRequire(path.resolve(__dirname, "../apps/web/package.json"));
const ts = webRequire("typescript");
const ExcelJS = webRequire("exceljs");
const { unzipSync, zipSync, strFromU8, strToU8 } = webRequire("fflate");
const filename = path.resolve(__dirname, "../apps/web/lib/returns-import.ts");
const parser = new Module(filename, module);
parser.filename = filename;
parser.paths = Module._nodeModulePaths(path.dirname(filename));
parser._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 }
}).outputText, filename);
const { parseTikTokReturnsWorkbook } = parser.exports;

const headers = ["Return Order ID", "Order ID", "Return Status", "Return Type", "Time Requested", "Return Quantity", "Return unit price"];
const values = ["123456789012345678", "987654321098765432", "Completed", "Return and refund", "22/09/2026 14:06:58", "2", "R$ 62,90"];

async function workbook(name, fragmented = false) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(name);
  sheet.addRows([headers, values]);
  const buffer = await book.xlsx.writeBuffer();
  if (!fragmented) return Buffer.from(buffer);
  const files = unzipSync(new Uint8Array(buffer));
  // Reprodução da exportação: um elemento <row> para cada célula, todos
  // com o número lógico original; strings ficam em <v>, sem sharedStrings.
  const fragments = [headers, values].flatMap((row, index) => row.map((value, col) =>
    `<row r="${index + 1}"><c r="${String.fromCharCode(65 + col)}${index + 1}" t="str"><v>${value}</v></c></row>`
  )).join("");
  const xml = strFromU8(files["xl/worksheets/sheet1.xml"]);
  files["xl/worksheets/sheet1.xml"] = strToU8(xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${fragments}</sheetData>`));
  return Buffer.from(zipSync(files));
}

test("exportação com linhas fragmentadas preserva IDs, data, quantidade e total do estorno", async () => {
  const result = await parseTikTokReturnsWorkbook(await workbook("0", true), new Map(), "Donacor");
  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].return_id, values[0]);
  assert.equal(result.rows[0].order_ref, values[1]);
  assert.equal(result.rows[0].account_ref, "Donacor");
  assert.equal(result.rows[0].opened_at, "2026-09-22T17:06:58.000Z");
  assert.equal(result.rows[0].qty, 2);
  assert.equal(result.rows[0].refund_amount, 62.9);
  assert.equal(result.rows[0].status, "aceita");
  assert.equal(result.rows[0].return_type, "return_and_refund");
});

test("aba genérica exige loja e produz aviso em vez de gravar conta 0", async () => {
  const result = await parseTikTokReturnsWorkbook(await workbook("0", true), new Map());
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors[0].field, "Loja");
});

test("arquivo normal continua usando o nome da aba mesmo com loja selecionada", async () => {
  const result = await parseTikTokReturnsWorkbook(await workbook("tiktok Aliver"), new Map(), "Donacor");
  assert.equal(result.rows[0].account_ref, "Aliver");
  assert.equal(result.rows[0].return_id, values[0]);
  assert.equal(result.errors.length, 0);
});
