// Export .xlsx da sugestão de reposição Shopee. Usa o MESMO builder da aba,
// com os mesmos parâmetros da URL — a planilha é o que está na tela.
// Uma aba por loja + uma aba "Todas" quando o filtro está em "Todas as lojas".
import { NextRequest } from "next/server";
import { getCurrentUser } from "../../../../lib/auth/session";
import { buildXlsx, fileStamp, xlsxResponse, type XlsxColumn } from "../../../../lib/xlsx";
import { loadShopeeData, trendText } from "../../data";
import { SUGESTOES_POR_LOJA, buildReposicaoSuggestions, clampInt, situacaoMeta } from "../build-suggestions";

export const dynamic = "force-dynamic";

const COLUMNS: XlsxColumn[] = [
  { header: "#", key: "rank", width: 5, type: "number" },
  { header: "Loja", key: "loja", width: 18 },
  { header: "Produto", key: "titulo", width: 52 },
  { header: "Item ID", key: "itemId", width: 14 },
  { header: "SKU", key: "sku", width: 16 },
  { header: "Origem", key: "origem", width: 9 },
  { header: "Situação", key: "situacao", width: 17 },
  { header: "Curva", key: "curva", width: 7 },
  { header: "Vendas 30d", key: "v30", width: 11, type: "number" },
  { header: "Vendas 60d", key: "v60", width: 11, type: "number" },
  { header: "Tendência 120→0", key: "tendencia", width: 18 },
  { header: "Média/dia", key: "media", width: 10, type: "decimal" },
  { header: "Estoque", key: "estoque", width: 10, type: "number" },
  { header: "Trânsito", key: "transito", width: 10, type: "number" },
  { header: "Cobertura (dias)", key: "cobertura", width: 15, type: "number" },
  { header: "Alvo (un)", key: "alvoUn", width: 10, type: "number" },
  { header: "REPOR (un)", key: "enviar", width: 12, type: "number" },
  { header: "Preço", key: "preco", width: 12, type: "money" },
  { header: "Perda/dia", key: "perda", width: 12, type: "money" },
  { header: "Venda protegida", key: "gmv", width: 15, type: "money" },
  { header: "Custo unit.", key: "custoUnit", width: 12, type: "money" },
  { header: "Custo da reposição", key: "custoTotal", width: 17, type: "money" },
  { header: "Armazéns (FBS)", key: "armazens", width: 40 },
  { header: "Justificativa", key: "porque", width: 90 }
];

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("Não autorizado", { status: 401 });

  const sp = req.nextUrl.searchParams;
  const alvo = clampInt(sp.get("alvo"), 30, 7, 90);
  const prazo = clampInt(sp.get("prazo"), 7, 0, 30);
  const limite = clampInt(sp.get("limite"), SUGESTOES_POR_LOJA, 1, 100);
  const loja = Number(sp.get("loja")) || null;

  const data = await loadShopeeData();
  if (!data) return new Response("Sem dados sincronizados", { status: 404 });

  const { horizonte, trends, visiveis, totalUnidades, totalGmv } = buildReposicaoSuggestions(data, {
    alvo,
    prazo,
    limite,
    loja
  });

  const rows = visiveis.map((s, idx) => ({
    rank: idx + 1,
    loja: s.loja,
    titulo: s.titulo,
    itemId: s.itemId,
    sku: s.sku ?? "",
    origem: s.origem,
    situacao: situacaoMeta[s.situacao].label,
    curva: s.curve ? `Curva ${s.curve}` : "",
    v30: s.v30,
    v60: s.v60,
    tendencia: trendText(trends.get(s.trendKey)),
    media: Number(s.velocity.toFixed(1)),
    estoque: s.estoque,
    transito: s.transito,
    cobertura: Math.floor(s.cobertura),
    alvoUn: s.alvoUn,
    enviar: s.enviar,
    preco: s.preco,
    perda: s.lossPerDay > 0 ? s.lossPerDay : null,
    gmv: s.gmv,
    custoUnit: s.custo && s.custo > 0 ? s.custo : null,
    custoTotal: s.custo && s.custo > 0 ? s.custo * s.enviar : null,
    armazens: s.armazens,
    porque: s.porque
  }));

  const nomeLoja = loja ? visiveis[0]?.loja ?? String(loja) : "Todas as lojas";
  const geradoEm = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const buffer = await buildXlsx({
    sheetName: "Reposição Shopee",
    columns: COLUMNS,
    rows,
    meta: [
      `Oráculo · Sugestão de reposição Shopee · ${nomeLoja} · gerado em ${geradoEm}`,
      `Regra: repor = média/dia × (alvo ${alvo}d + prazo ${prazo}d) − estoque − trânsito · ` +
        `máx. ${limite} itens por loja · kits excluídos (repõe-se o produto simples)`,
      `${rows.length} itens · ${totalUnidades} unidades · venda protegida R$ ${totalGmv.toFixed(2)} · horizonte ${horizonte} dias`
    ]
  });

  const slug = loja ? nomeLoja.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : "todas";
  return xlsxResponse(buffer, `oraculo-reposicao-shopee_${slug}_${fileStamp()}.xlsx`);
}
