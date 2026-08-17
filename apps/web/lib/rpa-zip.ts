// Empacota os RPAs de um lote num único ZIP.
//
// `fflate` em vez de `archiver` (que já entra transitivamente com o exceljs):
// é JS puro, síncrono, sem stream de Node, e roda igual em qualquer runtime.
//
// Compressão em nível baixo de propósito: PDF de texto com fontes padrão já é
// pequeno, e o custo de CPU de comprimir centenas deles não paga o punhado de
// KB economizado numa requisição com relógio correndo.

import { zipSync, strToU8 } from "fflate";
import { buildRpaPdf, type RpaBatchContext, type RpaIssuer, type RpaItem } from "./rpa-pdf";

/**
 * Nome de arquivo seguro em Windows, macOS e Linux: sem separador de caminho,
 * sem os caracteres reservados do Windows e sem ponto/espaço no fim (que o
 * Explorer descarta silenciosamente).
 */
export function safeFileName(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 120);
}

export type RpaZipResult = {
  bytes: Uint8Array;
  fileCount: number;
  failures: { recibo: string; nome: string; message: string }[];
};

export async function buildRpaZip(
  items: RpaItem[],
  issuer: RpaIssuer,
  batch: RpaBatchContext
): Promise<RpaZipResult> {
  const files: Record<string, Uint8Array> = {};
  const failures: RpaZipResult["failures"] = [];

  for (const item of items) {
    try {
      const pdf = await buildRpaPdf(item, issuer, batch);
      const cpf = item.cpf.replace(/\D/g, "");
      const name = safeFileName(`${item.recibo_numero} - ${item.nome} - ${cpf}`);
      files[`${name}.pdf`] = pdf;
    } catch (error) {
      // Um afiliado com dado impossível não pode levar junto os outros 771.
      // A falha vai para o manifesto dentro do próprio ZIP.
      failures.push({
        recibo: item.recibo_numero,
        nome: item.nome,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (failures.length > 0) {
    const linhas = [
      "Recibos que NAO puderam ser gerados neste lote:",
      "",
      ...failures.map((f) => `${f.recibo}\t${f.nome}\t${f.message}`)
    ];
    files["_FALHAS.txt"] = strToU8(linhas.join("\r\n"));
  }

  return {
    bytes: zipSync(files, { level: 1 }),
    fileCount: Object.keys(files).length - (failures.length > 0 ? 1 : 0),
    failures
  };
}
