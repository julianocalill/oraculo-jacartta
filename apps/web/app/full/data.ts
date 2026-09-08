import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { createSupabaseUserClient } from "../../lib/supabase/user";

export type FullChannel = "shopee" | "mercadolivre" | "amazon";
export type FullWorkflowStatus =
  | "rascunho"
  | "aguardando_logistica"
  | "aguardando_criador"
  | "aguardando_agendamento"
  | "monitorando"
  | "concluido"
  | "cancelado"
  | "excecao";
export type FullProductionStatus = "nao_iniciada" | "em_producao" | "pronta" | "com_falta";
export type FullExternalStatus =
  | "nao_vinculado"
  | "agendado"
  | "coletado"
  | "em_transito"
  | "recebendo"
  | "recebido"
  | "recebido_com_divergencia"
  | "cancelado"
  | "desconhecido";

export type FullStoreConfig = {
  id: string;
  channel: FullChannel;
  store_key: string;
  store_name: string;
  default_logistics_user_id: string | null;
  catalog_enabled: boolean;
  collection_sync_validated: boolean;
  receipt_sync_validated: boolean;
  submission_enabled: boolean;
  validation_note: string | null;
};

export type FullListRow = {
  id: string;
  number: number;
  channel: FullChannel;
  store_name: string;
  creator_user_id: string;
  logistics_user_id: string;
  workflow_status: FullWorkflowStatus;
  production_status: FullProductionStatus;
  external_status: FullExternalStatus;
  current_revision: number;
  proposed_pickup_day: string | null;
  approved_pickup_day: string | null;
  scheduled_pickup_day: string | null;
  external_shipment_id: string | null;
  last_external_sync_at: string | null;
  last_external_error: string | null;
  created_at: string;
  updated_at: string;
};

export type FullRevisionItem = {
  id: string;
  channel_item_key: string;
  channel_item_id: string | null;
  channel_model_id: string | null;
  marketplace_sku: string | null;
  marketplace_title: string;
  marketplace_variation: string | null;
  selected_olist_product_id: string;
  selected_olist_sku: string;
  selected_olist_title: string;
  selected_olist_is_kit: boolean;
  requested_qty: number;
  position: number;
  components: Array<{
    id: string;
    olist_product_id: string | null;
    olist_sku: string;
    olist_title: string;
    units_per_marketplace: number;
    required_qty: number;
  }>;
};

export type FullDetail = FullListRow & {
  store_key: string;
  proposed_pickup_note: string | null;
  proposed_by: string | null;
  proposed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  shipping_mode: string | null;
  external_collected_at: string | null;
  external_received_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  participant_ids: string[];
  revision: { id: string; revision_no: number; reason: string | null; frozen_at: string | null };
  revision_history: Array<{ id: string; revision_no: number; reason: string | null; frozen_at: string | null; created_at: string; created_by: string }>;
  items: FullRevisionItem[];
  production_lines: Array<{
    id: string;
    olist_sku: string;
    olist_title: string;
    required_qty: number;
    active: boolean;
    ready_qty: number;
    shortage_qty: number;
    shortage_note: string | null;
    previous_required_qty: number;
    updated_by: string | null;
    updated_at: string;
  }>;
  attachments: Array<{
    id: string;
    file_name: string;
    mime_type: string;
    file_size: number;
    uploaded_by: string;
    created_at: string;
  }>;
  events: Array<{
    id: number;
    revision_no: number | null;
    event_type: string;
    actor_type: "usuario" | "sistema";
    actor_user_id: string | null;
    from_status: string | null;
    to_status: string | null;
    note: string | null;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
};

export type CommercialCatalogItem = {
  channel: FullChannel;
  storeKey: string;
  key: string;
  itemId: string;
  modelId: string | null;
  sku: string | null;
  title: string;
  variation: string | null;
  suggestedOlistProductId: string | null;
  mappingStatus: string | null;
};

export type PhysicalProductOption = {
  id: string;
  sku: string;
  title: string;
  type: string | null;
};

const FULL_LIST_COLUMNS =
  "id,number,channel,store_name,creator_user_id,logistics_user_id,workflow_status," +
  "production_status,external_status,current_revision,proposed_pickup_day,approved_pickup_day," +
  "scheduled_pickup_day,external_shipment_id,last_external_sync_at,last_external_error,created_at,updated_at";

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export async function loadFullStoreConfigs(): Promise<FullStoreConfig[]> {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase
    .from("oraculo_full_store_configs")
    .select("id,channel,store_key,store_name,default_logistics_user_id,catalog_enabled,collection_sync_validated,receipt_sync_validated,submission_enabled,validation_note")
    .order("channel")
    .order("store_name");
  if (error) throw error;
  return (data ?? []) as FullStoreConfig[];
}

export async function loadFulls(): Promise<FullListRow[]> {
  const supabase = await createSupabaseUserClient();
  const { data, error } = await supabase
    .from("oraculo_fulls")
    .select(FULL_LIST_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as unknown as FullListRow[];
}

export async function loadFullDetail(id: string): Promise<FullDetail | null> {
  const supabase = await createSupabaseUserClient();
  const { data: full, error } = await supabase
    .from("oraculo_fulls")
    .select(`${FULL_LIST_COLUMNS},store_key,proposed_pickup_note,proposed_by,proposed_at,approved_by,approved_at,shipping_mode,external_collected_at,external_received_at,cancelled_at,cancelled_by,cancellation_reason`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!full) return null;

  const [participants, revisions, production, attachments, events] = await Promise.all([
    supabase.from("oraculo_full_participants").select("user_id").eq("full_id", id),
    supabase.from("oraculo_full_revisions").select("id,revision_no,reason,frozen_at,created_at,created_by").eq("full_id", id).order("revision_no", { ascending: false }),
    supabase.from("oraculo_full_production_lines").select("id,olist_sku,olist_title,required_qty,active,ready_qty,shortage_qty,shortage_note,updated_by,updated_at").eq("full_id", id).order("active", { ascending: false }).order("olist_sku"),
    supabase.from("oraculo_full_attachments").select("id,file_name,mime_type,file_size,uploaded_by,created_at").eq("full_id", id).order("created_at"),
    supabase.from("oraculo_full_events").select("id,revision_no,event_type,actor_type,actor_user_id,from_status,to_status,note,payload,created_at").eq("full_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(200)
  ]);
  for (const result of [participants, revisions, production, attachments, events]) {
    if (result.error) throw result.error;
  }
  const currentRevision = (revisions.data ?? []).find((revision) => revision.revision_no === full.current_revision);
  if (!currentRevision) throw new Error("Revisão atual do Full não encontrada.");

  const { data: itemRows, error: itemError } = await supabase
    .from("oraculo_full_revision_items")
    .select("id,channel_item_key,channel_item_id,channel_model_id,marketplace_sku,marketplace_title,marketplace_variation,selected_olist_product_id,selected_olist_sku,selected_olist_title,selected_olist_is_kit,requested_qty,position")
    .eq("revision_id", currentRevision.id)
    .order("position");
  if (itemError) throw itemError;
  const { data: componentRows, error: componentError } = await supabase
    .from("oraculo_full_revision_components")
    .select("id,revision_item_id,olist_product_id,olist_sku,olist_title,units_per_marketplace,required_qty")
    .eq("revision_id", currentRevision.id);
  if (componentError) throw componentError;

  const previousRequired = new Map<string, number>();
  if (full.current_revision > 1) {
    const { data: previousRevision, error: previousRevisionError } = await supabase
      .from("oraculo_full_revisions")
      .select("id")
      .eq("full_id", id)
      .eq("revision_no", full.current_revision - 1)
      .maybeSingle();
    if (previousRevisionError) throw previousRevisionError;
    if (previousRevision) {
      const { data: previousComponents, error: previousComponentsError } = await supabase
        .from("oraculo_full_revision_components")
        .select("olist_sku,required_qty")
        .eq("revision_id", previousRevision.id);
      if (previousComponentsError) throw previousComponentsError;
      for (const component of previousComponents ?? []) {
        previousRequired.set(component.olist_sku, (previousRequired.get(component.olist_sku) ?? 0) + component.required_qty);
      }
    }
  }

  const componentsByItem = new Map<string, FullRevisionItem["components"]>();
  for (const component of componentRows ?? []) {
    const list = componentsByItem.get(component.revision_item_id) ?? [];
    list.push(component as FullRevisionItem["components"][number]);
    componentsByItem.set(component.revision_item_id, list);
  }

  return {
    ...(full as FullListRow & Omit<FullDetail, keyof FullListRow>),
    participant_ids: (participants.data ?? []).map((row) => row.user_id),
    revision: currentRevision,
    revision_history: revisions.data ?? [],
    items: (itemRows ?? []).map((item) => ({ ...item, components: componentsByItem.get(item.id) ?? [] })) as FullRevisionItem[],
    production_lines: (production.data ?? []).map((line) => ({
      ...line,
      previous_required_qty: previousRequired.get(line.olist_sku) ?? 0
    })),
    attachments: attachments.data ?? [],
    events: (events.data ?? []) as FullDetail["events"]
  };
}

export async function loadFullCreationCatalog(): Promise<{
  stores: FullStoreConfig[];
  commercialItems: CommercialCatalogItem[];
  physicalProducts: PhysicalProductOption[];
}> {
  const admin = createSupabaseAdminClient();
  const [storesRes, shopee, mlItems, mlVariations, amazonRes, products, mappings] = await Promise.all([
    admin.from("oraculo_full_store_configs").select("id,channel,store_key,store_name,default_logistics_user_id,catalog_enabled,collection_sync_validated,receipt_sync_validated,submission_enabled,validation_note").eq("catalog_enabled", true).order("store_name"),
    fetchAll<Record<string, unknown>>((from, to) => admin.from("shopee_products").select("shop_id,item_id,model_id,item_name,model_name,item_sku,model_sku,item_status,model_status").eq("item_status", "NORMAL").order("id").range(from, to)),
    fetchAll<Record<string, unknown>>((from, to) => admin.from("mercadolivre_items").select("seller_id,mlb_id,title,sku,status").neq("status", "closed").order("mlb_id").range(from, to)),
    fetchAll<Record<string, unknown>>((from, to) => admin.from("mercadolivre_variations").select("seller_id,mlb_id,variation_id,sku,attrs").order("mlb_id").range(from, to)),
    admin.rpc("oraculo_amazon_full_candidates"),
    fetchAll<Record<string, unknown>>((from, to) => admin.from("olist_products").select("id,sku,nome,tipo").eq("active", true).not("sku", "is", null).order("sku").range(from, to)),
    fetchAll<Record<string, unknown>>((from, to) => admin.from("oraculo_sku_channel_map_cache").select("channel,channel_key,sku_olist,match_status,pair_rank").eq("pair_rank", 1).order("channel_key").range(from, to))
  ]);
  if (storesRes.error) throw storesRes.error;
  if (amazonRes.error) throw amazonRes.error;

  const productBySku = new Map<string, string>();
  const physicalProducts = products
    .filter((row) => String(row.sku ?? "").trim())
    .map((row) => {
      const sku = String(row.sku).trim();
      if (!productBySku.has(sku.toLowerCase())) productBySku.set(sku.toLowerCase(), String(row.id));
      return { id: String(row.id), sku, title: String(row.nome || sku), type: row.tipo ? String(row.tipo) : null };
    });
  const mapped = new Map<string, { sku: string | null; status: string }>();
  for (const row of mappings) {
    mapped.set(`${row.channel}:${row.channel_key}`, {
      sku: row.sku_olist ? String(row.sku_olist) : null,
      status: String(row.match_status || "sem_casamento")
    });
  }
  const enrich = (channel: FullChannel, key: string) => {
    const match = mapped.get(`${channel}:${key}`);
    return {
      suggestedOlistProductId: match?.sku ? productBySku.get(match.sku.toLowerCase()) ?? null : null,
      mappingStatus: match?.status ?? null
    };
  };

  const commercialItems: CommercialCatalogItem[] = shopee.map((row) => {
    const sku = String(row.model_sku || row.item_sku || "").trim() || null;
    const itemId = String(row.item_id);
    const modelId = row.model_id ? String(row.model_id) : null;
    // Identidade do item nunca depende do SKU: sellers podem reutilizar o
    // mesmo texto em anúncios/variações diferentes. O de-para, por outro
    // lado, segue a chave histórica (SKU quando preenchido).
    const key = `${itemId}${modelId ? `/${modelId}` : ""}`;
    const mappingKey = sku || key;
    return {
      channel: "shopee" as const,
      storeKey: String(row.shop_id), key, itemId, modelId, sku,
      title: String(row.item_name || itemId),
      variation: row.model_name ? String(row.model_name) : null,
      ...enrich("shopee", mappingKey)
    };
  });

  const variationsByItem = new Map<string, Record<string, unknown>[]>();
  for (const variation of mlVariations) {
    const key = `${variation.seller_id}:${variation.mlb_id}`;
    const list = variationsByItem.get(key) ?? [];
    list.push(variation);
    variationsByItem.set(key, list);
  }
  for (const row of mlItems) {
    const variations = variationsByItem.get(`${row.seller_id}:${row.mlb_id}`) ?? [];
    if (variations.length === 0) {
      const key = String(row.mlb_id);
      commercialItems.push({
        channel: "mercadolivre", storeKey: String(row.seller_id), key,
        itemId: String(row.mlb_id), modelId: null,
        sku: row.sku ? String(row.sku) : null, title: String(row.title || row.mlb_id), variation: null,
        ...enrich("mercadolivre", key)
      });
    } else {
      for (const variation of variations) {
        const key = `${row.mlb_id}/${variation.variation_id}`;
        commercialItems.push({
          channel: "mercadolivre", storeKey: String(row.seller_id), key,
          itemId: String(row.mlb_id), modelId: String(variation.variation_id),
          sku: variation.sku ? String(variation.sku) : row.sku ? String(row.sku) : null,
          title: String(row.title || row.mlb_id), variation: variation.attrs ? String(variation.attrs) : null,
          ...enrich("mercadolivre", key)
        });
      }
    }
  }

  for (const row of (amazonRes.data ?? []) as Array<{ sku: string; title: string }>) {
    commercialItems.push({
      channel: "amazon", storeKey: "amazon-onsite", key: row.sku, itemId: row.sku,
      modelId: null, sku: row.sku, title: row.title || row.sku, variation: null,
      suggestedOlistProductId: productBySku.get(row.sku.toLowerCase()) ?? null,
      mappingStatus: productBySku.has(row.sku.toLowerCase()) ? "sku_igual" : "sem_casamento"
    });
  }

  return { stores: (storesRes.data ?? []) as FullStoreConfig[], commercialItems, physicalProducts };
}
