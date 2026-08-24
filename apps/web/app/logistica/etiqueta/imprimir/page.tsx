import Link from "next/link";
import { headers } from "next/headers";
import { requireTabAccess } from "../../../../lib/auth/access";
import { renderQrSvg } from "../../../../lib/qrcode";
import { formatLabelLine, loadPaleteByCode } from "../../data";
import { PrintTrigger } from "./print-trigger";

export const dynamic = "force-dynamic";

const QR_SIZE_MM = 38;

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
  const qrSvg = await renderQrSvg(paleteUrl, QR_SIZE_MM);

  const linhas = palete.itens.map((item) =>
    formatLabelLine(palete.product_label, item.variation_label, item.quantity)
  );

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
            @page { size: 100mm 150mm; margin: 0; }

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
              width: 100mm;
              height: 150mm;
              padding: 6mm 5mm;
              margin: 0 auto 8mm;
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
              gap: 2mm;
              font-size: 7mm;
              line-height: 1.1;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.02em;
              margin: 0 0 3mm;
            }

            .etiqueta-sku {
              flex: none;
              white-space: nowrap;
            }

            .etiqueta-produto { min-width: 0; }

            .etiqueta-linhas {
              list-style: none;
              margin: 0;
              padding: 3mm 0;
              border-top: 0.6mm solid #000;
              border-bottom: 0.6mm solid #000;
            }
            .etiqueta-linhas li {
              font-size: 5mm;
              line-height: 1.35;
              font-weight: 600;
              margin: 0 0 1mm;
            }
            .etiqueta-linhas li:last-child { margin-bottom: 0; }

            .etiqueta-dados {
              display: flex;
              justify-content: space-between;
              gap: 4mm;
              margin-top: 3mm;
            }
            .etiqueta-dados div { min-width: 0; }
            .etiqueta-dados span {
              display: block;
              font-size: 3mm;
              text-transform: uppercase;
              letter-spacing: 0.08em;
            }
            .etiqueta-dados b {
              display: block;
              font-size: 6mm;
              line-height: 1.2;
            }

            .etiqueta-qr {
              margin-top: auto;
              text-align: center;
            }
            .etiqueta-qr svg { display: block; margin: 0 auto; }
            .etiqueta-codigo {
              margin: 2mm 0 0;
              font-size: 3.6mm;
              letter-spacing: 0.14em;
              font-family: "Courier New", monospace;
            }

            @media print {
              .etiqueta-toolbar { display: none; }
              .etiqueta {
                border: none;
                margin: 0;
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
          {palete.label_count} etiqueta{palete.label_count > 1 ? "s" : ""} · palete {palete.code}
        </span>
      </div>

      {copias.map((index) => (
        <article className="etiqueta" key={index}>
          <h1 className="etiqueta-cabecalho">
            {palete.product_sku ? <span className="etiqueta-sku">SKU: {palete.product_sku}</span> : null}
            <span className="etiqueta-produto">{palete.product_label}</span>
          </h1>

          <ul className="etiqueta-linhas">
            {linhas.map((linha, linhaIndex) => (
              <li key={linhaIndex}>{linha}</li>
            ))}
          </ul>

          <div className="etiqueta-dados">
            <div>
              <span>Nota fiscal</span>
              <b>{palete.invoice_number ?? "—"}</b>
            </div>
            <div>
              <span>Caixas / palete</span>
              <b>{palete.boxes_per_pallet ?? "—"}</b>
            </div>
          </div>

          <div className="etiqueta-qr">
            <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
            <p className="etiqueta-codigo">{palete.code}</p>
          </div>
        </article>
      ))}

      <PrintTrigger />
    </>
  );
}
