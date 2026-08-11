import { createSupabaseUserClient } from "../../lib/supabase/user";

export type ProdutoOption = {
  id: string;
  sku: string;
  nome: string;
};

export type PaleteItem = {
  position: number;
  olist_product_id: string | null;
  sku: string | null;
  variation_label: string;
  quantity: number;
};

export type Palete = {
  id: string;
  code: string;
  product_label: string;
  invoice_number: string | null;
  boxes_per_pallet: number | null;
  label_count: number;
  created_at: string;
  itens: PaleteItem[];
};

/** Quantas variações cabem no formulário (e na etiqueta). */
export const MAX_VARIACOES = 4;

// Alfabeto sem 0/O/1/I/L: o código fica impresso embaixo do QR justamente para
// alguém digitar quando o leitor não pegar, e é aí que a confusão acontece.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;

/**
 * Código público do palete — é o que viaja dentro do QR e vira a URL.
 * 31^12 ≈ 7,9e17 combinações: não dá para enumerar nem colidir na prática.
 */
export function generatePaleteCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

/** Minúsculas, sem acento e sem espaço duplicado — só para comparar textos. */
function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rótulo da variação a partir do SKU escolhido, quando o operador não digitou um.
 *
 * Usa o SKU e não o `nome` de propósito: na Olist o nome é o título do anúncio
 * ("Kit 10 Potes de Vidro 370ml Hermético Marmita Fit com Tampa 4 Travas - 10
 * Potes - Azul"), que não cabe numa etiqueta. O SKU é o apelido curto que o
 * estoque já usa ("Kit pote 10 un 370ml azul").
 *
 * A derivação é um chute educado — por isso o campo na tela é editável.
 */
export function deriveVariationLabel(productLabel: string, sku: string) {
  const cleanSku = sku.trim().replace(/\s+/g, " ");
  const product = normalize(productLabel);
  if (!product) return cleanSku;

  const normalizedSku = normalize(cleanSku);
  if (!normalizedSku.startsWith(product)) return cleanSku;

  // Corta o prefixo pelo tamanho normalizado e limpa o separador que sobrou.
  const rest = cleanSku.slice(product.length).replace(/^[\s\-–—:,.]+/, "").trim();
  return rest.length > 0 ? rest : cleanSku;
}

const quantityFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/**
 * A linha que sai impressa: `Pote de Vidro 640ml - 10 unid.`
 *
 * Não repete o produto quando a variação já o contém — sem isso, escolher um
 * SKU cujo texto já é completo produziria "Pote de Vidro Pote de Vidro 640ml".
 */
export function formatLabelLine(productLabel: string, variationLabel: string, quantity: number) {
  const product = productLabel.trim().replace(/\s+/g, " ");
  const variation = variationLabel.trim().replace(/\s+/g, " ");

  let description: string;
  if (!variation) {
    description = product;
  } else if (!product || normalize(variation).startsWith(normalize(product))) {
    description = variation;
  } else {
    description = `${product} ${variation}`;
  }

  return `${description} - ${quantityFormatter.format(quantity)} unid.`;
}

/**
 * Produtos ativos da Olist para o datalist do formulário.
 *
 * Kits não são filtrados: aqui o produto é o que vai fisicamente no palete, e
 * um kit é um item expedível como qualquer outro (o filtro `tipo <> 'K'` que
 * existe nas views de custo serve para não contar custo duas vezes, o que não
 * se aplica a etiqueta). Hoje são ~300 produtos ativos — cabe no HTML sem
 * paginação, e o limite existe só como guarda contra o cadastro crescer.
 */
export async function loadProdutoOptions(): Promise<ProdutoOption[]> {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase
    .from("olist_products")
    .select("id, sku, nome")
    .eq("active", true)
    .not("sku", "is", null)
    .order("sku", { ascending: true })
    .limit(900);

  if (error) throw error;

  return (data ?? [])
    .filter((row) => String(row.sku ?? "").trim().length > 0)
    .map((row) => ({
      id: String(row.id),
      sku: String(row.sku),
      nome: String(row.nome ?? "")
    }));
}

/** Palete + itens pelo código do QR. `null` quando o código não existe. */
export async function loadPaleteByCode(code: string): Promise<Palete | null> {
  const supabase = await createSupabaseUserClient();

  const { data: palete, error } = await supabase
    .from("logistica_paletes")
    .select("id, code, product_label, invoice_number, boxes_per_pallet, label_count, created_at")
    .eq("code", code)
    .maybeSingle();

  if (error) throw error;
  if (!palete) return null;

  const { data: itens, error: itensError } = await supabase
    .from("logistica_palete_itens")
    .select("position, olist_product_id, sku, variation_label, quantity")
    .eq("palete_id", palete.id)
    .order("position", { ascending: true });

  if (itensError) throw itensError;

  return {
    id: String(palete.id),
    code: String(palete.code),
    product_label: String(palete.product_label),
    invoice_number: palete.invoice_number ? String(palete.invoice_number) : null,
    boxes_per_pallet: palete.boxes_per_pallet == null ? null : Number(palete.boxes_per_pallet),
    label_count: Number(palete.label_count ?? 1),
    created_at: String(palete.created_at),
    itens: (itens ?? []).map((item) => ({
      position: Number(item.position),
      olist_product_id: item.olist_product_id ? String(item.olist_product_id) : null,
      sku: item.sku ? String(item.sku) : null,
      variation_label: String(item.variation_label),
      quantity: Number(item.quantity)
    }))
  };
}
