// Export .xlsx da sugestão de envio Full. Usa o MESMO builder da aba, com os
// mesmos parâmetros da URL — a planilha é exatamente o que está na tela.
import { NextRequest } from "next/server";
import { getCurrentUser } from "../../../../lib/auth/session";
import { buildXlsx, fileStamp, xlsxResponse, type XlsxColumn } from "../../../../lib/xlsx";
import { loadMlData, trendText } from "../../data";
import {
  SUGESTOES_POR_LOJA,
  buildEnvioSuggestions,
  clampInt,
  parseCurva,
  situacaoMeta
} from "../build-suggestions";

export const dynamic = "force-dynamic";

const COLUMNS: XlsxColumn[] = [
  { header: "#", key: "rank", width: 5, type: "number" },
  { header: "Anúncio", key: "titulo", width: 52 },
  { header: "MLB", key: "mlb", width: 15 },
  { header: "SKU", key: "sku", width: 16 },
  { header: "Origem", key: "origem", width: 9 },
  { header: "Situação", key: "situacao", width: 16 },
  { header: "Curva", key: "curva", width: 7 },
  { header: "Vendas 30d", key: "v30", width: 11, type: "number" },
  { header: "Vendas 60d", key: "v60", width: 11, type: "number" },
  { header: "Tendência 120→0", key: "tendencia", width: 18 },
  { header: "Média/dia", key: "media", width: 10, type: "decimal" },
  { header: "Estoque Full", key: "full", width: 12, type: "number" },
  { header: "Trânsito", key: "transito", width: 10, type: "number" },
  { header: "Cobertura (dias)", key: "cobertura", width: 15, type: "number" },
  { header: "Alvo (un)", key: "alvoUn", width: 10, type: "number" },
  { header: "ENVIAR (un)", key: "enviar", width: 12, type: "number" },
  { header: "Preço", key: "preco", width: 12, type: "money" },
  { header: "Perda/dia", key: "perda", width: 12, type: "money" },
  { header: "Venda protegida", key: "gmv", width: 15, type: "money" },
  { header: "Custo unit.", key: "custoUnit", width: 12, type: "money" },
  { header: "Custo do envio", key: "custoEnvio", width: 14, type: "money" },
  { header: "Justificativa", key: "porque", width: 90 }
];

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Não autorizado", { status: 401 });

  const sp = req.nextUrl.searchParams;
  const alvo = clampInt(sp.get("alvo"), 30, 7, 90);
  const coleta = clampInt(sp.get("coleta"), 5, 0, 30);
  const limite = clampInt(sp.get("limite"), SUGESTOES_POR_LOJA, 1, 100);
  const curva = parseCurva(sp.get("curva"));

  const data = await loadMlData();
  if (!data) return new Response("Sem dados sincronizados", { status: 404 });

  const { horizonte, trends, visiveis, totalUnidades, totalGmv } = buildEnvioSuggestions(data, {
    alvo,
    coleta,
    limite,
    curva
  });

  const rows = visiveis.map((s, idx) => ({
    rank: idx + 1,
    titulo: s.item.title ?? s.item.mlb_id,
    mlb: s.item.mlb_id,
    sku: s.item.sku ?? "",
    origem: s.item.logistic_type === "fulfillment" ? "Full" : "Local",
    situacao: situacaoMeta[s.situacao].label,
    curva: s.curve ? `Curva ${s.curve}` : "",
    v30: s.item.sold_qty_30d,
    v60: s.item.sold_qty_60d,
    tendencia: trendText(trends.get(s.trendKey)),
    media: Number(s.velocity.toFixed(1)),
    full: s.item.full_stock,
    transito: s.transitQty,
    cobertura: Math.floor(s.coberturaAtual),
    alvoUn: s.alvoUnidades,
    enviar: s.enviar,
    preco: s.item.price ?? 0,
    perda: s.lossPerDay > 0 ? s.lossPerDay : null,
    gmv: s.gmvProtegido,
    custoUnit: s.custoUnit && s.custoUnit > 0 ? s.custoUnit : null,
    custoEnvio: s.custoUnit && s.custoUnit > 0 ? s.custoUnit * s.enviar : null,
    porque: s.porque
  }));

  const geradoEm = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const buffer = await buildXlsx({
    sheetName: "Envio Full",
    columns: COLUMNS,
    rows,
    meta: [
      `Oráculo · Sugestão de envio para o Mercado Livre Full · gerado em ${geradoEm}`,
      `Regra: enviar = média/dia × (alvo ${alvo}d + coleta ${coleta}d) − estoque Full − trânsito` +
        `${curva ? ` · somente Curva ${curva}` : ""} · máx. ${limite} itens por conta`,
      `${rows.length} itens · ${totalUnidades} unidades · venda protegida R$ ${totalGmv.toFixed(2)} · horizonte ${horizonte} dias`
    ]
  });

  return xlsxResponse(buffer, `oraculo-envio-full_${fileStamp()}.xlsx`);
}
