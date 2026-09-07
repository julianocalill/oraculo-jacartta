import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { assertTabAccess, requireTabAccess } from "../../../lib/auth/access";
import { effectiveUserId } from "../../../lib/users";
import { NoAccess } from "../../components/no-access";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { AppShell } from "../../components/app-shell";
import { LogisticaTabs } from "../tabs";
import { MAX_VARIACOES, generatePaleteCode } from "../data";

export const dynamic = "force-dynamic";

const POSITIONS = Array.from({ length: MAX_VARIACOES }, (_, index) => index + 1);

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function parseNumber(value: unknown) {
  if (value == null || String(value).trim() === "") return null;
  const normalized = String(value).trim().replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: unknown) {
  const parsed = parseNumber(value);
  if (parsed == null) return null;
  return Number.isInteger(parsed) ? parsed : Math.round(parsed);
}

// Sem toast no projeto: o erro volta na querystring e a página o exibe.
function fail(message: string): never {
  redirect(`/logistica/etiqueta?erro=${encodeURIComponent(message)}`);
}

async function gerarEtiqueta(formData: FormData) {
  "use server";
  // Gate obrigatório: um POST direto na action não passa pela página.
  const user = await assertTabAccess("logistica");

  const productLabel = text(formData.get("product_label"));
  if (!productLabel) fail("Informe o produto.");

  const productSku = text(formData.get("product_sku"));
  if (!productSku) fail("Informe o SKU.");

  const labelCount = parseInteger(formData.get("label_count")) ?? 1;
  if (labelCount < 1 || labelCount > 100) fail("A quantidade de etiquetas deve ficar entre 1 e 100.");

  const boxesPerPallet = parseInteger(formData.get("boxes_per_pallet"));
  if (boxesPerPallet != null && boxesPerPallet < 1) fail("Caixas por palete deve ser maior que zero.");

  const unitQuantity = parseNumber(formData.get("unit_quantity"));
  if (unitQuantity != null && unitQuantity <= 0) fail("Qtd Unidade deve ser maior que zero.");

  const itens: { position: number; variation_label: string; quantity: number }[] = [];

  for (const position of POSITIONS) {
    const label = text(formData.get(`variacao_${position}`));
    const quantity = parseNumber(formData.get(`quantidade_${position}`));

    // Linha totalmente vazia é normal — o formulário sempre mostra as 4.
    if (!label && quantity == null) continue;

    if (!label) fail(`Informe a variação ${position}.`);
    if (quantity == null || quantity <= 0) fail(`Informe a quantidade da variação ${position}.`);

    itens.push({ position, variation_label: label, quantity });
  }

  if (itens.length === 0) fail("Informe ao menos uma variação com quantidade.");

  const supabase = createSupabaseAdminClient();

  const code = generatePaleteCode();
  const { data: palete, error } = await supabase
    .from("logistica_paletes")
    .insert({
      code,
      product_sku: productSku,
      product_label: productLabel,
      invoice_number: text(formData.get("invoice_number")),
      boxes_per_pallet: boxesPerPallet,
      unit_quantity: unitQuantity,
      label_count: labelCount,
      created_by: effectiveUserId(user)
    })
    .select("id")
    .single();
  if (error) throw error;

  const { error: itensError } = await supabase.from("logistica_palete_itens").insert(
    itens.map((item) => ({
      palete_id: palete.id,
      position: item.position,
      variation_label: item.variation_label,
      quantity: item.quantity
    }))
  );
  if (itensError) throw itensError;

  redirect(`/logistica/etiqueta/imprimir?code=${code}`);
}

export default async function EtiquetaPage({
  searchParams
}: {
  searchParams?: Promise<{ erro?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const [{ allowed }, alertCount] = await Promise.all([
    requireTabAccess("logistica"),
    loadActionableAlertCount()
  ]);
  if (!allowed) return <NoAccess tab="logistica" />;

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Logística · Etiqueta</h1>
          <p>Gere a etiqueta do palete em A4 horizontal com QR Code rastreável</p>
        </div>
      </header>

      <LogisticaTabs active="etiqueta" />

      {params.erro ? (
        <p className="etiqueta-erro" role="alert">
          {params.erro}
        </p>
      ) : null}

      <section className="panel settings-panel">
        <div className="section-head">
          <p className="eyebrow">Palete</p>
          <h2>Dados da etiqueta</h2>
        </div>

        <form action={gerarEtiqueta} className="upload-form manual-form etiqueta-form">
          <label>
            <span>Produto *</span>
            <input name="product_label" required placeholder="Pote de Vidro" autoComplete="off" />
            <small>Nome que abre a etiqueta e prefixa cada linha.</small>
          </label>

          <label>
            <span>SKU *</span>
            <input name="product_sku" required placeholder="214013" autoComplete="off" />
            <small>Código que aparece à esquerda do produto na impressão.</small>
          </label>

          <fieldset className="etiqueta-variacoes">
            <legend>Variações</legend>
            <p className="etiqueta-hint">
              Escreva a variação como ela deve sair impressa — <b>640ml</b>, <b>1L</b>, <b>Azul</b>.
              A linha final fica <b>Pote de Vidro 640ml - 10 unid.</b>
            </p>

            <div className="etiqueta-variacao-head">
              <span>Variação</span>
              <span>Quantidade</span>
            </div>

            {POSITIONS.map((position) => (
              <div className="etiqueta-variacao-row" key={position}>
                <input
                  name={`variacao_${position}`}
                  placeholder={position === 1 ? "640ml" : ""}
                  autoComplete="off"
                  aria-label={`Variação ${position}`}
                />
                <input
                  name={`quantidade_${position}`}
                  inputMode="numeric"
                  placeholder={position === 1 ? "10" : ""}
                  aria-label={`Quantidade da variação ${position}`}
                />
              </div>
            ))}
          </fieldset>

          <label>
            <span>Número da NF</span>
            <input name="invoice_number" placeholder="12345" autoComplete="off" />
          </label>
          <label>
            <span>Quantidade de etiquetas</span>
            <input name="label_count" inputMode="numeric" defaultValue={1} />
          </label>
          <label>
            <span>Caixas por palete</span>
            <input name="boxes_per_pallet" inputMode="numeric" placeholder="24" />
          </label>
          <label>
            <span>Qtd Unidade</span>
            <input name="unit_quantity" inputMode="decimal" placeholder="100" />
          </label>

          <button type="submit">Gerar Etiqueta</button>
        </form>
      </section>
    </AppShell>
  );
}
