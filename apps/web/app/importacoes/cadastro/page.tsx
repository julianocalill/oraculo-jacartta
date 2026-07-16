import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { requireCurrentUser } from "../../../lib/auth/session";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { AppShell } from "../../components/app-shell";
import { ImportacoesTabs } from "../tabs";
import { loadImportacoes } from "../data";

export const dynamic = "force-dynamic";

function parseNumber(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateValue(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function identifier(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return normalized.length > 0 ? normalized : null;
}

async function saveFatura(formData: FormData) {
  "use server";

  const invoiceNumber = text(formData.get("invoice_number"));
  if (!invoiceNumber) return;

  const row = {
    invoice_number: invoiceNumber,
    process_name: text(formData.get("process_name")),
    production_start: parseDateValue(formData.get("production_start")),
    production_end: parseDateValue(formData.get("production_end")),
    bl: identifier(formData.get("bl")),
    container_number: identifier(formData.get("container_number")),
    vessel_name: text(formData.get("vessel_name"))?.toUpperCase() ?? null,
    destination: text(formData.get("destination")),
    port_arrival: parseDateValue(formData.get("port_arrival")),
    transit_agent: text(formData.get("transit_agent")),
    packing_list_yuan: parseNumber(formData.get("packing_list_yuan")),
    packing_list_usd: parseNumber(formData.get("packing_list_usd")),
    packing_list_brl: parseNumber(formData.get("packing_list_brl")),
    taxes_brl: parseNumber(formData.get("taxes_brl")),
    total_cash_brl: parseNumber(formData.get("total_cash_brl")),
    transfer_invoice: text(formData.get("transfer_invoice")),
    origin: "manual",
    updated_at: new Date().toISOString()
  };

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("importacao_faturas")
    .upsert(row, { onConflict: "invoice_number" });
  if (error) throw error;

  revalidatePath("/importacoes");
  revalidatePath("/importacoes/cadastro");
}

async function saveItem(formData: FormData) {
  "use server";

  const invoiceNumber = text(formData.get("invoice_number"));
  const description = text(formData.get("description"));
  if (!invoiceNumber || !description) return;

  const row = {
    invoice_number: invoiceNumber,
    description: description.toUpperCase(),
    quantity: parseNumber(formData.get("quantity")),
    unit_cost_yuan: parseNumber(formData.get("unit_cost_yuan")),
    unit_cost_with_tax_brl: parseNumber(formData.get("unit_cost_with_tax_brl")),
    cartons: parseNumber(formData.get("cartons")),
    quantity_per_carton: parseNumber(formData.get("quantity_per_carton")),
    cbm: parseNumber(formData.get("cbm")),
    cbm_total: parseNumber(formData.get("cbm_total"))
  };

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("importacao_itens").insert(row);
  if (error) throw error;

  revalidatePath("/importacoes");
  revalidatePath("/importacoes/cadastro");
}

async function deleteItem(formData: FormData) {
  "use server";

  const id = parseNumber(formData.get("id"));
  if (id == null) return;

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("importacao_itens").delete().eq("id", id);
  if (error) throw error;

  revalidatePath("/importacoes");
  revalidatePath("/importacoes/cadastro");
}

async function saveNavio(formData: FormData) {
  "use server";

  const name = text(formData.get("name"))?.toUpperCase();
  if (!name) return;

  const aliases = String(formData.get("aliases") ?? "")
    .split(",")
    .map((alias) => alias.trim().toUpperCase())
    .filter((alias) => alias.length > 0);

  const row = {
    name,
    aliases,
    imo: identifier(formData.get("imo")),
    mmsi: identifier(formData.get("mmsi")),
    updated_at: new Date().toISOString()
  };

  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("importacao_navios").upsert(row, { onConflict: "name" });
  if (error) throw error;

  revalidatePath("/importacoes");
  revalidatePath("/importacoes/cadastro");
}

function count(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export default async function ImportacoesCadastroPage() {
  await requireCurrentUser();
  const alertCount = await loadActionableAlertCount();
  const { faturas, itens, navios } = await loadImportacoes();

  const itensByInvoice = new Map<string, typeof itens>();
  for (const item of itens) {
    const list = itensByInvoice.get(item.invoice_number) ?? [];
    list.push(item);
    itensByInvoice.set(item.invoice_number, list);
  }

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Importações · Cadastro</h1>
          <p>Registre novas faturas, itens e navios sem depender da planilha</p>
        </div>
      </header>

      <ImportacoesTabs active="cadastro" />

      <section className="settings-grid">
        <article className="panel settings-panel">
          <div className="section-head">
            <p className="eyebrow">Fatura</p>
            <h2>Nova fatura / embarque</h2>
          </div>

          <form action={saveFatura} className="upload-form manual-form">
            <label>
              <span>Fatura *</span>
              <input name="invoice_number" required placeholder="0500HB185-1-A" />
            </label>
            <label>
              <span>Processo</span>
              <input name="process_name" placeholder="JACARTTA" />
            </label>
            <label>
              <span>Início produção</span>
              <input name="production_start" type="date" />
            </label>
            <label>
              <span>Fim produção</span>
              <input name="production_end" type="date" />
            </label>
            <label>
              <span>BL</span>
              <input name="bl" placeholder="XGGNVT775091" />
            </label>
            <label>
              <span>Contêiner</span>
              <input name="container_number" placeholder="TCKU6086851" />
            </label>
            <label>
              <span>Navio</span>
              <input name="vessel_name" placeholder="EVERGREEN - EVER LEADING" list="navios-conhecidos" />
            </label>
            <label>
              <span>Destino</span>
              <input name="destination" placeholder="NAVEGANTES" />
            </label>
            <label>
              <span>Chegada no porto</span>
              <input name="port_arrival" type="date" />
            </label>
            <label>
              <span>Agente de trânsito</span>
              <input name="transit_agent" />
            </label>
            <label>
              <span>Packing list ¥</span>
              <input name="packing_list_yuan" inputMode="decimal" />
            </label>
            <label>
              <span>Packing list US$</span>
              <input name="packing_list_usd" inputMode="decimal" />
            </label>
            <label>
              <span>Packing list R$</span>
              <input name="packing_list_brl" inputMode="decimal" />
            </label>
            <label>
              <span>Impostos R$</span>
              <input name="taxes_brl" inputMode="decimal" />
            </label>
            <label>
              <span>Total caixa R$</span>
              <input name="total_cash_brl" inputMode="decimal" />
            </label>
            <label>
              <span>Nota de transferência</span>
              <input name="transfer_invoice" />
            </label>
            <button type="submit">Salvar fatura</button>
          </form>

          <datalist id="navios-conhecidos">
            {navios.map((navio) => (
              <option key={navio.name} value={navio.name} />
            ))}
          </datalist>
        </article>

        <article className="panel settings-panel">
          <div className="section-head">
            <p className="eyebrow">Item</p>
            <h2>Adicionar item a uma fatura</h2>
          </div>

          <form action={saveItem} className="upload-form manual-form">
            <label>
              <span>Fatura *</span>
              <select name="invoice_number" required>
                {faturas.map((fatura) => (
                  <option key={fatura.invoice_number} value={fatura.invoice_number}>
                    {fatura.invoice_number}
                    {fatura.vessel_name ? ` · ${fatura.vessel_name}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Descrição *</span>
              <input name="description" required placeholder="POTE DE VIDRO C/ TAMPA DE BAMBU - 200ML" />
            </label>
            <label>
              <span>Quantidade</span>
              <input name="quantity" inputMode="numeric" />
            </label>
            <label>
              <span>Custo unit. ¥</span>
              <input name="unit_cost_yuan" inputMode="decimal" />
            </label>
            <label>
              <span>Custo unit. c/ imposto R$</span>
              <input name="unit_cost_with_tax_brl" inputMode="decimal" />
            </label>
            <label>
              <span>Caixas</span>
              <input name="cartons" inputMode="numeric" />
            </label>
            <label>
              <span>Qtd. por caixa</span>
              <input name="quantity_per_carton" inputMode="numeric" />
            </label>
            <label>
              <span>CBM</span>
              <input name="cbm" inputMode="decimal" />
            </label>
            <label>
              <span>CBM total</span>
              <input name="cbm_total" inputMode="decimal" />
            </label>
            <button type="submit">Adicionar item</button>
          </form>
        </article>

        <article className="panel settings-panel">
          <div className="section-head">
            <p className="eyebrow">Navio</p>
            <h2>Registrar navio (IMO/MMSI)</h2>
          </div>
          <p className="empty-state">
            O MMSI liga o navio à posição AIS no mapa. Use os aliases para casar o nome
            escrito no follow-up (ex.: &quot;EVERGREEN - EVER LEADING&quot;) com o nome oficial.
          </p>

          <form action={saveNavio} className="upload-form manual-form">
            <label>
              <span>Nome oficial *</span>
              <input name="name" required placeholder="EVER LEADING" />
            </label>
            <label>
              <span>Aliases (separados por vírgula)</span>
              <input name="aliases" placeholder="EVERGREEN - EVER LEADING" />
            </label>
            <label>
              <span>IMO</span>
              <input name="imo" inputMode="numeric" placeholder="9595462" />
            </label>
            <label>
              <span>MMSI</span>
              <input name="mmsi" inputMode="numeric" placeholder="235093619" />
            </label>
            <button type="submit">Salvar navio</button>
          </form>
        </article>
      </section>

      <section className="panel">
        <div className="section-head">
          <p className="eyebrow">Conferência</p>
          <h2>Faturas e itens cadastrados ({count(faturas.length)})</h2>
        </div>

        {faturas.length === 0 ? (
          <p className="empty-state">Nenhuma fatura cadastrada ainda.</p>
        ) : (
          <div className="table-wrap dense-table-wrap">
            <table className="data-table dense-table">
              <thead>
                <tr>
                  <th>Fatura</th>
                  <th>Navio</th>
                  <th>Origem</th>
                  <th>Item</th>
                  <th className="numeric">Qtd.</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {faturas.flatMap((fatura) => {
                  const list = itensByInvoice.get(fatura.invoice_number) ?? [];
                  if (list.length === 0) {
                    return (
                      <tr key={fatura.invoice_number}>
                        <td>{fatura.invoice_number}</td>
                        <td>{fatura.vessel_name ?? "-"}</td>
                        <td>{fatura.origin}</td>
                        <td colSpan={3} className="row-subtitle">sem itens</td>
                      </tr>
                    );
                  }
                  return list.map((item, index) => (
                    <tr key={`${fatura.invoice_number}-${item.id}`}>
                      <td>{index === 0 ? fatura.invoice_number : ""}</td>
                      <td>{index === 0 ? fatura.vessel_name ?? "-" : ""}</td>
                      <td>{index === 0 ? fatura.origin : ""}</td>
                      <td>{item.description}</td>
                      <td className="numeric">
                        {item.quantity != null ? count(item.quantity) : "-"}
                      </td>
                      <td>
                        <form action={deleteItem}>
                          <input type="hidden" name="id" value={item.id} />
                          <button type="submit" className="link-button">remover</button>
                        </form>
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
