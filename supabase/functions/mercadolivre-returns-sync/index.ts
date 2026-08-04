// Mercado Livre returns sync — reclamações e devoluções via post-purchase.
//
// Alimenta a camada canônica oraculo_returns (ver docs/plano-devolucoes.md).
//
// ⚠️ Regra de ouro — esta função NUNCA renova token. O único renovador é o
// mercadolivre-sync (o ML rotaciona o refresh_token). Se o access_token estiver
// perto de expirar, o run é pulado; o mercadolivre-sync roda de hora em hora.
//
// ⚠️ O /claims/search IGNORA filtro de data e ordenação. Testado contra a conta
// real: `date_created_from`, `date_created_to` e `sort=date_created,desc` são
// aceitos com HTTP 200 e simplesmente não têm efeito — o retorno é sempre o
// mesmo conjunto completo, começando em 2021. Só `offset` funciona de verdade,
// e a API exige ao menos um filtro (`stage` ou `type`), senão devolve 400
// `atLeastOneFilterProvided`.
//
// Consequência de desenho: não dá para pedir "só julho". A função pagina do FIM
// para o começo (offset decrescente a partir do total) e para quando encontra
// PAGE_STOP páginas seguidas sem nenhum caso dentro da janela pedida. Como o
// volume é baixo (1.285 reclamações desde 2021, 4 em julho/2026), varrer tudo
// também é viável — ?full=1 faz exatamente isso.
//
// ⚠️ Volume: uma única conta (JACARTTA), ~4 devoluções/mês. É ordem de grandeza
// diferente de Shopee (~2.700/mês) e TikTok (1.728/mês) — a tela precisa
// mostrar por canal para o ML não sumir dentro do consolidado.
//
// Protegida por x-sync-secret. Idempotente.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ML_API = "https://api.mercadolibre.com";
const PAGE_SIZE = 50;
const MAX_PAGES = 200;
const PAGE_STOP = 3;              // páginas seguidas fora da janela antes de parar
const TOKEN_MIN_TTL_MS = 5 * 60 * 1000;
const DEFAULT_DAYS = 45;

type Token = { seller_id: number; access_token: string; expires_at: string | null };

// resolution.benefited diz quem levou o caso:
//   ["complainant"] = comprador ganhou  -> perdemos (reembolso concedido)
//   ["respondent"]  = vendedor ganhou   -> ganhamos (reembolso recusado)
//   []              = ninguém (timeout, expirado) -> sem reembolso
function mapStatus(claim: Record<string, unknown>): string {
  const status = String(claim.status ?? "").toLowerCase();
  if (status === "opened" || status === "in_process") return "aberta";

  const resolution = (claim.resolution ?? null) as Record<string, unknown> | null;
  const benefited = Array.isArray(resolution?.benefited) ? (resolution!.benefited as string[]) : [];
  if (benefited.includes("complainant")) return "aceita";     // comprador levou
  if (benefited.includes("respondent")) return "recusada";    // levamos
  const reason = String(resolution?.reason ?? "").toLowerCase();
  if (reason.includes("expired") || reason.includes("timeout")) return "recusada";
  return "cancelada";
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function mlGet(path: string, token: string) {
  const res = await fetch(`${ML_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

// deno-lint-ignore no-explicit-any
async function enrich(claim: any, token: string) {
  // O /claims/search não traz valor nem SKU; o detalhe de returns traz.
  // Falha aqui não derruba o caso — a devolução entra sem valor e o campo
  // aparece vazio na tela, que é melhor que perder a linha inteira.
  try {
    const detail = await mlGet(`/post-purchase/v1/claims/${claim.id}/returns`, token);
    const entry = Array.isArray(detail) ? detail[0] : detail;
    const resource = entry?.resource ?? entry ?? {};
    const item = Array.isArray(resource?.items) ? resource.items[0] : null;
    return {
      refund_amount: num(resource?.refund_at_value ?? resource?.amount_refunded ?? entry?.amount),
      sku: item?.seller_sku ?? item?.sku ?? null,
      product_name: item?.title ?? null,
      qty: num(item?.quantity),
      detail: entry ?? null
    };
  } catch {
    return { refund_amount: null, sku: null, product_name: null, qty: null, detail: null };
  }
}

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get("MERCADOLIVRE_SYNC_JOB_SECRET");
  if (expectedSecret && req.headers.get("x-sync-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const url = new URL(req.url);
  const full = url.searchParams.get("full") === "1";
  const days = Number(url.searchParams.get("days") ?? DEFAULT_DAYS);
  const since = url.searchParams.get("from")
    ? Date.parse(url.searchParams.get("from")!)
    : Date.now() - Math.max(days, 1) * 24 * 3600 * 1000;

  const startedAt = new Date().toISOString();
  let upserted = 0;
  let scanned = 0;

  try {
    const { data: tokenRow } = await supabase
      .from("mercadolivre_tokens")
      .select("seller_id, access_token, expires_at")
      .limit(1)
      .maybeSingle();
    const token = tokenRow as Token | null;
    const expiresAt = token?.expires_at ? Date.parse(token.expires_at) : 0;
    if (!token?.access_token || expiresAt - Date.now() < TOKEN_MIN_TTL_MS) {
      return new Response(
        JSON.stringify({ skipped: "token ausente ou perto de expirar; mercadolivre-sync renova" }),
        { headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }

    const { data: reasonRows } = await supabase
      .from("oraculo_return_reason_map")
      .select("reason_raw, reason_group")
      .eq("channel", "mercadolivre");
    const reasonMap = new Map<string, string>(
      (reasonRows ?? []).map((r: { reason_raw: string; reason_group: string }) => [r.reason_raw, r.reason_group])
    );

    // Total primeiro: a varredura é do fim (mais recente) para trás.
    const head = await mlGet(`/post-purchase/v1/claims/search?stage=claim&limit=1`, token.access_token);
    const total = Number(head?.paging?.total ?? 0);

    let emptyStreak = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = Math.max(total - (page + 1) * PAGE_SIZE, 0);
      const json = await mlGet(
        `/post-purchase/v1/claims/search?stage=claim&limit=${PAGE_SIZE}&offset=${offset}`,
        token.access_token
      );
      const claims: Record<string, unknown>[] = json?.data ?? [];
      if (claims.length === 0) break;
      scanned += claims.length;

      const inWindow = claims.filter((c) => {
        const created = Date.parse(String(c.date_created ?? ""));
        return full || (Number.isFinite(created) && created >= since);
      });

      if (inWindow.length === 0) {
        emptyStreak += 1;
        if (!full && emptyStreak >= PAGE_STOP) break;
      } else {
        emptyStreak = 0;
        const rows = [];
        for (const claim of inWindow) {
          const extra = await enrich(claim, token.access_token);
          const status = mapStatus(claim);
          const resolution = (claim.resolution ?? null) as Record<string, unknown> | null;
          rows.push({
            channel: "mercadolivre",
            return_id: String(claim.id),
            account_ref: String(token.seller_id),
            order_ref: claim.resource === "order" && claim.resource_id ? String(claim.resource_id) : null,
            sku_channel: extra.sku ? String(extra.sku) : null,
            sku_olist: null,
            product_name: extra.product_name,
            qty: extra.qty ?? 1,
            qty_assumed: extra.qty == null,
            opened_at: claim.date_created ? new Date(String(claim.date_created)).toISOString() : null,
            closed_at: status === "aberta"
              ? null
              : (claim.last_updated ? new Date(String(claim.last_updated)).toISOString() : null),
            status,
            // O ML não separa "só reembolso" de "devolve o produto" no claim;
            // type='returns' indica retorno de mercadoria.
            return_type: String(claim.type ?? "") === "returns" ? "return_and_refund" : null,
            reason_raw: claim.reason_id ? String(claim.reason_id) : null,
            reason_group: reasonMap.get(String(claim.reason_id)) ?? "outros",
            refund_amount: extra.refund_amount,
            order_amount: null,
            buyer_note: null,
            source: "api",
            raw: {
              claim_type: claim.type,
              claim_status: claim.status,
              stage: claim.stage,
              resource: claim.resource,
              resource_id: claim.resource_id,
              reason_id: claim.reason_id,
              resolution,
              // benefited é o ganhamos/perdemos do funil — preservado explícito
              benefited: Array.isArray(resolution?.benefited) ? resolution!.benefited : [],
              players: claim.players,
              return_detail: extra.detail
            }
          });
        }

        if (rows.length > 0) {
          const { error } = await supabase
            .from("oraculo_returns")
            .upsert(rows, { onConflict: "channel,return_id" });
          if (error) throw new Error(`upsert: ${error.message}`);
          upserted += rows.length;
        }
      }

      if (offset === 0) break;
    }

    await supabase.from("mercadolivre_sync_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "success",
      orders_count: upserted
    });

    return new Response(
      JSON.stringify({ total, scanned, upserted, since: new Date(since).toISOString(), full }, null, 2),
      { headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  } catch (error) {
    await supabase.from("mercadolivre_sync_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "error",
      error_message: String((error as Error).message ?? error)
    });
    return new Response(
      JSON.stringify({ error: String((error as Error).message ?? error), upserted }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
});
