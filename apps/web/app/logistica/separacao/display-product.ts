const KIT_WARNING = "KIT SEM COMPOSIÇÃO NO OLIST";

export function displaySeparationProduct(item: { product: string; description: string }) {
  const product = item.product || item.description || "Produto sem descrição";
  return item.description.includes(KIT_WARNING) && !product.includes(KIT_WARNING)
    ? `${product} · ${KIT_WARNING}`
    : product;
}
