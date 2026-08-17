// Recalcula oraculo_shopee_price_product_cache: preço × custo × lucro por
// anúncio/variação Shopee. Porta da análise validada em 16/08
// (analises/preco-produto-shopee-2026-08/): de-para por pedidos casados,
// custo pela regra kit/unitário, fórmula de lucro do Juliano e checagem de
// conflito de modelo. Roda de hora em hora (cron :57), depois dos syncs de
// produtos das 4 lojas (:22/:32/:44/:52).
import { createClient } from "npm:@supabase/supabase-js@2";

const env = {
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  serviceRole: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  syncSecret: Deno.env.get("SHOPEE_SYNC_SECRET") ?? ""
};

type Supabase = ReturnType<typeof createClient>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

const norm = (s: unknown) =>
  s === null || s === undefined || s === "" ? null : String(s).trim().toUpperCase();

// quantidade embutida no texto da variação: "120 Unidades" → 120, "5 Potes,Azul" → 5
function qnum(s: unknown): number | null {
  if (s === null || s === undefined || s === "") return null;
  const m = String(s).toLowerCase()
    .match(/(\d+)\s*(?:un\b|unid|unidades|potes?|p(?:ç|c)s?\b|pe(?:ç|c)as|rolos?|cabides?)/);
  return m ? Number(m[1]) : null;
}

function dims(txt: string): Set<string> {
  const out = new Set<string>();
  for (const m of txt.matchAll(/(\d{2,3})\s*[xX×]\s*(\d{2,3})/g)) {
    const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => y - x);
    out.add(`${a}x${b}`);
  }
  return out;
}
const vols = (t: string) => new Set([...t.toLowerCase().matchAll(/(\d{3,4})\s*ml/g)].map((m) => m[1]));
const pesos = (t: string) => new Set([...t.toLowerCase().matchAll(/(\d{1,2}(?:[.,]\d)?)\s*kg/g)].map((m) => m[1]));
const disjoint = <T>(a: Set<T>, b: Set<T>) => a.size > 0 && b.size > 0 && ![...a].some((x) => b.has(x));

// Fórmula do Juliano (mesma da planilha): por unidade vendida ao preço L.
function lucro(L: number, custoTotal: number): number {
  const comissao = L * (L <= 79.99 ? 0.20 : 0.14);
  const fixa = L <= 79.99 ? 4 : L <= 99.99 ? 16 : L <= 199.99 ? 20 : L <= 499.99 ? 26 : 28;
  return Number((L - custoTotal - (comissao + fixa) - L * 0.013 - L * 0.06 -
    (L - custoTotal) * 0.0925 - L * 0.03 - L * 0.03 - 1).toFixed(2));
}

async function fetchAll<T>(supabase: Supabase, table: string, select: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = supabase.from(table).select(select).range(from, from + page - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < page) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  if (env.syncSecret && req.headers.get("x-sync-secret") !== env.syncSecret) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const supabase = createClient(env.supabaseUrl, env.serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let runId: string | null = null;
  try {
    const { data: run, error: runError } = await supabase
      .from("oraculo_shopee_price_product_runs")
      .insert({ status: "running" })
      .select("id").single();
    if (runError) throw runError;
    runId = run.id as string;

    // 1) Pares (item, model) → SKU Olist por pedidos casados
    const { data: pairsRaw, error: pairsError } = await supabase.rpc("oraculo_shopee_item_model_pairs");
    if (pairsError) throw pairsError;
    const byPair = new Map<string, any[]>();
    for (const p of (pairsRaw as any[]) ?? []) {
      const key = `${p.item_id}|${p.model_id}`;
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key)!.push(p);
    }
    for (const list of byPair.values()) list.sort((a, b) => a.rk - b.rk);

    // 2) Cadastro Olist (espelho diário) + kits de componente único
    type Prod = {
      sku: string | null; nome: string | null; tipo: string | null; active: boolean | null;
      preco_custo: number | null; preco_custo_medio: number | null; kit: any;
    };
    const prods = await fetchAll<Prod>(supabase, "olist_products",
      "sku,nome,tipo,active,preco_custo,preco_custo_medio,kit:payload->kit");
    const olist = new Map<string, Prod>();
    for (const p of prods) {
      const k = norm(p.sku);
      if (!k) continue;
      const score = (p.active ? 2 : 0) + ((p.preco_custo ?? 0) > 0 ? 1 : 0);
      const cur = olist.get(k);
      const curScore = cur ? (cur.active ? 2 : 0) + ((cur.preco_custo ?? 0) > 0 ? 1 : 0) : -1;
      if (score > curScore) olist.set(k, p);
    }
    const kitmap = new Map<string, string>(); // `${componente}|${qtd}` → kit_sku
    for (const p of prods) {
      if (p.tipo !== "K" || !Array.isArray(p.kit) || p.kit.length !== 1) continue;
      const c = p.kit[0];
      const key = `${norm(c?.produto?.sku)}|${Math.round(Number(c?.quantidade ?? 0))}`;
      if (!kitmap.has(key)) kitmap.set(key, p.sku ?? "");
    }

    // 3) De-para por SKU do vendedor (cache já existente; respeita o throttle)
    await supabase.rpc("refresh_oraculo_sku_channel_map").then(() => {}, () => {});
    const skuMapRows = await fetchAll<any>(supabase, "oraculo_sku_channel_map_cache",
      "channel_sku,sku_olist,qty_ratio,orders_matched",
      (q) => q.eq("channel", "shopee").eq("pair_rank", 1).eq("match_status", "mapeado"));
    const skuMap = new Map<string, any>();
    for (const r of skuMapRows) {
      const k = norm(r.channel_sku);
      if (k && !skuMap.has(k)) skuMap.set(k, r);
    }

    // 4) Catálogo Shopee (sync horário) + nomes das lojas
    const { data: shops, error: shopsError } = await supabase
      .from("shopee_shops").select("shop_id,shop_name");
    if (shopsError) throw shopsError;
    const shopName = new Map<number, string>();
    for (const s of (shops as any[]) ?? []) shopName.set(Number(s.shop_id), s.shop_name ?? String(s.shop_id));

    type Listing = {
      shop_id: number; item_id: string; model_id: string | null; item_name: string | null;
      model_name: string | null; item_sku: string | null; model_sku: string | null;
      item_status: string | null; model_price: number | null; price_min: number | null;
    };
    const listings = (await fetchAll<Listing>(supabase, "shopee_products",
      "shop_id,item_id,model_id,item_name,model_name,item_sku,model_sku,item_status,model_price,price_min"))
      .filter((l) => l.item_status === "NORMAL");

    // 5) Resolver cada anúncio/variação
    type Res = { sku: string | null; qtd?: number; origem: string | null; pedidos: number };
    const res = new Map<Listing, Res>();
    for (const l of listings) {
      const modelId = l.model_id === null || l.model_id === "" ? "0" : String(l.model_id);
      const sellerSku = norm(l.model_sku) ?? norm(l.item_sku);
      let entry: Res | null = null;
      const plist = byPair.get(`${l.item_id}|${modelId}`);
      if (plist?.length) {
        const p1 = plist[0];
        const share = Number(p1.orders_matched) / Number(p1.orders_total);
        if (share >= 0.8) {
          const n = Number(p1.orders_matched);
          entry = {
            sku: p1.sku_olist,
            qtd: Math.max(1, Math.round(Number(p1.qty_ratio ?? 1))),
            origem: `venda casada (${n} pedido${n > 1 ? "s" : ""})`,
            pedidos: n
          };
        } else {
          const alt = plist[1]?.sku_olist ?? "?";
          res.set(l, {
            sku: null, pedidos: Number(p1.orders_total),
            origem: `ambíguo: ${p1.sku_olist} (${Math.round(share * 100)}%) vs ${alt}`
          });
          continue;
        }
      }
      if (!entry && sellerSku && skuMap.has(sellerSku)) {
        const m = skuMap.get(sellerSku)!;
        entry = {
          sku: m.sku_olist, qtd: Math.max(1, Math.round(Number(m.qty_ratio ?? 1))),
          origem: "SKU do de-para", pedidos: Number(m.orders_matched ?? 0)
        };
      }
      if (!entry && sellerSku && olist.has(sellerSku)) {
        entry = { sku: olist.get(sellerSku)!.sku, qtd: 1, origem: "SKU idêntico na Olist", pedidos: 0 };
      }
      res.set(l, entry ?? { sku: null, origem: null, pedidos: 0 });
    }

    // 5b) Herança entre variações do mesmo anúncio, ESCALADA pela quantidade
    const byItem = new Map<string, Listing[]>();
    for (const l of listings) {
      const key = `${l.shop_id}|${l.item_id}`;
      if (!byItem.has(key)) byItem.set(key, []);
      byItem.get(key)!.push(l);
    }
    for (const group of byItem.values()) {
      const solved = group.filter((l) => res.get(l)?.sku);
      if (!solved.length) continue;
      if (new Set(solved.map((l) => res.get(l)!.sku)).size > 1) continue;
      const base = solved[0];
      const { sku: skuB, qtd: qtdB = 1 } = res.get(base)!;
      const nB = qnum(base.model_name);
      for (const l of group) {
        const cur = res.get(l)!;
        if (cur.sku || cur.origem?.startsWith("ambíguo")) continue;
        const nT = qnum(l.model_name);
        if (nB && nT) {
          const fator = (qtdB * nT) / nB;
          if (Math.abs(fator - Math.round(fator)) < 0.01 && fator >= 1) {
            res.set(l, {
              sku: skuB, qtd: Math.round(fator), pedidos: 0,
              origem: `herdado do anúncio (escalado ${nB}→${nT} un)`
            });
          } else {
            res.set(l, { sku: null, pedidos: 0, origem: `variação com quantidade própria (${nT} un) — revisar` });
          }
        } else if (nB === nT) {
          res.set(l, { sku: skuB, qtd: qtdB, pedidos: 0, origem: "herdado do anúncio" });
        }
      }
    }

    // 6) Custo (regra kit/unitário), lucro e checagem
    const now = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];
    for (const l of listings) {
      const e = res.get(l)!;
      const modelId = l.model_id === null || l.model_id === "" ? "0" : String(l.model_id);
      const price = l.model_price ?? l.price_min;
      let origem = e.origem;
      let unitCost: number | null = null;
      let olistName: string | null = null;
      if (e.sku) {
        const p = olist.get(norm(e.sku)!);
        olistName = p?.nome ?? null;
        const cad = p?.preco_custo ?? 0;
        const medio = p?.preco_custo_medio ?? 0;
        const kitSku = kitmap.get(`${norm(e.sku)}|${e.qtd ?? 1}`);
        if (kitSku && medio > 0) {
          unitCost = Number(Number(medio).toFixed(2));
          origem += ` · custo do KIT ${kitSku} (${e.qtd}× ${e.sku})`;
        } else if (cad > 0) {
          unitCost = Number(Number(cad).toFixed(2));
          if (medio > 0 && cad > 3 * medio) {
            origem += ` · ATENÇÃO: preço de custo ${cad.toFixed(2)} vs médio ${medio.toFixed(2)} — conferir cadastro`;
          }
        } else if (medio > 0) {
          unitCost = Number(Number(medio).toFixed(2));
          origem += " · sem preço de custo no cadastro; usei o médio";
        } else {
          origem += " · CUSTO ZERADO na Olist";
        }
      }
      const costTotal = unitCost !== null && e.qtd ? Number((unitCost * e.qtd).toFixed(2)) : null;
      const profit = costTotal !== null && typeof price === "number" ? lucro(price, costTotal) : null;

      const flags: string[] = [];
      if (e.sku && olistName) {
        const ad = `${l.item_name ?? ""} ${l.model_name ?? ""}`;
        if (disjoint(dims(ad), dims(olistName))) {
          flags.push(`MODELO: anúncio diz ${[...dims(ad)].sort().join("/")}, Olist é ${[...dims(olistName)].sort().join("/")}`);
        }
        if (disjoint(vols(ad), vols(olistName))) {
          flags.push(`VOLUME: anúncio ${[...vols(ad)].sort().join("/")}ml vs Olist ${[...vols(olistName)].sort().join("/")}ml`);
        }
        if (disjoint(pesos(ad), pesos(olistName))) {
          flags.push(`PESO: anúncio ${[...pesos(ad)].sort().join("/")}kg vs Olist ${[...pesos(olistName)].sort().join("/")}kg`);
        }
        if (/venda casada \(1 pedido\)/.test(origem ?? "")) flags.push("evidência fraca (1 pedido)");
      }
      const checagem = e.sku ? (flags.length ? `⚠ ${flags.join(" · ")}` : "ok") : "";

      rows.push({
        shop_id: l.shop_id,
        shop_name: shopName.get(Number(l.shop_id)) ?? String(l.shop_id),
        item_id: l.item_id,
        model_id: modelId,
        item_name: l.item_name,
        model_name: l.model_name,
        channel_sku: l.model_sku || l.item_sku || null,
        item_status: l.item_status,
        price,
        sku_olist: e.sku,
        olist_product_name: olistName,
        qtd: e.sku && unitCost !== null ? e.qtd ?? 1 : null,
        unit_cost: unitCost,
        cost_total: costTotal,
        profit_unit: profit,
        origem: origem ?? "sem correspondência",
        pedidos: e.pedidos || null,
        checagem,
        refreshed_at: now
      });
    }

    // 7) Grava (upsert + remove o que saiu do catálogo)
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase
        .from("oraculo_shopee_price_product_cache")
        .upsert(rows.slice(i, i + 200), { onConflict: "shop_id,item_id,model_id" });
      if (error) throw error;
    }
    const { error: pruneError } = await supabase
      .from("oraculo_shopee_price_product_cache")
      .delete()
      .lt("refreshed_at", now);
    if (pruneError) throw pruneError;

    // Vendas por dia (60d) para o filtro de período da aba — mesma cadência.
    const { error: salesError } = await supabase.rpc("refresh_oraculo_shopee_precos_sales_daily");
    if (salesError) throw salesError;

    await supabase.from("oraculo_shopee_price_product_runs").update({
      finished_at: new Date().toISOString(), status: "success", rows_written: rows.length
    }).eq("id", runId);

    return jsonResponse({ ok: true, rows: rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("shopee-price-product-refresh", message);
    if (runId) {
      await supabase.from("oraculo_shopee_price_product_runs").update({
        finished_at: new Date().toISOString(), status: "failed", error_message: message
      }).eq("id", runId);
    }
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
