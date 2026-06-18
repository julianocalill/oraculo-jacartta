export type SalesChannel =
  | "olist"
  | "mercado_livre"
  | "shopee"
  | "magalu";

export type ProductAsset = {
  id: string;
  sku: string;
  channel: SalesChannel;
  name: string;
  status: "active" | "inactive";
};
