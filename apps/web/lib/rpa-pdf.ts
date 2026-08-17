// Geração do PDF do Recibo de Pagamento a Autônomo.
//
// Este é o primeiro PDF gerado por biblioteca no repo, e é um desvio
// consciente: `docs/logistica-etiquetas.md` registra que a etiqueta de palete
// evitou pdf-lib usando `@page` + `window.print()`. Aquela via não serve aqui —
// `window.print()` produz UM arquivo com N páginas, e a contabilidade precisa
// de um recibo por afiliado, nomeado por CPF, dentro de um ZIP. `pdf-lib` é JS
// puro, sem binário nativo e sem headless browser (puppeteer, que o repo
// recusou, é outra ordem de grandeza).
//
// Fontes padrão (Helvetica) não são embutidas no arquivo, então cada recibo sai
// com poucos KB — o que torna viável gerar centenas numa requisição.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  formatAddressLine,
  formatBRL,
  formatCompetencia,
  formatCnpj,
  numeroPorExtenso
} from "@oraculo/domain/rpa.js";

export type RpaIssuer = {
  razao_social: string;
  cnpj: string;
  endereco: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
  inscricao_municipal: string | null;
  descricao_servico: string;
};

export type RpaItem = {
  recibo_numero: string;
  nome: string;
  cpf: string;
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
};

export type RpaBatchContext = {
  competencia: string;
  loja: string;
  file_name: string;
  aplica_inss: boolean;
  aplica_irrf: boolean;
  aplica_iss: boolean;
  iss_rate: number;
};

// A4 em pontos.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.08, 0.09, 0.12);
const SOFT = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.78, 0.8, 0.84);
const BAND = rgb(0.95, 0.96, 0.97);

/**
 * Caracteres de CP1252 que não existem em Latin-1 (faixa 0x80–0x9F). pdf-lib os
 * aceita em WinAnsiEncoding, então não devem ser filtrados junto com o resto.
 */
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178
]);

/**
 * As fontes padrão do PDF usam WinAnsiEncoding, que cobre o português inteiro
 * mas estoura com qualquer caractere fora dela — e o cadastro da Shopee é texto
 * livre digitado pelo afiliado. Nomes com acento passam intactos; o que não é
 * representável tenta perder o acento e, em último caso, vira "?". Um recibo
 * com um caractere degradado é recuperável; uma exceção derruba o lote inteiro.
 */
export function toWinAnsi(input: string | null | undefined): string {
  if (!input) return "";
  const out: string[] = [];
  for (const char of input.normalize("NFC")) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out.push(char);
    } else if (WIN_ANSI_EXTRAS.has(code)) {
      out.push(char);
    } else {
      const stripped = char.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const ok = [...stripped].every((c) => {
        const p = c.codePointAt(0) ?? 0;
        return (p >= 0x20 && p <= 0x7e) || (p >= 0xa0 && p <= 0xff);
      });
      out.push(ok && stripped.length > 0 ? stripped : "?");
    }
  }
  return out.join("");
}

/** Quebra o texto na largura disponível, medindo com a própria fonte. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ").filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = words[0];
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

type Fonts = { regular: PDFFont; bold: PDFFont };

function drawLabelValue(
  page: PDFPage,
  fonts: Fonts,
  x: number,
  y: number,
  label: string,
  value: string,
  width: number
): number {
  page.drawText(toWinAnsi(label.toUpperCase()), {
    x,
    y,
    size: 6.5,
    font: fonts.bold,
    color: SOFT
  });
  const lines = wrap(toWinAnsi(value || "—"), fonts.regular, 9, width);
  let cursor = y - 11;
  for (const line of lines) {
    page.drawText(line, { x, y: cursor, size: 9, font: fonts.regular, color: INK });
    cursor -= 11;
  }
  return cursor - 4;
}

function drawSectionTitle(page: PDFPage, fonts: Fonts, y: number, title: string): number {
  page.drawRectangle({
    x: MARGIN,
    y: y - 3,
    width: CONTENT_WIDTH,
    height: 16,
    color: BAND
  });
  page.drawText(toWinAnsi(title.toUpperCase()), {
    x: MARGIN + 6,
    y: y + 2,
    size: 7.5,
    font: fonts.bold,
    color: SOFT
  });
  return y - 14;
}

function drawMoneyRow(
  page: PDFPage,
  fonts: Fonts,
  y: number,
  label: string,
  value: string,
  options: { bold?: boolean; negative?: boolean } = {}
): number {
  const font = options.bold ? fonts.bold : fonts.regular;
  const size = options.bold ? 11 : 9.5;
  page.drawText(toWinAnsi(label), { x: MARGIN + 6, y, size, font, color: INK });
  const text = toWinAnsi(options.negative ? `- ${value}` : value);
  page.drawText(text, {
    x: PAGE_WIDTH - MARGIN - 6 - font.widthOfTextAtSize(text, size),
    y,
    size,
    font,
    color: INK
  });
  return y - (options.bold ? 20 : 15);
}

/** Data de hoje em São Paulo — o recibo é datado no dia da emissão. */
function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date());
}

function formatDateBR(iso: string | null): string {
  if (!iso) return "";
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

/** Monta o PDF de UM recibo. Devolve os bytes prontos para entrar no ZIP. */
export async function buildRpaPdf(
  item: RpaItem,
  issuer: RpaIssuer,
  batch: RpaBatchContext
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${item.recibo_numero} — ${item.nome}`);
  doc.setCreator("Oráculo");
  doc.setProducer("Oráculo");

  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold)
  };

  let y = PAGE_HEIGHT - MARGIN;

  // Cabeçalho
  page.drawText(toWinAnsi("RECIBO DE PAGAMENTO A AUTÔNOMO"), {
    x: MARGIN,
    y: y - 14,
    size: 15,
    font: fonts.bold,
    color: INK
  });
  const numero = toWinAnsi(item.recibo_numero);
  page.drawText(numero, {
    x: PAGE_WIDTH - MARGIN - fonts.bold.widthOfTextAtSize(numero, 11),
    y: y - 12,
    size: 11,
    font: fonts.bold,
    color: INK
  });
  y -= 28;
  page.drawText(toWinAnsi(`Competência ${formatCompetencia(batch.competencia)}`), {
    x: MARGIN,
    y,
    size: 9,
    font: fonts.regular,
    color: SOFT
  });
  y -= 12;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: INK
  });
  y -= 22;

  // Tomador
  y = drawSectionTitle(page, fonts, y, "Tomador do serviço");
  y -= 8;
  const half = CONTENT_WIDTH / 2 - 8;
  const tomadorTop = y;
  const leftEnd = drawLabelValue(page, fonts, MARGIN + 6, tomadorTop, "Razão social", issuer.razao_social, half);
  const rightEnd = drawLabelValue(
    page,
    fonts,
    MARGIN + CONTENT_WIDTH / 2 + 6,
    tomadorTop,
    "CNPJ",
    formatCnpj(issuer.cnpj),
    half
  );
  y = Math.min(leftEnd, rightEnd);
  const enderecoTomador = [issuer.endereco, [issuer.municipio, issuer.uf].filter(Boolean).join(" - "), issuer.cep]
    .filter(Boolean)
    .join(" · ");
  y = drawLabelValue(page, fonts, MARGIN + 6, y, "Endereço", enderecoTomador, CONTENT_WIDTH - 12);
  if (issuer.inscricao_municipal) {
    y = drawLabelValue(
      page,
      fonts,
      MARGIN + 6,
      y,
      "Inscrição municipal",
      issuer.inscricao_municipal,
      CONTENT_WIDTH - 12
    );
  }
  y -= 10;

  // Prestador
  y = drawSectionTitle(page, fonts, y, "Prestador do serviço");
  y -= 8;
  const prestadorTop = y;
  const nomeEnd = drawLabelValue(page, fonts, MARGIN + 6, prestadorTop, "Nome completo", item.nome, half);
  const cpfEnd = drawLabelValue(
    page,
    fonts,
    MARGIN + CONTENT_WIDTH / 2 + 6,
    prestadorTop,
    "CPF",
    item.cpf,
    half
  );
  y = Math.min(nomeEnd, cpfEnd);

  const endereco = formatAddressLine({
    parsed: Boolean(item.logradouro),
    raw: item.endereco_raw ?? "",
    logradouro: item.logradouro ?? "",
    numero: item.numero_endereco ?? "",
    complemento: item.complemento ?? "",
    bairro: item.bairro ?? "",
    cidade: item.cidade ?? "",
    uf: item.uf ?? "",
    cep: item.cep ?? ""
  });
  y = drawLabelValue(page, fonts, MARGIN + 6, y, "Endereço", endereco, CONTENT_WIDTH - 12);

  const contatoTop = y;
  const nascEnd = drawLabelValue(
    page,
    fonts,
    MARGIN + 6,
    contatoTop,
    "Data de nascimento",
    formatDateBR(item.nascimento),
    half
  );
  const contatoEnd = drawLabelValue(
    page,
    fonts,
    MARGIN + CONTENT_WIDTH / 2 + 6,
    contatoTop,
    "Contato",
    [item.email, item.telefone].filter(Boolean).join(" · "),
    half
  );
  y = Math.min(nascEnd, contatoEnd) - 10;

  // Serviço
  y = drawSectionTitle(page, fonts, y, "Discriminação do serviço");
  y -= 8;
  y = drawLabelValue(page, fonts, MARGIN + 6, y, "Serviço prestado", issuer.descricao_servico, CONTENT_WIDTH - 12);
  y = drawLabelValue(page, fonts, MARGIN + 6, y, "Loja", batch.loja, CONTENT_WIDTH - 12);
  y -= 10;

  // Valores
  y = drawSectionTitle(page, fonts, y, "Valores");
  y -= 18;
  y = drawMoneyRow(page, fonts, y, "Valor bruto da comissão", formatBRL(item.bruto_cents));
  if (batch.aplica_inss) {
    y = drawMoneyRow(page, fonts, y, "INSS (11%)", formatBRL(item.inss_cents), { negative: true });
  }
  if (batch.aplica_irrf) {
    y = drawMoneyRow(page, fonts, y, "IRRF (tabela progressiva)", formatBRL(item.irrf_cents), {
      negative: true
    });
  }
  if (batch.aplica_iss) {
    y = drawMoneyRow(page, fonts, y, `ISS (${batch.iss_rate}%)`, formatBRL(item.iss_cents), {
      negative: true
    });
  }
  if (!batch.aplica_inss && !batch.aplica_irrf && !batch.aplica_iss) {
    page.drawText(
      toWinAnsi("Sem retenções aplicadas — valor bruto para apuração pela contabilidade."),
      { x: MARGIN + 6, y, size: 8.5, font: fonts.regular, color: SOFT }
    );
    y -= 16;
  }

  y -= 2;
  page.drawLine({
    start: { x: MARGIN + 6, y: y + 12 },
    end: { x: PAGE_WIDTH - MARGIN - 6, y: y + 12 },
    thickness: 0.8,
    color: LINE
  });
  y = drawMoneyRow(page, fonts, y - 4, "VALOR LÍQUIDO", formatBRL(item.liquido_cents), { bold: true });

  const extenso = `(${numeroPorExtenso(item.liquido_cents)})`;
  for (const line of wrap(toWinAnsi(extenso), fonts.regular, 9, CONTENT_WIDTH - 12)) {
    page.drawText(line, { x: MARGIN + 6, y, size: 9, font: fonts.regular, color: SOFT });
    y -= 11;
  }
  y -= 18;

  // Declaração
  const declaracao =
    `Recebi de ${issuer.razao_social} a importância líquida de ${formatBRL(item.liquido_cents)}, ` +
    `referente aos serviços acima discriminados prestados na competência ` +
    `${formatCompetencia(batch.competencia)}, dando plena e geral quitação.`;
  for (const line of wrap(toWinAnsi(declaracao), fonts.regular, 9, CONTENT_WIDTH)) {
    page.drawText(line, { x: MARGIN, y, size: 9, font: fonts.regular, color: INK });
    y -= 12;
  }
  y -= 18;

  const local = [issuer.municipio, issuer.uf].filter(Boolean).join(" - ") || "____________________";
  page.drawText(toWinAnsi(`${local}, ${hojeSaoPaulo()}.`), {
    x: MARGIN,
    y,
    size: 9,
    font: fonts.regular,
    color: INK
  });
  y -= 56;

  // Assinaturas
  const sigWidth = CONTENT_WIDTH / 2 - 20;
  for (const [index, [nome, papel]] of (
    [
      [item.nome, "Prestador do serviço"],
      [issuer.razao_social, "Tomador do serviço"]
    ] as const
  ).entries()) {
    const x = MARGIN + index * (sigWidth + 40);
    page.drawLine({
      start: { x, y },
      end: { x: x + sigWidth, y },
      thickness: 0.8,
      color: INK
    });
    const linhas = wrap(toWinAnsi(nome), fonts.regular, 8.5, sigWidth);
    let cursor = y - 11;
    for (const linha of linhas) {
      page.drawText(linha, { x, y: cursor, size: 8.5, font: fonts.regular, color: INK });
      cursor -= 10;
    }
    page.drawText(toWinAnsi(papel), { x, y: cursor, size: 7, font: fonts.regular, color: SOFT });
  }

  // Rodapé: de onde este recibo veio. Sem isto, um PDF solto na mesa de alguém
  // não tem como ser reconciliado com o arquivo que o originou.
  page.drawText(
    toWinAnsi(`Gerado pelo Oráculo a partir de ${batch.file_name} · ${item.recibo_numero}`),
    { x: MARGIN, y: MARGIN - 14, size: 7, font: fonts.regular, color: SOFT }
  );

  return doc.save();
}
