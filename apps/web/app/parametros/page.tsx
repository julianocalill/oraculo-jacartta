import Link from "next/link";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";

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

async function saveChannelParam(formData: FormData) {
  "use server";

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
  }

  revalidatePath("/parametros");
  revalidatePath("/skus");
}

async function saveStateTaxParam(formData: FormData) {
  "use server";

  const icmsRate = parseRate(formData.get("icms_rate")) ?? 0;
  const interstateIcmsRate = parseRate(formData.get("interstate_icms_rate")) ?? 0;
  const fcpRate = parseRate(formData.get("fcp_rate")) ?? 0;
  const difalRate = Math.max(icmsRate - interstateIcmsRate, 0);

  const row = {
    uf: String(formData.get("uf") ?? "").trim().toUpperCase(),
    operation_type: String(formData.get("operation_type") || "venda_consumidor").trim() || "venda_consumidor",
    applies_to_source: String(formData.get("applies_to_source") || "*").trim().toLowerCase() || "*",
    icms_rate: icmsRate,
    interstate_icms_rate: interstateIcmsRate,
    fcp_rate: fcpRate,
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
      .upsert(row, { onConflict: "uf,operation_type,applies_to_source,valid_from" });

    if (error) throw error;
  }

  revalidatePath("/parametros");
  revalidatePath("/skus");
}

async function loadParametros() {
  const supabase = createSupabaseAdminClient();

  const [channelsResponse, skuResponse, stateTaxResponse, marginResponse] = await Promise.all([
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
      .order("applies_to_source", { ascending: true })
      .order("valid_from", { ascending: false }),
    supabase
      .from("oraculo_sku_margin_30d")
      .select("source, unit_cost, margin_signal")
      .limit(5000)
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

  return {
    channels: (channelsResponse.data ?? []) as ChannelParam[],
    skuParams: (skuResponse.data ?? []) as SkuParam[],
    stateTaxes: (stateTaxResponse.data ?? []) as StateTaxParam[],
    summary: {
      total: probes.length,
      withCost,
      missingCost: probes.length - withCost,
      bySource
    }
  };
}

export default async function ParametrosPage() {
  const data = await loadParametros();

  return (
    <main className="workspace single-workspace">
      <header className="topbar">
        <div>
          <Link href="/" className="back-link">← Analytics</Link>
          <h1>Parâmetros</h1>
          <p>Dados manuais que não vêm da Olist ou APIs dos marketplaces</p>
        </div>
        <div className="filter-row">
          <Link className="button-link" href="/skus">Ver SKUs</Link>
        </div>
      </header>

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
              <span>Operação</span>
              <input name="operation_type" defaultValue="venda_consumidor" />
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
              <span>FCP</span>
              <input name="fcp_rate" inputMode="decimal" placeholder="2%" />
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
              <span>Custo unitário</span>
              <input name="unit_cost_override" inputMode="decimal" placeholder="22,50" />
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
                <th>Fonte</th>
                <th>Operação</th>
                <th className="numeric">ICMS interno</th>
                <th className="numeric">ICMS interest.</th>
                <th className="numeric">FCP</th>
                <th className="numeric">DIFAL</th>
                <th className="numeric">Efetiva</th>
                <th>Vigência</th>
                <th>Status</th>
                <th>Obs.</th>
              </tr>
            </thead>
            <tbody>
              {data.stateTaxes.map((row) => (
                <tr key={`${row.uf}-${row.operation_type}-${row.applies_to_source}-${row.valid_from}`}>
                  <td>{row.uf}</td>
                  <td>{row.applies_to_source === "*" ? "Todas" : row.applies_to_source}</td>
                  <td>{row.operation_type}</td>
                  <td className="numeric">{percent(row.icms_rate)}</td>
                  <td className="numeric">{percent(row.interstate_icms_rate)}</td>
                  <td className="numeric">{percent(row.fcp_rate)}</td>
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
    </main>
  );
}
