import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { createSupabaseUserClient } from "../../lib/supabase/user";
import { assertTabAccess, requireTabAccess } from "../../lib/auth/access";
import { NoAccess } from "../components/no-access";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { loadFiscalCostGapSnapshot } from "../../lib/fiscal-snapshots";

export const dynamic = "force-dynamic";

type ChannelParam = {
  source: string;
  channel_key: string;
  display_name: string | null;
  tax_rate: number | null;
  marketplace_fee_rate: number | null;
  payment_fee_rate: number | null;
  freight_subsidy_per_unit: number | null;
  packaging_cost_per_unit: number | null;
  target_margin_rate: number | null;
  minimum_margin_rate: number | null;
  params_configured: boolean | null;
  updated_at: string | null;
};

type SkuParam = {
  source: string;
  sku: string;
  unit_cost_override: number | null;
  target_margin_rate_override: number | null;
  minimum_margin_rate_override: number | null;
  active: boolean | null;
  notes: string | null;
  updated_at: string | null;
};

type StateTaxParam = {
  uf: string;
  operation_type: string;
  icms_rate: number | null;
  interstate_icms_rate: number | null;
  fcp_rate: number | null;
  difal_rate: number | null;
  effective_tax_rate: number | null;
  applies_to_source: string;
  merchandise_origin: string;
  /** Nulo = o motor usa a matriz Jacartta (MG 6%/14%, demais UFs 1,3%). */
  outbound_icms_rate: number | null;
  params_configured: boolean | null;
  valid_from: string | null;
  valid_to: string | null;
  notes: string | null;
  updated_at: string | null;
};

type MarginProbe = {
  source: string | null;
  unit_cost: number | null;
  margin_signal: string | null;
};

type ProductCostSourceRow = {
  sku: string | null;
  nome: string | null;
  tipo: string | null;
  active: boolean | null;
  preco_custo: number | null;
  preco_custo_medio: number | null;
};

type CanonicalCostRow = {
  sku: string;
  unit_cost: number | null;
  unit_cost_gross: number | null;
  cost_source: string | null;
};

type CostAuditStatus = "ok" | "revisar" | "sem-custo" | "override" | "kit";

type CostAuditRow = {
  sku: string;
  name: string | null;
  type: string | null;
  erpCost: number | null;
  erpAverageCost: number | null;
  grossCost: number | null;
  netCost: number | null;
  costSource: string | null;
  status: CostAuditStatus;
  overrideSource: string | null;
  overrideUpdatedAt: string | null;
  overrideNotes: string | null;
};


function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2
  }).format(n(value));
}

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    maximumFractionDigits: 2
  }).format(value);
}

function count(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(n(value));
}

function date(value: string | null | undefined) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

function parseNumber(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseRate(value: unknown) {
  const parsed = parseNumber(String(value ?? "").replace("%", ""));
  if (parsed == null) return null;
  return parsed > 1 ? parsed / 100 : parsed;
}

function parseBoolean(value: unknown, fallback = true) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "sim", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "nao", "não", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function parseDateValue(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>
) {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function saveChannelParam(formData: FormData) {
  "use server";
  await assertTabAccess("parametros");

  const row = {
    source: String(formData.get("source") ?? "").trim().toLowerCase(),
    channel_key: String(formData.get("channel_key") || "*").trim() || "*",
    display_name: String(formData.get("display_name") || "").trim() || null,
    tax_rate: parseRate(formData.get("tax_rate")) ?? 0,
    marketplace_fee_rate: parseRate(formData.get("marketplace_fee_rate")) ?? 0,
    payment_fee_rate: parseRate(formData.get("payment_fee_rate")) ?? 0,
    freight_subsidy_per_unit: parseNumber(formData.get("freight_subsidy_per_unit")) ?? 0,
    packaging_cost_per_unit: parseNumber(formData.get("packaging_cost_per_unit")) ?? 0,
    target_margin_rate: parseRate(formData.get("target_margin_rate")) ?? 0.25,
    minimum_margin_rate: parseRate(formData.get("minimum_margin_rate")) ?? 0.12,
    params_configured: parseBoolean(formData.get("params_configured"), true),
    notes: String(formData.get("notes") || "").trim() || null,
    updated_at: new Date().toISOString()
  };

  if (row.source) {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("oraculo_margin_channel_params")
      .upsert(row, { onConflict: "source,channel_key" });

    if (error) throw error;
  }

  revalidatePath("/parametros");
  revalidatePath("/skus");
}

async function saveSkuParam(formData: FormData) {
  "use server";
  await assertTabAccess("parametros");

  const row = {
    source: String(formData.get("source") ?? "").trim().toLowerCase(),
    sku: String(formData.get("sku") ?? "").trim(),
    unit_cost_override: parseNumber(formData.get("unit_cost_override")),
    target_margin_rate_override: parseRate(formData.get("target_margin_rate_override")),
    minimum_margin_rate_override: parseRate(formData.get("minimum_margin_rate_override")),
    active: parseBoolean(formData.get("active"), true),
    notes: String(formData.get("notes") || "").trim() || null,
    updated_at: new Date().toISOString()
  };

  if (row.source && row.sku) {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("oraculo_margin_sku_params")
      .upsert(row, { onConflict: "source,sku" });

    if (error) throw error;

    // Um custo Olist pode tirar o SKU da lista de "Custos pendentes" e mudar
    // a Cobertura fiscal. oraculo_capture_fiscal_margin_snapshots() direto
    // (~15-25s) estoura o timeout do caminho REST — nem com SET LOCAL dentro
    // da função (testado ao vivo, confirmado). oraculo_trigger_fiscal_recompute
    // só agenda um job pg_cron de um tiro (retorna na hora); o recálculo
    // pesado roda em até 1 minuto por fora do request. O SKU some da tela
    // na hora mesmo assim — loadParametros filtra pelos overrides ativos
    // antes do snapshot terminar. Override Shopee não alimenta o motor
    // fiscal (lê oraculo_sku_unit_cost ao vivo, não snapshot), sem precisar disso.
    if (row.source === "olist") {
      const { error: triggerError } = await supabase.rpc("oraculo_trigger_fiscal_recompute");
      if (triggerError) {
        console.error("oraculo_trigger_fiscal_recompute falhou após saveSkuParam", triggerError);
      }
    }
  }

  revalidatePath("/parametros");
  revalidatePath("/skus");
  revalidatePath("/");
  revalidatePath("/inteligencia");
}

async function disableSkuCostOverride(formData: FormData) {
  "use server";
  await assertTabAccess("parametros");

  const source = String(formData.get("source") ?? "olist").trim().toLowerCase();
  const sku = String(formData.get("sku") ?? "").trim();
  if (!source || !sku) return;

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("oraculo_margin_sku_params")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("source", source)
    .eq("sku", sku);
  if (error) throw error;

  if (source === "olist") {
    const { error: triggerError } = await supabase.rpc("oraculo_trigger_fiscal_recompute");
    if (triggerError) console.error("recompute fiscal falhou ao desativar custo", triggerError);
  }

  revalidatePath("/parametros");
  revalidatePath("/skus");
  revalidatePath("/");
  revalidatePath("/inteligencia");
}

async function saveStateTaxParam(formData: FormData) {
  "use server";
  await assertTabAccess("parametros");

  const icmsRate = parseRate(formData.get("icms_rate")) ?? 0;
  const interstateIcmsRate = parseRate(formData.get("interstate_icms_rate")) ?? 0;
  // FCP desativado em 04/08/2026 (não se aplica ao portfólio): a coluna existe,
  // mas fica zerada, fora do cálculo e fora da tela.
  const fcpRate = 0;
  const difalRate = Math.max(icmsRate - interstateIcmsRate, 0);
  // ICMS de saída é opcional: em branco = o motor usa a matriz Jacartta
  // (MG 6%/14%, demais UFs 1,3%). Zero explícito é um valor válido e diferente.
  const outboundRaw = String(formData.get("outbound_icms_rate") ?? "").trim();
  const outboundIcmsRate = outboundRaw === "" ? null : parseRate(outboundRaw) ?? null;

  const row = {
    uf: String(formData.get("uf") ?? "").trim().toUpperCase(),
    operation_type: String(formData.get("operation_type") || "venda_consumidor").trim() || "venda_consumidor",
    applies_to_source: String(formData.get("applies_to_source") || "*").trim().toLowerCase() || "*",
    merchandise_origin: String(formData.get("merchandise_origin") || "*").trim().toLowerCase() || "*",
    icms_rate: icmsRate,
    interstate_icms_rate: interstateIcmsRate,
    fcp_rate: fcpRate,
    outbound_icms_rate: outboundIcmsRate,
    difal_rate: difalRate,
    effective_tax_rate: interstateIcmsRate + difalRate + fcpRate,
    params_configured: parseBoolean(formData.get("params_configured"), false),
    valid_from: parseDateValue(formData.get("valid_from")) ?? new Date().toISOString().slice(0, 10),
    valid_to: parseDateValue(formData.get("valid_to")),
    notes: String(formData.get("notes") || "").trim() || null,
    updated_at: new Date().toISOString()
  };

  if (/^[A-Z]{2}$/.test(row.uf)) {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("oraculo_state_tax_params")
      .upsert(row, { onConflict: "uf,operation_type,applies_to_source,merchandise_origin,valid_from" });

    if (error) throw error;
  }

  revalidatePath("/parametros");
  revalidatePath("/skus");
}

async function loadParametros() {
  const supabase = await createSupabaseUserClient();
  const admin = createSupabaseAdminClient();

  const [channelsResponse, skuResponse, stateTaxResponse, marginResponse, costGap] = await Promise.all([
    supabase
      .from("oraculo_margin_channel_params")
      .select("*")
      .order("source", { ascending: true })
      .order("channel_key", { ascending: true }),
    supabase
      .from("oraculo_margin_sku_params")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(80),
    supabase
      .from("oraculo_state_tax_params")
      .select("*")
      .order("uf", { ascending: true })
      .order("merchandise_origin", { ascending: true })
      .order("applies_to_source", { ascending: true })
      .order("valid_from", { ascending: false }),
    supabase
      .from("oraculo_sku_margin_30d")
      .select("source, unit_cost, margin_signal")
      .limit(5000),
    // Snapshot horária (cron oraculo-fiscal-margin-snapshots-hourly), nunca ao
    // vivo: oraculo_fiscal_cost_gap varre o mês inteiro e estoura o timeout
    // de 8s do papel authenticated no caminho da página.
    loadFiscalCostGapSnapshot(admin)
  ]);

  if (channelsResponse.error) throw channelsResponse.error;
  if (skuResponse.error) throw skuResponse.error;
  if (stateTaxResponse.error) throw stateTaxResponse.error;
  if (marginResponse.error) throw marginResponse.error;

  const probes = (marginResponse.data ?? []) as MarginProbe[];
  const withCost = probes.filter((row) => n(row.unit_cost) > 0).length;
  const bySource = probes.reduce<Record<string, number>>((acc, row) => {
    const key = row.source ?? "outros";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const skuParams = (skuResponse.data ?? []) as SkuParam[];

  // O snapshot de custos pendentes só atualiza de verdade em até 1 minuto
  // (oraculo_trigger_fiscal_recompute). Enquanto isso, filtra na hora
  // qualquer SKU/componente que já ganhou override ativo — para o SKU
  // sumir da tela assim que o formulário é salvo, sem esperar o job rodar.
  const activeOlistOverrides = new Set(
    skuParams
      .filter((row) => row.source === "olist" && row.active && n(row.unit_cost_override) > 0)
      .map((row) => row.sku)
  );
  const pendingCostGap = costGap.filter((row) => {
    if (activeOlistOverrides.has(row.sku)) return false;
    if (row.componentesFaltando) {
      const missing = row.componentesFaltando.split(",").map((s) => s.trim()).filter(Boolean);
      if (missing.length > 0 && missing.every((sku) => activeOlistOverrides.has(sku))) return false;
    }
    return true;
  });

  return {
    channels: (channelsResponse.data ?? []) as ChannelParam[],
    skuParams,
    stateTaxes: (stateTaxResponse.data ?? []) as StateTaxParam[],
    costGap: pendingCostGap,
    summary: {
      total: probes.length,
      withCost,
      missingCost: probes.length - withCost,
      bySource
    }
  };
}

function normalizedSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function costSourceLabel(source: string | null) {
  if (!source) return "Sem custo resolvido";
  if (source.startsWith("override:")) return `Correção manual · ${source.slice(9)}`;
  if (source === "olist_products") return "Cadastro Olist";
  if (source === "effective_cost") return "Kit calculado pelos componentes";
  return source;
}

function costStatusLabel(status: CostAuditStatus) {
  switch (status) {
    case "sem-custo": return "Sem custo";
    case "revisar": return "Revisar divergência";
    case "override": return "Correção manual";
    case "kit": return "Kit calculado";
    default: return "Conferido pelo ERP";
  }
}

function costStatusClass(status: CostAuditStatus) {
  if (status === "ok") return "signal-good";
  if (status === "override" || status === "kit") return "signal-info";
  return "signal-warning";
}

async function loadCostAudit(query: string, statusFilter: string) {
  const admin = createSupabaseAdminClient();
  const [products, costs, overrides] = await Promise.all([
    fetchAllRows<ProductCostSourceRow>((from, to) => admin
      .from("olist_products")
      .select("sku,nome,tipo,active,preco_custo,preco_custo_medio")
      .not("sku", "is", null)
      .order("sku")
      .range(from, to)),
    fetchAllRows<CanonicalCostRow>((from, to) => admin
      .from("oraculo_sku_unit_cost")
      .select("sku,unit_cost,unit_cost_gross,cost_source")
      .order("sku")
      .range(from, to)),
    fetchAllRows<SkuParam>((from, to) => admin
      .from("oraculo_margin_sku_params")
      .select("source,sku,unit_cost_override,target_margin_rate_override,minimum_margin_rate_override,active,notes,updated_at")
      .order("updated_at", { ascending: false })
      .range(from, to))
  ]);

  const catalog = new Map<string, {
    name: string | null;
    type: string | null;
    active: boolean;
    erpCost: number | null;
    erpAverageCost: number | null;
  }>();

  for (const product of products) {
    const sku = product.sku?.trim();
    if (!sku) continue;
    const current = catalog.get(sku);
    const productWins = !current || (Boolean(product.active) && !current.active);
    catalog.set(sku, {
      name: productWins ? product.nome : current?.name ?? product.nome,
      type: current?.type === "K" || product.tipo === "K" ? "K" : productWins ? product.tipo : current?.type ?? product.tipo,
      active: Boolean(product.active) || Boolean(current?.active),
      erpCost: Math.max(n(current?.erpCost), n(product.preco_custo)) || null,
      erpAverageCost: Math.max(n(current?.erpAverageCost), n(product.preco_custo_medio)) || null
    });
  }

  const canonical = new Map(costs.map((row) => [row.sku.trim(), row]));
  const overrideIndex = new Map(
    overrides
      .filter((row) => row.active && n(row.unit_cost_override) > 0)
      .map((row) => [`${row.source}|${row.sku.trim()}`, row])
  );

  const rows: CostAuditRow[] = [...catalog.entries()].map(([sku, product]) => {
    const resolved = canonical.get(sku);
    const overrideSource = resolved?.cost_source?.startsWith("override:")
      ? resolved.cost_source.slice(9)
      : null;
    const override = overrideSource ? overrideIndex.get(`${overrideSource}|${sku}`) : null;
    const erpCost = product.erpCost;
    const erpAverageCost = product.erpAverageCost;
    const erpDivergence = erpCost && erpAverageCost
      ? Math.abs(erpCost - erpAverageCost) / Math.max(erpCost, erpAverageCost)
      : 0;
    let status: CostAuditStatus = "ok";
    if (!resolved || n(resolved.unit_cost_gross) <= 0) status = "sem-custo";
    else if (overrideSource) status = "override";
    else if (resolved.cost_source === "effective_cost" || product.type === "K") status = "kit";
    else if (erpDivergence >= 0.2) status = "revisar";

    return {
      sku,
      name: product.name,
      type: product.type,
      erpCost,
      erpAverageCost,
      grossCost: resolved?.unit_cost_gross ?? null,
      netCost: resolved?.unit_cost ?? null,
      costSource: resolved?.cost_source ?? null,
      status,
      overrideSource,
      overrideUpdatedAt: override?.updated_at ?? null,
      overrideNotes: override?.notes ?? null
    };
  });

  const summary = {
    total: rows.length,
    resolved: rows.filter((row) => row.grossCost !== null && row.grossCost > 0).length,
    missing: rows.filter((row) => row.status === "sem-custo").length,
    manual: rows.filter((row) => row.status === "override").length,
    review: rows.filter((row) => row.status === "revisar").length
  };

  const terms = normalizedSearch(query).split(/\s+/).filter(Boolean);
  const matchesSearch = (row: CostAuditRow) => {
    if (terms.length === 0) return true;
    const haystack = normalizedSearch(`${row.sku} ${row.name ?? ""}`);
    return terms.every((term) => haystack.includes(term));
  };
  const matchesStatus = (row: CostAuditRow) => {
    if (statusFilter === "atencao") return row.status === "sem-custo" || row.status === "revisar";
    if (["sem-custo", "override", "kit", "ok", "revisar"].includes(statusFilter)) return row.status === statusFilter;
    return true;
  };
  const statusOrder: Record<CostAuditStatus, number> = {
    "sem-custo": 0,
    revisar: 1,
    override: 2,
    kit: 3,
    ok: 4
  };
  const filtered = rows
    .filter(matchesSearch)
    .filter(matchesStatus)
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.sku.localeCompare(b.sku, "pt-BR"));

  return {
    rows: filtered.slice(0, 250),
    matched: filtered.length,
    capped: filtered.length > 250,
    summary
  };
}

function ParametrosTabs({ active }: { active: "geral" | "custos" }) {
  return (
    <nav className="pill-row parameters-tabs" aria-label="Seções de Parâmetros">
      <Link href="/parametros" className={active === "geral" ? "pill pill-gold" : "pill"}>
        Configurações gerais
      </Link>
      <Link href="/parametros?secao=custos" className={active === "custos" ? "pill pill-gold" : "pill"}>
        Conferência de custos
      </Link>
    </nav>
  );
}

export default async function ParametrosPage({
  searchParams
}: {
  searchParams?: Promise<{ secao?: string; q?: string; situacao?: string }>;
}) {
  const params = await searchParams;
  const section = params?.secao === "custos" ? "custos" : "geral";
  const [{ allowed }, alertCount] = await Promise.all([
    requireTabAccess("parametros"),
    loadActionableAlertCount()
  ]);
  if (!allowed) return <NoAccess tab="parametros" />;

  if (section === "custos") {
    const query = String(params?.q ?? "").trim();
    const statusFilter = String(params?.situacao ?? "todos");
    const audit = await loadCostAudit(query, statusFilter);

    return (
      <AppShell alertCount={alertCount}>
        <header className="topbar">
          <div>
            <h1>Parâmetros</h1>
            <p>Conferência do custo que alimenta margem, lucro e recomendações</p>
          </div>
          <div className="filter-row">
            <Link className="button-link" href="/inteligencia">Ver Inteligência</Link>
          </div>
        </header>

        <ParametrosTabs active="custos" />

        <section className="panel cost-audit-intro">
          <div>
            <p className="eyebrow">Livro canônico</p>
            <h2>Conferência de custos por produto</h2>
          </div>
          <p>
            Esta é a mesma fonte usada agora pela Inteligência de Mercado. A prioridade é
            <strong> correção manual → cadastro Olist → kit calculado pelos componentes</strong>.
            O custo bruto é o valor de aquisição; o líquido já desconta os créditos recuperáveis
            e é o custo canônico das análises fiscais.
          </p>
        </section>

        <section className="metric-grid metric-grid-eight cost-audit-metrics">
          <article className="metric accent-blue">
            <span className="label">Produtos</span>
            <strong>{count(audit.summary.total)}</strong>
            <small>SKUs únicos do catálogo</small>
          </article>
          <article className="metric accent-yellow">
            <span className="label">Com custo</span>
            <strong>{count(audit.summary.resolved)}</strong>
            <small>resolvidos no livro canônico</small>
          </article>
          <article className="metric accent-red">
            <span className="label">Sem custo</span>
            <strong>{count(audit.summary.missing)}</strong>
            <small>precisam de correção</small>
          </article>
          <article className="metric accent-white">
            <span className="label">Correções manuais</span>
            <strong>{count(audit.summary.manual)}</strong>
            <small>vencem o valor do ERP</small>
          </article>
          <article className="metric accent-white">
            <span className="label">Divergências</span>
            <strong>{count(audit.summary.review)}</strong>
            <small>cadastrado × médio ≥ 20%</small>
          </article>
        </section>

        <section className="panel product-panel">
          <div className="sku-toolbar cost-audit-toolbar">
            <div>
              <p className="eyebrow">Double-check</p>
              <h2>Valores usados nos cálculos</h2>
            </div>
            <form method="get" className="filter-row cost-audit-filter">
              <input type="hidden" name="secao" value="custos" />
              <label>
                <span className="sr-only">Buscar por SKU ou produto</span>
                <input name="q" defaultValue={query} placeholder="Buscar SKU ou produto" />
              </label>
              <label>
                <span className="sr-only">Filtrar por situação</span>
                <select name="situacao" defaultValue={statusFilter}>
                  <option value="todos">Todas as situações</option>
                  <option value="atencao">Somente atenção</option>
                  <option value="sem-custo">Sem custo</option>
                  <option value="revisar">Com divergência</option>
                  <option value="override">Correção manual</option>
                  <option value="kit">Kits calculados</option>
                  <option value="ok">Conferidos pelo ERP</option>
                </select>
              </label>
              <button type="submit">Filtrar</button>
              {(query || statusFilter !== "todos") && (
                <Link className="button-link" href="/parametros?secao=custos">Limpar</Link>
              )}
            </form>
          </div>

          <p className="table-note">
            {audit.matched === 1 ? "1 produto encontrado" : `${count(audit.matched)} produtos encontrados`}{audit.capped ? "; exibindo os primeiros 250 — refine a busca para localizar outro SKU" : ""}.
            Valores em amarelo pedem conferência. Salvar uma correção cria um override bruto e
            atualiza imediatamente a fonte usada pela Inteligência; os snapshots fiscais acompanham em até 1 minuto.
          </p>

          <div className="table-wrap dense-table-wrap">
            <table className="data-table dense-table cost-audit-table">
              <thead>
                <tr>
                  <th>SKU / Produto</th>
                  <th>Tipo</th>
                  <th className="numeric">Custo cadastrado</th>
                  <th className="numeric">Custo médio</th>
                  <th className="numeric">Bruto usado</th>
                  <th className="numeric">Líquido usado</th>
                  <th>Origem</th>
                  <th>Situação</th>
                  <th>Corrigir</th>
                </tr>
              </thead>
              <tbody>
                {audit.rows.map((row) => (
                  <tr key={row.sku} className={row.status === "sem-custo" || row.status === "revisar" ? "cost-row-warning" : undefined}>
                    <td>
                      <strong>{row.sku}</strong>
                      <small>{row.name ?? "Produto sem nome no catálogo"}</small>
                    </td>
                    <td>{row.type === "K" ? "Kit" : "Unitário"}</td>
                    <td className="numeric">{row.erpCost == null ? "—" : money(row.erpCost)}</td>
                    <td className="numeric">{row.erpAverageCost == null ? "—" : money(row.erpAverageCost)}</td>
                    <td className="numeric cost-used"><strong>{row.grossCost == null ? "—" : money(row.grossCost)}</strong></td>
                    <td className="numeric cost-used">{row.netCost == null ? "—" : money(row.netCost)}</td>
                    <td>
                      <strong>{costSourceLabel(row.costSource)}</strong>
                      {row.overrideUpdatedAt && <small>Atualizado {date(row.overrideUpdatedAt)}</small>}
                      {row.overrideNotes && <small>{row.overrideNotes}</small>}
                    </td>
                    <td>
                      <span className={`status-pill ${costStatusClass(row.status)}`}>
                        {costStatusLabel(row.status)}
                      </span>
                    </td>
                    <td>
                      <div className="cost-correction-actions">
                        <form action={saveSkuParam} className="inline-cost-form cost-audit-correction">
                          <input type="hidden" name="source" value={row.overrideSource ?? "olist"} />
                          <input type="hidden" name="sku" value={row.sku} />
                          <input type="hidden" name="active" value="true" />
                          <input
                            name="unit_cost_override"
                            inputMode="decimal"
                            placeholder={row.grossCost == null ? "custo bruto" : String(row.grossCost).replace(".", ",")}
                            aria-label={`Novo custo bruto do SKU ${row.sku}`}
                            required
                          />
                          <button type="submit">Salvar</button>
                        </form>
                        {row.overrideSource && (
                          <form action={disableSkuCostOverride}>
                            <input type="hidden" name="source" value={row.overrideSource} />
                            <input type="hidden" name="sku" value={row.sku} />
                            <button type="submit" className="button-quiet">Usar ERP</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </AppShell>
    );
  }

  const data = await loadParametros();

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Parâmetros</h1>
          <p>Dados manuais que não vêm da Olist ou APIs dos marketplaces</p>
        </div>
        <div className="filter-row">
          <Link className="button-link" href="/skus">Ver SKUs</Link>
        </div>
      </header>

      <ParametrosTabs active="geral" />

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-blue">
          <span className="label">SKUs analisados</span>
          <strong>{count(data.summary.total)}</strong>
          <small>amostra da view de margem</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Com custo</span>
          <strong>{count(data.summary.withCost)}</strong>
          <small>custo Olist ou override</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Sem custo</span>
          <strong>{count(data.summary.missingCost)}</strong>
          <small>precisam de ajuste manual</small>
        </article>
        <article className="metric accent-white">
          <span className="label">Fontes</span>
          <strong>{Object.keys(data.summary.bySource).length}</strong>
          <small>{Object.entries(data.summary.bySource).map(([key, value]) => `${key}: ${count(value)}`).join(" · ")}</small>
        </article>
      </section>

      <section className="settings-grid">
        <article className="panel settings-panel">
          <div className="section-head">
            <p className="eyebrow">Canal</p>
            <h2>Taxas, impostos e metas</h2>
          </div>

          <form action={saveChannelParam} className="upload-form manual-form">
            <label>
              <span>Fonte</span>
              <select name="source" required defaultValue="olist">
                <option value="olist">Olist</option>
                <option value="shopee">Shopee</option>
              </select>
            </label>
            <label>
              <span>Canal</span>
              <input name="channel_key" defaultValue="*" />
            </label>
            <label>
              <span>Nome</span>
              <input name="display_name" placeholder="Shopee Donacor" />
            </label>
            <label>
              <span>Imposto</span>
              <input name="tax_rate" inputMode="decimal" placeholder="8%" />
            </label>
            <label>
              <span>Comissão marketplace</span>
              <input name="marketplace_fee_rate" inputMode="decimal" placeholder="18%" />
            </label>
            <label>
              <span>Taxa pagamento</span>
              <input name="payment_fee_rate" inputMode="decimal" placeholder="2%" />
            </label>
            <label>
              <span>Frete subsidiado/item</span>
              <input name="freight_subsidy_per_unit" inputMode="decimal" placeholder="0,00" />
            </label>
            <label>
              <span>Embalagem/item</span>
              <input name="packaging_cost_per_unit" inputMode="decimal" placeholder="1,20" />
            </label>
            <label>
              <span>Margem meta</span>
              <input name="target_margin_rate" inputMode="decimal" placeholder="30%" />
            </label>
            <label>
              <span>Margem mínima</span>
              <input name="minimum_margin_rate" inputMode="decimal" placeholder="15%" />
            </label>
            <label>
              <span>Status</span>
              <select name="params_configured" defaultValue="true">
                <option value="true">Configurado</option>
                <option value="false">Pendente</option>
              </select>
            </label>
            <label className="form-wide">
              <span>Observação</span>
              <input name="notes" placeholder="validado pelo financeiro" />
            </label>
            <button type="submit">Salvar canal</button>
          </form>
        </article>

        <article className="panel settings-panel">
          <div className="section-head">
            <p className="eyebrow">Fiscal</p>
            <h2>Imposto por UF</h2>
          </div>

          <p className="table-note">
            Estas alíquotas <strong>alimentam a margem fiscal</strong> do dashboard e de
            /skus — mas só as linhas marcadas como <strong>Validado</strong> e vigentes na
            data da NF. Linha pendente = o motor usa a regra padrão. <strong>ICMS de saída</strong>
            {" "}em branco também cai na regra padrão (matriz Jacartta: MG 6% nacional / 14%
            importado, demais UFs 1,3%). <strong>ICMS interno destino</strong> e{" "}
            <strong>interestadual</strong> alimentam só o DIFAL.
          </p>

          <form action={saveStateTaxParam} className="upload-form manual-form">
            <label>
              <span>UF</span>
              <select name="uf" required defaultValue="SP">
                {[
                  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
                  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
                ].map((uf) => (
                  <option key={uf} value={uf}>{uf}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Fonte</span>
              <select name="applies_to_source" defaultValue="*">
                <option value="*">Todas</option>
                <option value="olist">Olist</option>
                <option value="shopee">Shopee</option>
              </select>
            </label>
            <label>
              <span>Origem da mercadoria</span>
              <select name="merchandise_origin" defaultValue="nacional">
                <option value="nacional">Nacional</option>
                <option value="importado">Importado</option>
                <option value="*">Ambas</option>
              </select>
            </label>
            <label>
              <span>Operação</span>
              <input name="operation_type" defaultValue="venda_consumidor" />
            </label>
            <label>
              <span>ICMS de saída</span>
              <input name="outbound_icms_rate" inputMode="decimal" placeholder="6% (vazio = matriz)" />
            </label>
            <label>
              <span>ICMS interno destino</span>
              <input name="icms_rate" inputMode="decimal" placeholder="18%" />
            </label>
            <label>
              <span>ICMS interestadual</span>
              <input name="interstate_icms_rate" inputMode="decimal" placeholder="12%" />
            </label>
            <label>
              <span>Vigência início</span>
              <input name="valid_from" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
            <label>
              <span>Vigência fim</span>
              <input name="valid_to" type="date" />
            </label>
            <label>
              <span>Status</span>
              <select name="params_configured" defaultValue="false">
                <option value="false">Pendente</option>
                <option value="true">Validado</option>
              </select>
            </label>
            <label className="form-wide">
              <span>Observação</span>
              <input name="notes" placeholder="regra validada com contador/fiscal" />
            </label>
            <button type="submit">Salvar UF</button>
          </form>
        </article>

        <article className="panel settings-panel">
          <div className="section-head">
            <p className="eyebrow">SKU</p>
            <h2>Custo e exceções</h2>
          </div>

          <form action={saveSkuParam} className="upload-form manual-form">
            <label>
              <span>Fonte</span>
              <select name="source" required defaultValue="shopee">
                <option value="olist">Olist</option>
                <option value="shopee">Shopee</option>
              </select>
            </label>
            <label>
              <span>SKU</span>
              <input name="sku" required placeholder="CABIDE VELUDO-50UN-PRETO" />
            </label>
            <label>
              <span>Custo unitário bruto</span>
              <input name="unit_cost_override" inputMode="decimal" placeholder="22,50" title="Informe o custo de aquisição BRUTO (o que foi pago). O sistema desconta sozinho o crédito recuperável: −9,25% nacional, −11,75% importado." />
            </label>
            <label>
              <span>Margem meta</span>
              <input name="target_margin_rate_override" inputMode="decimal" placeholder="30%" />
            </label>
            <label>
              <span>Margem mínima</span>
              <input name="minimum_margin_rate_override" inputMode="decimal" placeholder="15%" />
            </label>
            <label>
              <span>Status</span>
              <select name="active" defaultValue="true">
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </select>
            </label>
            <label className="form-wide">
              <span>Observação</span>
              <input name="notes" placeholder="custo informado pelo financeiro" />
            </label>
            <button type="submit">Salvar SKU</button>
          </form>
        </article>
      </section>

      <section className="panel product-panel">
        <div className="sku-toolbar">
          <div>
            <p className="eyebrow">Fiscal</p>
            <h2>Regras por UF</h2>
          </div>
          <div className="sku-actions">
            <strong>{count(data.stateTaxes.length)} linhas</strong>
            <span>UF</span>
            <span>Vigência</span>
          </div>
        </div>

        <div className="table-wrap dense-table-wrap">
          <table className="data-table dense-table">
            <thead>
              <tr>
                <th>UF</th>
                <th>Origem</th>
                <th>Fonte</th>
                <th className="numeric">ICMS saída</th>
                <th className="numeric">ICMS interno</th>
                <th className="numeric">ICMS interest.</th>
                <th className="numeric">DIFAL</th>
                <th className="numeric">Efetiva</th>
                <th>Vigência</th>
                <th>Status</th>
                <th>Obs.</th>
              </tr>
            </thead>
            <tbody>
              {data.stateTaxes.map((row) => (
                <tr key={`${row.uf}-${row.operation_type}-${row.applies_to_source}-${row.merchandise_origin}-${row.valid_from}`}>
                  <td>{row.uf}</td>
                  <td>{row.merchandise_origin === "*" ? "Ambas" : row.merchandise_origin}</td>
                  <td>{row.applies_to_source === "*" ? "Todas" : row.applies_to_source}</td>
                  <td className="numeric">
                    {row.outbound_icms_rate == null ? "matriz" : percent(row.outbound_icms_rate)}
                  </td>
                  <td className="numeric">{percent(row.icms_rate)}</td>
                  <td className="numeric">{percent(row.interstate_icms_rate)}</td>
                  <td className="numeric">{percent(row.difal_rate)}</td>
                  <td className="numeric">{percent(row.effective_tax_rate)}</td>
                  <td>{row.valid_from ?? "-"} até {row.valid_to ?? "atual"}</td>
                  <td>
                    <span className={`status-pill ${row.params_configured ? "signal-good" : "signal-muted"}`}>
                      {row.params_configured ? "Validado" : "Pendente"}
                    </span>
                  </td>
                  <td>{row.notes ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel product-panel">
        <div className="sku-toolbar">
          <div>
            <p className="eyebrow">Canais</p>
            <h2>Parâmetros atuais</h2>
          </div>
          <div className="sku-actions">
            <strong>{count(data.channels.length)} linhas</strong>
            <span>Canal</span>
            <span>Margem</span>
          </div>
        </div>

        <div className="table-wrap dense-table-wrap">
          <table className="data-table dense-table">
            <thead>
              <tr>
                <th>Fonte</th>
                <th>Canal</th>
                <th>Nome</th>
                <th className="numeric">Imposto</th>
                <th className="numeric">Comissão</th>
                <th className="numeric">Pagamento</th>
                <th className="numeric">Frete/item</th>
                <th className="numeric">Embalagem</th>
                <th className="numeric">Meta</th>
                <th className="numeric">Mín.</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.channels.map((row) => (
                <tr key={`${row.source}-${row.channel_key}`}>
                  <td>{row.source}</td>
                  <td>{row.channel_key}</td>
                  <td>{row.display_name ?? "-"}</td>
                  <td className="numeric">{percent(row.tax_rate)}</td>
                  <td className="numeric">{percent(row.marketplace_fee_rate)}</td>
                  <td className="numeric">{percent(row.payment_fee_rate)}</td>
                  <td className="numeric">{money(row.freight_subsidy_per_unit)}</td>
                  <td className="numeric">{money(row.packaging_cost_per_unit)}</td>
                  <td className="numeric">{percent(row.target_margin_rate)}</td>
                  <td className="numeric">{percent(row.minimum_margin_rate)}</td>
                  <td>
                    <span className={`status-pill ${row.params_configured ? "signal-good" : "signal-muted"}`}>
                      {row.params_configured ? "Configurado" : "Pendente"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel product-panel">
        <div className="sku-toolbar">
          <div>
            <p className="eyebrow">Cobertura fiscal</p>
            <h2>Custos pendentes</h2>
          </div>
          <div className="sku-actions">
            <strong>{count(data.costGap.length)} SKUs</strong>
            <span>mês corrente</span>
          </div>
        </div>

        <p className="table-note">
          Estes SKUs são exatamente os que ficam de fora da <strong>Cobertura</strong> do
          card &ldquo;Lucro fiscal&rdquo; — sem custo confiável, a margem não entra no
          cálculo. Ordenados pela receita que cada um está deixando fora. Preencha o custo
          unitário bruto (o que foi pago) e salve — o sistema desconta sozinho o crédito
          recuperável. O SKU sai desta lista assim que a página recarrega; a Cobertura e o
          Lucro fiscal (aqui e na Home) recalculam sozinhos em até 1 minuto.
        </p>

        {data.costGap.length === 0 ? (
          <p className="table-note">Nenhum SKU sem custo confiável no período — cobertura no teto possível.</p>
        ) : (
          <div className="table-wrap dense-table-wrap">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Nome</th>
                  <th>Motivo</th>
                  <th className="numeric">Receita afetada</th>
                  <th className="numeric">Linhas</th>
                  <th>Corrigir custo</th>
                </tr>
              </thead>
              <tbody>
                {data.costGap.map((row) => (
                  <tr key={row.sku}>
                    <td>{row.sku}</td>
                    <td>{row.nome ?? "-"}</td>
                    <td>
                      <span className="status-pill signal-warning">{row.motivo}</span>
                      {row.componentesFaltando && (
                        <div className="table-note" style={{ marginTop: "0.35rem" }}>
                          componente sem custo: {row.componentesFaltando}
                        </div>
                      )}
                    </td>
                    <td className="numeric">{money(row.receitaAfetada)}</td>
                    <td className="numeric">{count(row.linhas)}</td>
                    <td>
                      <form action={saveSkuParam} className="inline-cost-form">
                        <input type="hidden" name="source" value="olist" />
                        <input
                          type="hidden"
                          name="sku"
                          value={row.componentesFaltando ? row.componentesFaltando.split(",")[0].trim() : row.sku}
                        />
                        <input type="hidden" name="active" value="true" />
                        <input
                          name="unit_cost_override"
                          inputMode="decimal"
                          placeholder="custo bruto"
                          required
                        />
                        <button type="submit">Salvar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel product-panel">
        <div className="sku-toolbar">
          <div>
            <p className="eyebrow">Exceções</p>
            <h2>Overrides por SKU</h2>
          </div>
          <div className="sku-actions">
            <strong>{count(data.skuParams.length)} recentes</strong>
            <span>Custo</span>
            <span>Meta</span>
          </div>
        </div>

        <div className="table-wrap dense-table-wrap">
          <table className="data-table dense-table">
            <thead>
              <tr>
                <th>Fonte</th>
                <th>SKU</th>
                <th className="numeric">Custo override</th>
                <th className="numeric">Meta</th>
                <th className="numeric">Mín.</th>
                <th>Status</th>
                <th>Atualizado</th>
                <th>Obs.</th>
              </tr>
            </thead>
            <tbody>
              {data.skuParams.map((row) => (
                <tr key={`${row.source}-${row.sku}`}>
                  <td>{row.source}</td>
                  <td>{row.sku}</td>
                  <td className="numeric">{row.unit_cost_override == null ? "-" : money(row.unit_cost_override)}</td>
                  <td className="numeric">{percent(row.target_margin_rate_override)}</td>
                  <td className="numeric">{percent(row.minimum_margin_rate_override)}</td>
                  <td>{row.active ? "Ativo" : "Inativo"}</td>
                  <td>{date(row.updated_at)}</td>
                  <td>{row.notes ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
