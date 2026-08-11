import { redirect } from "next/navigation";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { assertTabAccess, requireTabAccess } from "../../../lib/auth/access";
import { effectiveUserId } from "../../../lib/users";
import { NoAccess } from "../../components/no-access";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { AppShell } from "../../components/app-shell";
import { LogisticaTabs } from "../tabs";
import {
  MAX_VARIACOES,
  deriveVariationLabel,
  generatePaleteCode,
  loadProdutoOptions,
  type ProdutoOption
} from "../data";

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

  const labelCount = parseInteger(formData.get("label_count")) ?? 1;
  if (labelCount < 1 || labelCount > 100) fail("A quantidade de etiquetas deve ficar entre 1 e 100.");

  const boxesPerPallet = parseInteger(formData.get("boxes_per_pallet"));
  if (boxesPerPallet != null && boxesPerPallet < 1) fail("Caixas por palete deve ser maior que zero.");

  const itens: {
    position: number;
    sku: string | null;
    variation_label: string;
    quantity: number;
  }[] = [];

  for (const position of POSITIONS) {
    const sku = text(formData.get(`sku_${position}`));
    const label = text(formData.get(`variacao_${position}`));
    const quantity = parseNumber(formData.get(`quantidade_${position}`));

    // Linha totalmente vazia é normal — o formulário sempre mostra as 4.
    if (!sku && !label && quantity == null) continue;

    if (quantity == null || quantity <= 0) {
      fail(`Informe a quantidade da variação ${position}.`);
    }
    if (!sku && !label) {
      fail(`Informe o produto ou o rótulo da variação ${position}.`);
    }

    itens.push({
      position,
      sku,
      variation_label: label ?? deriveVariationLabel(productLabel, sku ?? ""),
      quantity
    });
  }

  if (itens.length === 0) fail("Informe ao menos uma variação com quantidade.");

  const supabase = createSupabaseAdminClient();

  // Resolve o id da Olist a partir do SKU digitado. Não achar não é erro: o
  // campo aceita texto livre para o caso de um item que ainda não está no ERP.
  const skus = itens.map((item) => item.sku).filter((sku): sku is string => Boolean(sku));
  const produtoIdBySku = new Map<string, string>();
  if (skus.length > 0) {
    const { data, error } = await supabase.from("olist_products").select("id, sku").in("sku", skus);
    if (error) throw error;
    for (const row of data ?? []) {
      produtoIdBySku.set(String(row.sku), String(row.id));
    }
  }

  const code = generatePaleteCode();
  const { data: palete, error } = await supabase
    .from("logistica_paletes")
    .insert({
      code,
      product_label: productLabel,
      invoice_number: text(formData.get("invoice_number")),
      boxes_per_pallet: boxesPerPallet,
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
      olist_product_id: item.sku ? produtoIdBySku.get(item.sku) ?? null : null,
      sku: item.sku,
      variation_label: item.variation_label,
      quantity: item.quantity
    }))
  );
  if (itensError) throw itensError;

  redirect(`/logistica/etiqueta/imprimir?code=${code}`);
}

function ProdutoDatalist({ produtos }: { produtos: ProdutoOption[] }) {
  return (
    <datalist id="olist-produtos">
      {produtos.map((produto) => (
        // value = SKU (curto, é o apelido que o estoque usa); o rótulo mostra o
        // título do anúncio truncado só para desambiguar SKUs parecidos.
        <option key={produto.id} value={produto.sku}>
          {produto.nome.length > 70 ? `${produto.nome.slice(0, 70)}…` : produto.nome}
        </option>
      ))}
    </datalist>
  );
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

  const produtos = await loadProdutoOptions();

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Logística · Etiqueta</h1>
          <p>Gere a etiqueta 100×150 mm do palete com QR Code rastreável</p>
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
            <input
              name="product_label"
              required
              list="olist-produtos"
              placeholder="Pote de Vidro"
              autoComplete="off"
            />
            <small>Nome que abre a etiqueta. Pode escolher um SKU da Olist ou digitar livre.</small>
          </label>

          <fieldset className="etiqueta-variacoes">
            <legend>Variações</legend>
            <p className="etiqueta-hint">
              Cada variação é um produto da Olist. O rótulo é o que sai impresso — deixe em branco
              para usar o SKU, ou escreva algo curto como <b>640ml</b>. A linha final fica{" "}
              <b>Pote de Vidro 640ml - 10 unid.</b>
            </p>

            <div className="etiqueta-variacao-head">
              <span>Produto / SKU da Olist</span>
              <span>Rótulo na etiqueta</span>
              <span>Quantidade</span>
            </div>

            {POSITIONS.map((position) => (
              <div className="etiqueta-variacao-row" key={position}>
                <input
                  name={`sku_${position}`}
                  list="olist-produtos"
                  placeholder={position === 1 ? "Busque pelo SKU" : ""}
                  autoComplete="off"
                  aria-label={`Produto da variação ${position}`}
                />
                <input
                  name={`variacao_${position}`}
                  placeholder={position === 1 ? "640ml" : ""}
                  autoComplete="off"
                  aria-label={`Rótulo da variação ${position}`}
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

          <button type="submit">Gerar Etiqueta</button>
        </form>

        <ProdutoDatalist produtos={produtos} />
      </section>
    </AppShell>
  );
}
