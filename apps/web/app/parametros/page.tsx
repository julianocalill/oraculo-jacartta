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

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  const separator = line.includes(";") ? ";" : ",";

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      quoted = !quoted;
      continue;
    }

    if (char === separator && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function parseCsv(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
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

async function formText(formData: FormData) {
  const pasted = String(formData.get("csv") ?? "").trim();
  if (pasted) return pasted;

  const file = formData.get("file");
  if (file && typeof file === "object" && "text" in file) {
    return String(await file.text()).trim();
  }

  return "";
}

async function importChannelParams(formData: FormData) {
  "use server";

  const text = await formText(formData);
  const rows = parseCsv(text)
    .map((row) => ({
      source: String(row.source ?? "").trim().toLowerCase(),
      channel_key: String(row.channel_key || "*").trim() || "*",
      display_name: String(row.display_name || "").trim() || null,
      tax_rate: parseRate(row.tax_rate) ?? 0,
      marketplace_fee_rate: parseRate(row.marketplace_fee_rate) ?? 0,
      payment_fee_rate: parseRate(row.payment_fee_rate) ?? 0,
      freight_subsidy_per_unit: parseNumber(row.freight_subsidy_per_unit) ?? 0,
      packaging_cost_per_unit: parseNumber(row.packaging_cost_per_unit) ?? 0,
      target_margin_rate: parseRate(row.target_margin_rate) ?? 0.25,
      minimum_margin_rate: parseRate(row.minimum_margin_rate) ?? 0.12,
      params_configured: parseBoolean(row.params_configured, true),
      notes: String(row.notes || "").trim() || null,
      updated_at: new Date().toISOString()
    }))
    .filter((row) => row.source);

  if (rows.length > 0) {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("oraculo_margin_channel_params")
      .upsert(rows, { onConflict: "source,channel_key" });

    if (error) throw error;
  }

  revalidatePath("/parametros");
  revalidatePath("/skus");
}

async function importSkuParams(formData: FormData) {
  "use server";

  const text = await formText(formData);
  const rows = parseCsv(text)
    .map((row) => ({
      source: String(row.source ?? "").trim().toLowerCase(),
      sku: String(row.sku ?? "").trim(),
      unit_cost_override: parseNumber(row.unit_cost_override),
      target_margin_rate_override: parseRate(row.target_margin_rate_override),
      minimum_margin_rate_override: parseRate(row.minimum_margin_rate_override),
      active: parseBoolean(row.active, true),
      notes: String(row.notes || "").trim() || null,
      updated_at: new Date().toISOString()
    }))
    .filter((row) => row.source && row.sku);

  if (rows.length > 0) {
    const supabase = createSupabaseAdminClient();
    const { error } = await supabase
      .from("oraculo_margin_sku_params")
      .upsert(rows, { onConflict: "source,sku" });

    if (error) throw error;
  }

  revalidatePath("/parametros");
  revalidatePath("/skus");
}

async function loadParametros() {
  const supabase = createSupabaseAdminClient();

  const [channelsResponse, skuResponse, marginResponse] = await Promise.all([
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
      .from("oraculo_sku_margin_30d")
      .select("source, unit_cost, margin_signal")
      .limit(5000)
  ]);

  if (channelsResponse.error) throw channelsResponse.error;
  if (skuResponse.error) throw skuResponse.error;
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

          <form action={importChannelParams} className="upload-form">
            <input type="file" name="file" accept=".csv,text/csv" />
            <textarea
              name="csv"
              rows={8}
              placeholder={`source,channel_key,display_name,tax_rate,marketplace_fee_rate,payment_fee_rate,freight_subsidy_per_unit,packaging_cost_per_unit,target_margin_rate,minimum_margin_rate,params_configured,notes
olist,*,Olist padrão,8%,12%,2%,0,1.20,30%,15%,true,validado pelo financeiro
shopee,*,Shopee Donacor,8%,18%,2%,0,1.20,30%,15%,true,validado pelo financeiro`}
            />
            <button type="submit">Importar parâmetros de canal</button>
          </form>
        </article>

        <article className="panel settings-panel">
          <div className="section-head">
            <p className="eyebrow">SKU</p>
            <h2>Custo e exceções</h2>
          </div>

          <form action={importSkuParams} className="upload-form">
            <input type="file" name="file" accept=".csv,text/csv" />
            <textarea
              name="csv"
              rows={8}
              placeholder={`source,sku,unit_cost_override,target_margin_rate_override,minimum_margin_rate_override,active,notes
shopee,CABIDE VELUDO-50UN-PRETO,22.50,30%,15%,true,custo informado pelo financeiro
olist,213986,14.43,30%,15%,true,custo conferido`}
            />
            <button type="submit">Importar parâmetros de SKU</button>
          </form>
        </article>
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
