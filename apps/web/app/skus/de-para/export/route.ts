// Export .xlsx do de-para de SKUs: anúncio do marketplace → SKU do cadastro
// Olist (onde a baixa de estoque acontece). O vínculo é derivado por
// co-ocorrência de pedidos casados — a API v3 da Olist não expõe o mapeamento
// de anúncios. O refresh do cache roda aqui mesmo (throttle de 6h no banco):
// quem baixa a planilha é quem mantém o dado fresco, sem job de cron.
import { getCurrentUser } from "../../../../lib/auth/session";
import { canAccess } from "../../../../lib/auth/access";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { buildXlsxWorkbook, fileStamp, xlsxResponse, type XlsxColumn } from "../../../../lib/xlsx";

export const dynamic = "force-dynamic";

type MapRow = {
  channel: string;
  channel_key: string;
  channel_sku: string | null;
  channel_item_id: string | null;
  channel_model_id: string | null;
  channel_variation: string | null;
  channel_product_name: string | null;
  sku_olist: string | null;
  olist_product_name: string | null;
  olist_is_kit: boolean | null;
  orders_matched: number;
  orders_total: number;
  share: number | null;
  qty_ratio: number | null;
  last_sale_at: string | null;
  pair_rank: number;
  match_status: string;
  refreshed_at: string;
};

const COLUMNS: XlsxColumn[] = [
  { header: "SKU anúncio", key: "skuAnuncio", width: 22 },
  { header: "Item ID", key: "itemId", width: 16 },
  { header: "ID variação", key: "modelId", width: 15 },
  { header: "Variação", key: "variacao", width: 26 },
  { header: "Nome do anúncio", key: "nomeAnuncio", width: 52 },
  { header: "SKU Olist", key: "skuOlist", width: 22 },
  { header: "Produto Olist", key: "produtoOlist", width: 52 },
  { header: "Kit?", key: "kit", width: 6 },
  { header: "Razão qtde", key: "qtyRatio", width: 11, type: "decimal" },
  { header: "Pedidos", key: "pedidos", width: 9, type: "number" },
  { header: "Confiança %", key: "confianca", width: 12, type: "decimal" },
  { header: "Última venda", key: "ultimaVenda", width: 13 },
  { header: "Status", key: "status", width: 14 }
];

const UNMAPPED_COLUMNS: XlsxColumn[] = [{ header: "Canal", key: "canal", width: 14 }, ...COLUMNS];

const STATUS_LABEL: Record<string, string> = {
  mapeado: "Mapeado",
  ambiguo: "Ambíguo",
  sem_casamento: "Sem casamento"
};

const CHANNEL_LABEL: Record<string, string> = {
  shopee: "Shopee",
  mercadolivre: "Mercado Livre",
  tiktok: "TikTok"
};

function toRow(r: MapRow) {
  return {
    canal: CHANNEL_LABEL[r.channel] ?? r.channel,
    skuAnuncio: r.channel_sku ?? "",
    itemId: r.channel_item_id ?? "",
    modelId: r.channel_model_id ?? "",
    variacao: r.channel_variation ?? "",
    nomeAnuncio: r.channel_product_name ?? "",
    skuOlist: r.sku_olist ?? "",
    produtoOlist: r.olist_product_name ?? "",
    kit: r.olist_is_kit ? "Sim" : "",
    qtyRatio: r.qty_ratio,
    pedidos: r.orders_matched,
    confianca: r.share != null ? Number((r.share * 100).toFixed(1)) : null,
    ultimaVenda: r.last_sale_at
      ? new Date(r.last_sale_at).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
      : "",
    status: STATUS_LABEL[r.match_status] ?? r.match_status
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Não autorizado", { status: 401 });
  if (!canAccess(user, "skus")) return new Response("Sem acesso a esta aba", { status: 403 });

  const admin = createSupabaseAdminClient();

  // Atualiza o cache se estiver com mais de 6h (o throttle mora na function).
  // Se o refresh falhar, ainda exportamos o cache existente — melhor planilha
  // de ontem do que erro 500.
  try {
    await admin.rpc("refresh_oraculo_sku_channel_map");
  } catch {
    // segue com o cache atual
  }

  // PostgREST limita a 1000 linhas por request; pagina até esgotar.
  const rows: MapRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("oraculo_sku_channel_map_cache")
      .select("*")
      .order("channel")
      .order("channel_key")
      .order("pair_rank")
      .range(from, from + pageSize - 1);
    if (error) return new Response(`Erro ao ler o de-para: ${error.message}`, { status: 500 });
    rows.push(...((data ?? []) as MapRow[]));
    if (!data || data.length < pageSize) break;
  }
  if (rows.length === 0) return new Response("Cache do de-para vazio", { status: 404 });

  const geradoEm = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const refreshedAt = rows[0]?.refreshed_at
    ? new Date(rows[0].refreshed_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "-";
  const metaBase = [
    `Oráculo · De-para de SKUs (anúncio do canal → SKU Olist) · gerado em ${geradoEm} · dados calculados em ${refreshedAt}`,
    "Derivado de pedidos casados pelo nº do pedido do marketplace, usando só pedidos com 1 SKU de cada lado. " +
      "Mapeado = ≥2 pedidos e ≥80% de dominância · Razão qtde > 1 sugere kit/multiplicador."
  ];

  const byStatusThenOrders = (a: MapRow, b: MapRow) => {
    if (a.match_status !== b.match_status) return a.match_status === "mapeado" ? -1 : 1;
    return b.orders_matched - a.orders_matched;
  };

  const channelSheets = (["shopee", "mercadolivre", "tiktok"] as const).map((channel) => {
    const channelRows = rows
      .filter((r) => r.channel === channel && r.pair_rank === 1)
      .sort(byStatusThenOrders);
    const mapped = channelRows.filter((r) => r.match_status === "mapeado").length;
    return {
      sheetName: CHANNEL_LABEL[channel],
      columns: COLUMNS,
      rows: channelRows.map(toRow),
      meta: [...metaBase, `${channelRows.length} anúncios · ${mapped} mapeados`]
    };
  });

  // Tudo que precisa de atenção humana, incluindo o "vice" (pair_rank 2) que
  // evidencia para qual outro SKU Olist o anúncio já apontou.
  const attentionRows = rows
    .filter((r) => r.match_status !== "mapeado")
    .sort((a, b) =>
      a.channel === b.channel ? b.orders_matched - a.orders_matched : a.channel.localeCompare(b.channel)
    );

  const buffer = await buildXlsxWorkbook([
    ...channelSheets,
    {
      sheetName: "Não mapeados e ambíguos",
      columns: UNMAPPED_COLUMNS,
      rows: attentionRows.map(toRow),
      meta: [
        ...metaBase,
        "Ambíguo = pedidos apontam para mais de um SKU Olist (as duas linhas aparecem) ou evidência insuficiente. " +
          "Sem casamento = anúncio do catálogo sem nenhum pedido casado."
      ]
    }
  ]);

  return xlsxResponse(buffer, `oraculo-de-para-skus_${fileStamp()}.xlsx`);
}
