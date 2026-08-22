// Loader do estoque unificado por depósito (/logistica/estoque).
//
// Lê a view oraculo_estoque_por_deposito (uma linha por produto ativo, quebra
// por depósito em jsonb) e cruza com a watchlist unificada (sinal de ruptura).
// O builder é compartilhado com o export xlsx (regra #9 do AGENTS.md: a
// planilha é a tela por construção).

import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";

const PAGE_SIZE = 1000;

export type DepositBucket = {
  id: string;
  nome: string | null;
  tipo: string | null;
  desconsiderar: boolean;
  saldo: number | null;
  reservado: number | null;
  disponivel: number | null;
};

export type EstoqueRow = {
  produto_id: string;
  sku: string | null;
  nome: string | null;
  tipo: string | null;
  categoria_nome: string | null;
  peso_bruto_kg: number | null;
  volume_m3: number | null;
  saldo: number | null;
  reservado: number | null;
  disponivel: number | null;
  unit_cost: number | null;
  cost_source: string | null;
  capital_custo: number | null;
  depositos: DepositBucket[] | null;
};

export type WatchlistRow = {
  sku: string | null;
  stock_signal: string | null;
  days_until_stockout: number | null;
  units_30d: number | null;
};

export type DepositColumn = {
  id: string;
  nome: string;
  tipo: string | null;
};

export type EstoqueItem = EstoqueRow & {
  stock_signal: string | null;
  days_until_stockout: number | null;
  units_30d: number | null;
  porDeposito: Record<string, DepositBucket>;
};

export type DepositSummary = DepositColumn & {
  produtos: number;
  disponivel: number;
  capitalCusto: number;
};

export type EstoqueData = {
  items: EstoqueItem[];
  depositColumns: DepositColumn[];
  depositSummaries: DepositSummary[];
  totals: {
    produtos: number;
    disponivel: number;
    reservado: number;
    capitalCusto: number;
    semCusto: number;
    ruptura: number;
    rupturaIminente: number;
  };
};

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    const page = (data ?? []) as T[];
    if (error || page.length === 0) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

// Cache de 5min compartilhado entre usuários — dado global que muda no ritmo
// do sync de estoque (30 min). Client admin porque unstable_cache não pode
// ler cookies(); a view é grant select to authenticated de todo jeito.
export const loadEstoqueData = unstable_cache(loadEstoqueDataUncached, ["logistica-estoque"], {
  revalidate: 300
});

async function loadEstoqueDataUncached(): Promise<EstoqueData> {
  const supabase = createSupabaseAdminClient();

  const [rows, watchlist, depositosDim] = await Promise.all([
    fetchAllPages<EstoqueRow>((from, to) =>
      supabase
        .from("oraculo_estoque_por_deposito")
        .select("*")
        .order("produto_id", { ascending: true })
        .range(from, to)
    ),
    fetchAllPages<WatchlistRow>((from, to) =>
      supabase
        .from("oraculo_stock_watchlist_unified")
        .select("sku, stock_signal, days_until_stockout, units_30d")
        .eq("source", "olist")
        .not("sku", "is", null)
        .range(from, to)
    ),
    supabase
      .from("logistica_depositos")
      .select("deposito_id, nome, apelido, tipo, ativo")
      .eq("ativo", true)
      .order("nome", { ascending: true })
      .then((res) => (res.data ?? []) as Array<{
        deposito_id: string;
        nome: string;
        apelido: string | null;
        tipo: string | null;
      }>)
  ]);

  const signalBySku = new Map<string, WatchlistRow>();
  for (const row of watchlist) {
    if (row.sku) signalBySku.set(row.sku, row);
  }

  const items: EstoqueItem[] = rows.map((row) => {
    const signal = row.sku ? signalBySku.get(row.sku) : undefined;
    const porDeposito: Record<string, DepositBucket> = {};
    for (const bucket of row.depositos ?? []) {
      porDeposito[bucket.id] = bucket;
    }
    return {
      ...row,
      stock_signal: signal?.stock_signal ?? null,
      days_until_stockout: signal?.days_until_stockout ?? null,
      units_30d: signal?.units_30d ?? null,
      porDeposito
    };
  });

  // Só vira coluna o depósito que tem movimento em algum produto — a conta
  // tem 8 depósitos cadastrados, mas vários ficam zerados o tempo todo.
  const movimento = new Map<string, DepositSummary>();
  for (const item of items) {
    for (const bucket of item.depositos ?? []) {
      const dim = depositosDim.find((d) => d.deposito_id === bucket.id);
      const current = movimento.get(bucket.id) ?? {
        id: bucket.id,
        nome: dim?.apelido ?? dim?.nome ?? bucket.nome ?? bucket.id,
        tipo: dim?.tipo ?? bucket.tipo ?? null,
        produtos: 0,
        disponivel: 0,
        capitalCusto: 0
      };
      current.produtos += 1;
      current.disponivel += n(bucket.disponivel);
      if (item.unit_cost != null && n(bucket.disponivel) > 0) {
        current.capitalCusto += n(bucket.disponivel) * item.unit_cost;
      }
      movimento.set(bucket.id, current);
    }
  }

  const depositSummaries = Array.from(movimento.values()).sort(
    (a, b) => b.capitalCusto - a.capitalCusto || b.disponivel - a.disponivel
  );

  // olist_stock_items.reservado é sempre NULL (o payload de produtos/{id} não
  // traz o campo) — o reservado real vem da quebra por depósito, somando só os
  // depósitos que contam para o saldo consolidado (desconsiderar = false).
  const reservadoTotal = items.reduce(
    (sum, item) =>
      sum +
      (item.depositos ?? [])
        .filter((bucket) => !bucket.desconsiderar)
        .reduce((acc, bucket) => acc + n(bucket.reservado), 0),
    0
  );

  const totals = {
    produtos: items.length,
    disponivel: items.reduce((sum, item) => sum + n(item.disponivel), 0),
    reservado: reservadoTotal,
    capitalCusto: items.reduce((sum, item) => sum + n(item.capital_custo), 0),
    semCusto: items.filter((item) => item.unit_cost == null && n(item.disponivel) > 0).length,
    ruptura: items.filter((item) => item.stock_signal === "ruptura").length,
    rupturaIminente: items.filter((item) => item.stock_signal === "ruptura_iminente").length
  };

  return {
    items,
    depositColumns: depositSummaries.map(({ id, nome, tipo }) => ({ id, nome, tipo })),
    depositSummaries,
    totals
  };
}

export type EstoqueFilters = {
  deposito: string;
  sinal: string;
  busca: string;
};

export function filterItems(items: EstoqueItem[], filters: EstoqueFilters) {
  const busca = filters.busca.trim().toLocaleLowerCase("pt-BR");
  return items.filter((item) => {
    if (filters.deposito !== "all") {
      const bucket = item.porDeposito[filters.deposito];
      if (!bucket) return false;
      if (n(bucket.saldo) === 0 && n(bucket.reservado) === 0 && n(bucket.disponivel) === 0) return false;
    }
    if (filters.sinal !== "all" && item.stock_signal !== filters.sinal) return false;
    if (busca) {
      const alvo = `${item.sku ?? ""} ${item.nome ?? ""}`.toLocaleLowerCase("pt-BR");
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}
