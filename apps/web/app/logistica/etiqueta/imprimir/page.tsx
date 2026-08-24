import Link from "next/link";
import { headers } from "next/headers";
import { requireTabAccess } from "../../../../lib/auth/access";
import { renderQrSvg } from "../../../../lib/qrcode";
import { formatLabelLine, loadPaleteByCode } from "../../data";
import { PrintTrigger } from "./print-trigger";

export const dynamic = "force-dynamic";

// Folha A4 em paisagem, com a etiqueta ocupando 85% da largura e da altura e
// centralizada pelas margens restantes. Todas as medidas derivam destes valores.
const PAGE_WIDTH_MM = 297;
const PAGE_HEIGHT_MM = 210;
const LABEL_SCALE = 0.85;

const LABEL_WIDTH_MM = PAGE_WIDTH_MM * LABEL_SCALE;
const LABEL_HEIGHT_MM = PAGE_HEIGHT_MM * LABEL_SCALE;
const MARGIN_X_MM = (PAGE_WIDTH_MM - LABEL_WIDTH_MM) / 2;
const MARGIN_Y_MM = (PAGE_HEIGHT_MM - LABEL_HEIGHT_MM) / 2;

const PADDING_X_MM = 16;
const PADDING_Y_MM = 12;
const CONTENT_WIDTH_MM = LABEL_WIDTH_MM - PADDING_X_MM * 2;
const CONTENT_HEIGHT_MM = LABEL_HEIGHT_MM - PADDING_Y_MM * 2;

const PRODUCT_TITLE_MM = 15;
const SKU_TITLE_MM = PRODUCT_TITLE_MM * 1.1;
const LINE_MM = 10;
const DATA_LABEL_MM = 4.5;
const DATA_VALUE_MM = 13;
const CODE_MM = 5;
const QR_SIZE_MM = 58;

const CHAR_W_UPPER = 0.58;
const CHAR_W_NORMAL = 0.5;

function linhasOcupadas(texto: string, fontMm: number, charWidth: number) {
  const larguraTexto = texto.length * fontMm * charWidth;
  return Math.max(1, Math.ceil(larguraTexto / CONTENT_WIDTH_MM));
}

function alturaEstimadaMm(titulo: string, linhas: string[], escala: number) {
  // Usa o corpo maior do SKU para ser conservador na estimativa do cabeçalho.
  const tituloMm = SKU_TITLE_MM * escala;
  const alturaTitulo = linhasOcupadas(titulo, tituloMm, CHAR_W_UPPER) * tituloMm * 1.1 + 5 * escala;

  const linhaMm = LINE_MM * escala;
  const totalLinhas = linhas.reduce(
    (acc, linha) => acc + linhasOcupadas(linha, linhaMm, CHAR_W_NORMAL),
    0
  );
  const alturaLista =
    totalLinhas * linhaMm * 1.3 + (linhas.length - 1) * 2 * escala + (8 + 2.4) * escala;

  const alturaDados =
    (DATA_LABEL_MM * 1.2 + DATA_VALUE_MM * 1.15) * 3 * escala + 12 * escala;
  const alturaQr = (QR_SIZE_MM + 2 + CODE_MM * 1.2) * escala;
  const alturaRodape = 6 * escala + Math.max(alturaDados, alturaQr);

  return alturaTitulo + alturaLista + alturaRodape;
}

/** Maior escala em que produto, variações, dados e QR ainda cabem na folha. */
function escalaQueCabe(titulo: string, linhas: string[]) {
  const limite = CONTENT_HEIGHT_MM - 5;

  for (let escala = 1; escala > 0.6; escala -= 0.02) {
    if (alturaEstimadaMm(titulo, linhas, escala) <= limite) {
      return Number(escala.toFixed(2));
    }
  }
  return 0.6;
}

/**
 * URL absoluta a partir do request — sem env nova, funciona igual em
 * localhost e em produção. `x-forwarded-proto` vem do proxy da Vercel.
 */
async function absoluteUrl(path: string) {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${path}`;
}

export default async function ImprimirPage({
  searchParams
}: {
  searchParams?: Promise<{ code?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const { allowed } = await requireTabAccess("logistica");
  if (!allowed) {
    return <p style={{ padding: 24 }}>Sem acesso à aba Logística.</p>;
  }

  const code = String(params.code ?? "").trim();
  const palete = code ? await loadPaleteByCode(code) : null;

  if (!palete) {
    return (
      <main style={{ padding: 24 }}>
        <p>Palete não encontrado.</p>
        <Link href="/logistica/etiqueta">Voltar para o formulário</Link>
      </main>
    );
  }

  const paleteUrl = await absoluteUrl(`/logistica/palete/${palete.code}`);
  const linhas = palete.itens.map((item) =>
    formatLabelLine(palete.product_label, item.variation_label, item.quantity)
  );
  const tituloImpresso = [palete.product_sku ? `SKU: ${palete.product_sku}` : null, palete.product_label]
    .filter(Boolean)
    .join(" ");
  const escala = escalaQueCabe(tituloImpresso, linhas);
  const qrSvg = await renderQrSvg(paleteUrl, QR_SIZE_MM * escala);

  // Todas as cópias são idênticas: um palete, um código, N etiquetas para colar
  // nas faces. Numeração por palete ficou fora do escopo desta primeira versão.
  const copias = Array.from({ length: palete.label_count }, (_, index) => index);

  return (
    <>
      {/*
        Estilos ficam aqui e não em globals.css de propósito: o tema do Oráculo
        é escuro e a etiqueta precisa ser preto sobre branco, na medida física
        exata. `!important` no body porque globals.css é carregado pelo layout
        raiz e pinta o fundo.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @page { size: A4 landscape; margin: 0; }

            body {
              background: #fff !important;
              color: #000 !important;
              margin: 0;
            }

            .etiqueta-toolbar {
              display: flex;
              gap: 12px;
              align-items: center;
              padding: 16px;
              font-family: system-ui, sans-serif;
              font-size: 14px;
              color: #111;
            }
            .etiqueta-toolbar a { color: #111; }

            .etiqueta {
              box-sizing: border-box;
              width: ${LABEL_WIDTH_MM}mm;
              height: ${LABEL_HEIGHT_MM}mm;
              padding: ${PADDING_Y_MM}mm ${PADDING_X_MM}mm;
              margin: ${MARGIN_Y_MM}mm auto 10mm;
              background: #fff;
              color: #000;
              font-family: Arial, Helvetica, sans-serif;
              display: flex;
              flex-direction: column;
              border: 1px solid #bbb;
              overflow: hidden;
            }

            .etiqueta-cabecalho {
              display: flex;
              flex-wrap: wrap;
              align-items: baseline;
              gap: calc(4mm * var(--escala));
              line-height: 1.1;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.02em;
              margin: 0 0 calc(5mm * var(--escala));
            }

            .etiqueta-sku {
              flex: none;
              white-space: nowrap;
              font-size: calc(${SKU_TITLE_MM}mm * var(--escala));
            }

            .etiqueta-produto {
              min-width: 0;
              font-size: calc(${PRODUCT_TITLE_MM}mm * var(--escala));
            }

            .etiqueta-linhas {
              list-style: none;
              margin: 0;
              padding: calc(4mm * var(--escala)) 0;
              border-top: calc(1.2mm * var(--escala)) solid #000;
              border-bottom: calc(1.2mm * var(--escala)) solid #000;
            }
            .etiqueta-linhas li {
              font-size: calc(${LINE_MM}mm * var(--escala));
              line-height: 1.3;
              font-weight: 600;
              margin: 0 0 calc(2mm * var(--escala));
            }
            .etiqueta-linhas li:last-child { margin-bottom: 0; }

            .etiqueta-rodape {
              display: flex;
              align-items: flex-end;
              justify-content: space-between;
              gap: 12mm;
              margin-top: auto;
              padding-top: calc(6mm * var(--escala));
            }

            .etiqueta-dados { min-width: 0; }
            .etiqueta-dados > div + div { margin-top: calc(6mm * var(--escala)); }
            .etiqueta-dados span {
              display: block;
              font-size: calc(${DATA_LABEL_MM}mm * var(--escala));
              text-transform: uppercase;
              letter-spacing: 0.08em;
            }
            .etiqueta-dados b {
              display: block;
              font-size: calc(${DATA_VALUE_MM}mm * var(--escala));
              line-height: 1.15;
            }

            .etiqueta-qr {
              flex: none;
              text-align: center;
            }
            .etiqueta-qr svg { display: block; margin: 0 auto; }
            .etiqueta-codigo {
              margin: calc(2mm * var(--escala)) 0 0;
              font-size: calc(${CODE_MM}mm * var(--escala));
              letter-spacing: 0.14em;
              font-family: "Courier New", monospace;
            }

            @media print {
              .etiqueta-toolbar { display: none; }
              .etiqueta {
                border: none;
                margin: ${MARGIN_Y_MM}mm ${MARGIN_X_MM}mm 0;
                page-break-after: always;
                break-after: page;
              }
              .etiqueta:last-child {
                page-break-after: auto;
                break-after: auto;
              }
            }
          `
        }}
      />
      <div className="etiqueta-toolbar">
        <Link href="/logistica/etiqueta">← Nova etiqueta</Link>
        <span>
          {palete.label_count} etiqueta{palete.label_count > 1 ? "s" : ""} · palete {palete.code} · A4
          horizontal
        </span>
      </div>

      {copias.map((index) => (
        <article
          className="etiqueta"
          key={index}
          style={{ "--escala": escala } as React.CSSProperties}
        >
          <h1 className="etiqueta-cabecalho">
            {palete.product_sku ? <span className="etiqueta-sku">SKU: {palete.product_sku}</span> : null}
            <span className="etiqueta-produto">{palete.product_label}</span>
          </h1>

          <ul className="etiqueta-linhas">
            {linhas.map((linha, linhaIndex) => (
              <li key={linhaIndex}>{linha}</li>
            ))}
          </ul>

          <div className="etiqueta-rodape">
            <div className="etiqueta-dados">
              <div>
                <span>Nota fiscal</span>
                <b>{palete.invoice_number ?? "—"}</b>
              </div>
              <div>
                <span>Caixas / palete</span>
                <b>{palete.boxes_per_pallet ?? "—"}</b>
              </div>
              <div>
                <span>Qtd Unidade</span>
                <b>{palete.unit_quantity ?? "—"}</b>
              </div>
            </div>

            <div className="etiqueta-qr">
              <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
              <p className="etiqueta-codigo">{palete.code}</p>
            </div>
          </div>
        </article>
      ))}

      <PrintTrigger />
    </>
  );
}
