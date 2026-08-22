// Loaders do recebimento/conferência (/logistica/recebimento).
//
// Leitura via client do usuário (RLS); escrita só nas Server Actions das
// páginas, com createSupabaseAdminClient() depois de assertTabAccess.

import { createSupabaseUserClient } from "../../../lib/supabase/user";

export type RecebimentoStatus = "aguardando" | "em_conferencia" | "concluido" | "concluido_com_divergencia";

export type RecebimentoProgress = {
  id: string;
  invoice_number: string;
  container_number: string | null;
  status: RecebimentoStatus;
  iniciado_em: string;
  iniciado_por: string | null;
  concluido_em: string | null;
  concluido_por: string | null;
  total_itens: number;
  itens_conferidos: number;
  itens_divergentes: number;
  qty_esperada_total: number;
  qty_conferida_total: number;
};

export type FaturaResumo = {
  invoice_number: string;
  process_name: string | null;
  container_number: string | null;
  vessel_name: string | null;
  port_arrival: string | null;
  entregue: boolean;
  itens: number;
};

export type RecebimentoItem = {
  id: number;
  recebimento_id: string;
  importacao_item_id: number | null;
  descricao: string;
  sku: string | null;
  qty_esperada: number | null;
  cartons_esperados: number | null;
  qty_conferida: number | null;
  cartons_conferidos: number | null;
  divergencia: "ok" | "falta" | "sobra" | "avaria" | null;
  observacao: string | null;
  conferido_em: string | null;
  conferido_por: string | null;
};

export type SkuOption = { sku: string; nome: string | null; disponivel: number | null };

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadRecebimentos() {
  const supabase = await createSupabaseUserClient();
  const [progressRes, faturasRes, itensRes] = await Promise.all([
    supabase
      .from("oraculo_recebimento_progress")
      .select("*")
      .order("iniciado_em", { ascending: false }),
    supabase
      .from("importacao_faturas_status")
      .select("invoice_number, process_name, container_number, vessel_name, port_arrival, entregue")
      .order("port_arrival", { ascending: false, nullsFirst: false }),
    supabase.from("importacao_itens").select("invoice_number")
  ]);

  const progress = ((progressRes.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    ...(row as unknown as RecebimentoProgress),
    total_itens: num(row.total_itens),
    itens_conferidos: num(row.itens_conferidos),
    itens_divergentes: num(row.itens_divergentes),
    qty_esperada_total: num(row.qty_esperada_total),
    qty_conferida_total: num(row.qty_conferida_total)
  }));

  const itensPorFatura = new Map<string, number>();
  for (const row of (itensRes.data ?? []) as Array<{ invoice_number: string }>) {
    itensPorFatura.set(row.invoice_number, (itensPorFatura.get(row.invoice_number) ?? 0) + 1);
  }

  const comRecebimento = new Set(progress.map((row) => row.invoice_number));
  const faturasSemConferencia: FaturaResumo[] = ((faturasRes.data ?? []) as Array<Omit<FaturaResumo, "itens">>)
    .filter((fatura) => !comRecebimento.has(fatura.invoice_number))
    .map((fatura) => ({ ...fatura, itens: itensPorFatura.get(fatura.invoice_number) ?? 0 }));

  return {
    abertos: progress.filter((row) => row.status === "em_conferencia" || row.status === "aguardando"),
    concluidos: progress.filter((row) => row.status.startsWith("concluido")).slice(0, 30),
    faturasSemConferencia
  };
}

export async function loadRecebimento(id: string) {
  const supabase = await createSupabaseUserClient();
  const [headRes, itensRes] = await Promise.all([
    supabase.from("oraculo_recebimento_progress").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("logistica_recebimento_itens")
      .select("*")
      .eq("recebimento_id", id)
      .order("id", { ascending: true })
  ]);

  if (!headRes.data) return null;
  const head = headRes.data as Record<string, unknown>;
  const itens = (itensRes.data ?? []) as RecebimentoItem[];

  // Saldo atual no Olist dos SKUs já informados — cruzamento informativo
  // (a entrada conferida deveria aparecer no saldo do ERP nos dias seguintes).
  const skus = Array.from(new Set(itens.map((item) => item.sku).filter((sku): sku is string => Boolean(sku))));
  const saldoPorSku = new Map<string, number | null>();
  if (skus.length > 0) {
    const { data } = await supabase
      .from("olist_stock_items")
      .select("sku, disponivel")
      .in("sku", skus)
      .eq("active", true);
    for (const row of (data ?? []) as Array<{ sku: string; disponivel: number | null }>) {
      saldoPorSku.set(row.sku, row.disponivel);
    }
  }

  return {
    recebimento: {
      ...(head as unknown as RecebimentoProgress),
      total_itens: num(head.total_itens),
      itens_conferidos: num(head.itens_conferidos),
      itens_divergentes: num(head.itens_divergentes),
      qty_esperada_total: num(head.qty_esperada_total),
      qty_conferida_total: num(head.qty_conferida_total)
    },
    itens,
    saldoPorSku
  };
}

// Lista de SKUs ativos do ERP para o <datalist> do campo SKU. Aqui o vínculo
// com o catálogo é desejado (diferente da etiqueta de palete): o objetivo é
// cruzar a entrada conferida com o saldo do Olist.
export async function loadSkuOptions(): Promise<SkuOption[]> {
  const supabase = await createSupabaseUserClient();
  const options: SkuOption[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("olist_stock_items")
      .select("sku, nome, disponivel")
      .eq("active", true)
      .not("sku", "is", null)
      .order("sku", { ascending: true })
      .range(from, from + 999);
    const page = (data ?? []) as SkuOption[];
    options.push(...page);
    if (page.length < 1000) break;
  }
  // O ERP tem SKUs repetidos entre produtos (kits/variações): o <datalist>
  // exige valor único, então fica a primeira ocorrência de cada SKU.
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.sku)) return false;
    seen.add(option.sku);
    return true;
  });
}

export function sugerirDivergencia(esperado: number | null, conferido: number | null) {
  if (esperado == null || conferido == null) return null;
  if (conferido < esperado) return "falta" as const;
  if (conferido > esperado) return "sobra" as const;
  return "ok" as const;
}
