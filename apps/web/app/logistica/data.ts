import { createSupabaseUserClient } from "../../lib/supabase/user";

export type PaleteItem = {
  position: number;
  variation_label: string;
  quantity: number;
};

export type Palete = {
  id: string;
  code: string;
  product_sku: string | null;
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

const quantityFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/**
 * A linha que sai impressa: `Pote de Vidro 640ml - 10 unid.`
 *
 * Não repete o produto quando a variação já o contém — sem isso, digitar a
 * variação completa produziria "Pote de Vidro Pote de Vidro 640ml".
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
 * Palete + itens pelo código do QR. `null` quando o código não existe.
 *
 * As colunas `sku`/`olist_product_id` da tabela de itens não são lidas: a
 * etiqueta deixou de ter vínculo com o cadastro da Olist (2026-08-13) e o texto
 * é digitado livre. Elas continuam no schema só para não descartar os paletes
 * gerados antes da mudança.
 */
export async function loadPaleteByCode(code: string): Promise<Palete | null> {
  const supabase = await createSupabaseUserClient();

  const { data: palete, error } = await supabase
    .from("logistica_paletes")
    .select("id, code, product_sku, product_label, invoice_number, boxes_per_pallet, label_count, created_at")
    .eq("code", code)
    .maybeSingle();

  if (error) throw error;
  if (!palete) return null;

  const { data: itens, error: itensError } = await supabase
    .from("logistica_palete_itens")
    .select("position, variation_label, quantity")
    .eq("palete_id", palete.id)
    .order("position", { ascending: true });

  if (itensError) throw itensError;

  return {
    id: String(palete.id),
    code: String(palete.code),
    product_sku: palete.product_sku ? String(palete.product_sku) : null,
    product_label: String(palete.product_label),
    invoice_number: palete.invoice_number ? String(palete.invoice_number) : null,
    boxes_per_pallet: palete.boxes_per_pallet == null ? null : Number(palete.boxes_per_pallet),
    label_count: Number(palete.label_count ?? 1),
    created_at: String(palete.created_at),
    itens: (itens ?? []).map((item) => ({
      position: Number(item.position),
      variation_label: String(item.variation_label),
      quantity: Number(item.quantity)
    }))
  };
}
