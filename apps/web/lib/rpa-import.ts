// Parse do Relatório Mensal de Afiliados da Shopee (.csv).
//
// Baixado à mão em Afiliados do Vendedor > Relatórios > Relatório Mensal,
// gerado todo dia 1º com os pedidos concluídos no mês anterior.
//
// Colunas são lidas pelo NOME do cabeçalho, nunca pela posição — mesmo motivo
// de `returns-import.ts`: a Shopee reordena e renomeia coluna sem avisar, e
// posição fixa quebra em silêncio, trocando um campo por outro.
//
// Armadilhas confirmadas no arquivo real de Jul/2026 (772 linhas):
//   1. BOM UTF-8 na primeira coluna — sem remover, "Mês de conclusão" nunca
//      casa com o cabeçalho procurado.
//   2. "Comissão  bruta" tem DOIS espaços no meio. O cabeçalho é normalizado
//      antes de comparar, senão a coluna de dinheiro some.
//   3. O telefone vem prefixado com U+200C (zero-width non-joiner), invisível.
//   4. Valor em pt-BR com prefixo ("R$4.087,10") — `parseMoney` de
//      returns-import.ts já resolve, não reimplementar.
//
// Linha inválida é descartada com erro no relatório; o arquivo inteiro só cai
// se faltar cabeçalho obrigatório.

import { parseMoney } from "./returns-import";
import {
  computeRetentions,
  formatCpf,
  isValidCpf,
  onlyDigits,
  parseAffiliateAddress,
  parseCompetencia,
  sanitizeText,
  IRRF_TABLE
} from "@oraculo/domain/rpa.js";

export type RpaParsedRow = {
  affiliate_id: string | null;
  nome: string;
  cpf: string;
  cpf_valido: boolean;
  nascimento: string | null;
  email: string | null;
  telefone: string | null;
  endereco_raw: string | null;
  logradouro: string | null;
  numero_endereco: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  bruto_cents: number;
  inss_cents: number;
  irrf_cents: number;
  iss_cents: number;
  liquido_cents: number;
  emitido: boolean;
};

export type RpaImportError = { row: number; field: string; message: string };

export type RpaParseResult = {
  competencia: string | null;
  rows: RpaParsedRow[];
  rowsRead: number;
  errors: RpaImportError[];
  irrfTableVersion: string;
};

export type RpaRetentionConfig = {
  aplicaInss: boolean;
  aplicaIrrf: boolean;
  aplicaIss: boolean;
  issRate: number;
  pisoCents: number;
};

const HEADERS = {
  competencia: "mes de conclusao",
  nome: "nome completo do afiliado",
  affiliateId: "id do afiliado",
  bruto: "comissao bruta",
  nascimento: "data de nascimento",
  endereco: "endereco",
  cpf: "cpf",
  email: "email",
  telefone: "telefone"
} as const;

const REQUIRED_HEADERS = [HEADERS.nome, HEADERS.bruto, HEADERS.cpf];

/**
 * Chave de comparação de cabeçalho: sem acento, sem caixa, espaços colapsados.
 * É o que faz "Comissão  bruta" (dois espaços) encontrar "comissao bruta".
 */
function headerKey(value: string): string {
  return sanitizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // marcas de acento combinantes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Divisor de CSV que respeita aspas e aspas escapadas (""), porque o endereço
 * vem entre aspas e contém vírgulas — um `split(",")` embaralha o registro.
 * O repo só tinha CSV de saída até aqui; uma função de 25 linhas resolve sem
 * trazer papaparse.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else quoted = false;
      } else current += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else current += char;
  }
  fields.push(current);
  return fields;
}

/** Quebra o arquivo em linhas lógicas, respeitando quebra dentro de aspas. */
function splitCsvRecords(text: string): string[] {
  const records: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      quoted = !quoted;
      current += char;
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      if (current.trim().length > 0) records.push(current);
      current = "";
    } else current += char;
  }
  if (current.trim().length > 0) records.push(current);
  return records;
}

/** "1981-02-08" -> "1981-02-08"; "08/02/1981" -> "1981-02-08". */
function parseBirthDate(value: string): string | null {
  const clean = sanitizeText(value);
  if (!clean) return null;
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = clean.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

export function parseShopeeAffiliateCsv(
  text: string,
  config: RpaRetentionConfig
): RpaParseResult {
  const errors: RpaImportError[] = [];
  // Remove o BOM antes de qualquer coisa: ele gruda no primeiro cabeçalho.
  const records = splitCsvRecords(text.replace(/^\ufeff/, ""));

  if (records.length === 0) {
    return {
      competencia: null,
      rows: [],
      rowsRead: 0,
      errors: [{ row: 0, field: "arquivo", message: "arquivo vazio" }],
      irrfTableVersion: IRRF_TABLE.vigenciaInicio
    };
  }

  const headerIndex = new Map<string, number>();
  splitCsvLine(records[0]).forEach((raw, index) => {
    const key = headerKey(raw);
    if (key && !headerIndex.has(key)) headerIndex.set(key, index);
  });

  const missing = REQUIRED_HEADERS.filter((h) => !headerIndex.has(h));
  if (missing.length > 0) {
    return {
      competencia: null,
      rows: [],
      rowsRead: 0,
      errors: [
        {
          row: 1,
          field: "cabeçalho",
          message: `colunas obrigatórias ausentes: ${missing.join(", ")}`
        }
      ],
      irrfTableVersion: IRRF_TABLE.vigenciaInicio
    };
  }

  const cell = (fields: string[], header: string): string => {
    const index = headerIndex.get(header);
    if (index == null) return "";
    return sanitizeText(fields[index] ?? "");
  };

  const rows: RpaParsedRow[] = [];
  const seenCpf = new Set<string>();
  let competencia: string | null = null;
  let rowsRead = 0;

  for (let i = 1; i < records.length; i += 1) {
    const lineNumber = i + 1;
    const fields = splitCsvLine(records[i]);
    rowsRead += 1;

    const nome = cell(fields, HEADERS.nome);
    const cpfDigits = onlyDigits(cell(fields, HEADERS.cpf));
    const brutoRaw = cell(fields, HEADERS.bruto);

    if (!nome) {
      errors.push({ row: lineNumber, field: "nome", message: "nome do afiliado vazio" });
      continue;
    }
    if (cpfDigits.length !== 11) {
      errors.push({
        row: lineNumber,
        field: "cpf",
        message: `CPF com ${cpfDigits.length} dígitos (esperado 11) — ${nome}`
      });
      continue;
    }
    if (seenCpf.has(cpfDigits)) {
      // O relatório de Jul/2026 não tinha nenhum, mas se a Shopee quebrar o
      // afiliado em duas linhas, somar às escondidas produziria um recibo que
      // não bate com o arquivo. Melhor recusar e mostrar.
      errors.push({
        row: lineNumber,
        field: "cpf",
        message: `CPF repetido no arquivo (${formatCpf(cpfDigits)}) — ${nome}`
      });
      continue;
    }

    const bruto = parseMoney(brutoRaw);
    if (bruto == null || bruto < 0) {
      errors.push({
        row: lineNumber,
        field: "comissão bruta",
        message: `valor ilegível ("${brutoRaw}") — ${nome}`
      });
      continue;
    }

    const brutoCents = Math.round(bruto * 100);
    const retencoes = computeRetentions({
      grossCents: brutoCents,
      inss: config.aplicaInss,
      irrf: config.aplicaIrrf,
      iss: config.aplicaIss,
      issRate: config.issRate
    });

    const endereco = parseAffiliateAddress(cell(fields, HEADERS.endereco));
    if (endereco.raw && !endereco.parsed) {
      errors.push({
        row: lineNumber,
        field: "endereço",
        message: `formato não reconhecido, o recibo usará o texto original — ${nome}`
      });
    }

    if (competencia == null) competencia = parseCompetencia(cell(fields, HEADERS.competencia));
    seenCpf.add(cpfDigits);

    rows.push({
      affiliate_id: cell(fields, HEADERS.affiliateId) || null,
      nome,
      cpf: formatCpf(cpfDigits),
      cpf_valido: isValidCpf(cpfDigits),
      nascimento: parseBirthDate(cell(fields, HEADERS.nascimento)),
      email: cell(fields, HEADERS.email) || null,
      telefone: cell(fields, HEADERS.telefone) || null,
      endereco_raw: endereco.raw || null,
      logradouro: endereco.parsed ? endereco.logradouro : null,
      numero_endereco: endereco.parsed ? endereco.numero : null,
      complemento: endereco.parsed ? endereco.complemento || null : null,
      bairro: endereco.parsed ? endereco.bairro : null,
      cidade: endereco.parsed ? endereco.cidade : null,
      uf: endereco.parsed ? endereco.uf : null,
      cep: endereco.parsed ? endereco.cep : null,
      bruto_cents: retencoes.grossCents,
      inss_cents: retencoes.inssCents,
      irrf_cents: retencoes.irrfCents,
      iss_cents: retencoes.issCents,
      liquido_cents: retencoes.netCents,
      emitido: retencoes.grossCents >= config.pisoCents
    });
  }

  // Ordem estável e previsível: o número do recibo acompanha o nome, então
  // reimportar o mesmo arquivo dá a mesma numeração.
  rows.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    competencia,
    rows,
    rowsRead,
    errors,
    irrfTableVersion: IRRF_TABLE.vigenciaInicio
  };
}
