"use server";

import {
  assertFullTransition,
  nextBusinessDay,
  productionStatus
} from "@oraculo/domain/full-workflow.js";
import { revalidatePath, redirect } from "../../lib/operation-navigation";
import { assertTabAccess, isFullManager } from "../../lib/auth/access";
import { getSaoPauloToday } from "../../lib/date";
import { createSupabaseAdminClient } from "../../lib/supabase/admin";
import { effectiveUserId, listOraculoUsers } from "../../lib/users";
import { loadFullCreationCatalog, type FullChannel, type FullWorkflowStatus } from "./data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv"
]);
const MAX_FILE_SIZE = 8 * 1024 * 1024;

type DraftInput = {
  commercialKey: string;
  quantity: number;
  physicalProductId: string;
};

type FullAdminRow = {
  id: string;
  number: number;
  channel: FullChannel;
  store_key: string;
  store_name: string;
  creator_user_id: string;
  logistics_user_id: string;
  workflow_status: FullWorkflowStatus;
  production_status: string;
  external_status: string;
  current_revision: number;
  proposed_pickup_day: string | null;
  approved_pickup_day: string | null;
  scheduled_pickup_day: string | null;
  external_shipment_id: string | null;
};

function idFrom(formData: FormData) {
  const id = String(formData.get("full_id") ?? "");
  if (!UUID.test(id)) throw new Error("Full inválido.");
  return id;
}

function parseItems(value: FormDataEntryValue | null): DraftInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? "[]"));
  } catch {
    throw new Error("A lista de itens é inválida.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
    throw new Error("Informe entre 1 e 100 itens.");
  }
  return parsed.map((entry) => {
    const row = entry as Partial<DraftInput>;
    const quantity = Number(row.quantity);
    if (!row.commercialKey || !row.physicalProductId || !Number.isInteger(quantity) || quantity <= 0 || quantity > 1_000_000) {
      throw new Error("Cada item precisa de anúncio, produto físico e quantidade inteira positiva.");
    }
    return { commercialKey: String(row.commercialKey), physicalProductId: String(row.physicalProductId), quantity };
  });
}

async function loadFullAdmin(id: string): Promise<FullAdminRow> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("oraculo_fulls")
    .select("id,number,channel,store_key,store_name,creator_user_id,logistics_user_id,workflow_status,production_status,external_status,current_revision,proposed_pickup_day,approved_pickup_day,scheduled_pickup_day,external_shipment_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Full não encontrado.");
  return data as FullAdminRow;
}

async function assertParticipant(fullId: string, userId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("oraculo_full_participants")
    .select("full_id")
    .eq("full_id", fullId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Você não participa deste Full.");
}

async function addEvent(args: {
  fullId: string;
  revisionNo?: number | null;
  eventType: string;
  actorUserId?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  payload?: Record<string, unknown>;
  system?: boolean;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("oraculo_full_events").insert({
    full_id: args.fullId,
    revision_no: args.revisionNo ?? null,
    event_type: args.eventType,
    actor_type: args.system ? "sistema" : "usuario",
    actor_user_id: args.system ? null : args.actorUserId,
    from_status: args.fromStatus ?? null,
    to_status: args.toStatus ?? null,
    note: args.note ?? null,
    payload: args.payload ?? {}
  });
  if (error) throw error;
}

function actionTaskKey(fullId: string, stage: string, revision: number) {
  return `full-workflow:${fullId}:${stage}:r${revision}`;
}

async function createAgendaTask(args: {
  full: FullAdminRow;
  stage: string;
  title: string;
  description: string;
  dueDay: string;
  participantIds: string[];
  actorUserId: string;
}) {
  const admin = createSupabaseAdminClient();
  const sourceKey = actionTaskKey(args.full.id, args.stage, args.full.current_revision);
  const { data: existing, error: findError } = await admin
    .from("oraculo_agenda_tasks")
    .select("id")
    .eq("source_key", sourceKey)
    .eq("due_day", args.dueDay)
    .maybeSingle();
  if (findError) throw findError;
  let taskId = existing?.id as string | undefined;
  const payload = {
    title: args.title,
    description: args.description,
    due_day: args.dueDay,
    status: "pendente",
    task_kind: "full_workflow",
    source_key: sourceKey,
    metadata: { full_id: args.full.id, full_number: args.full.number, stage: args.stage, revision: args.full.current_revision },
    generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (taskId) {
    const { error } = await admin.from("oraculo_agenda_tasks").update(payload).eq("id", taskId);
    if (error) throw error;
  } else {
    const { data, error } = await admin
      .from("oraculo_agenda_tasks")
      .insert({ ...payload, created_by: args.actorUserId })
      .select("id")
      .single();
    if (error) throw error;
    taskId = data.id;
  }
  const participants = [...new Set(args.participantIds)].map((userId) => ({ task_id: taskId!, user_id: userId }));
  const { error: clearError } = await admin.from("oraculo_agenda_task_participants").delete().eq("task_id", taskId);
  if (clearError) throw clearError;
  const { error: participantError } = await admin.from("oraculo_agenda_task_participants").insert(participants);
  if (participantError) throw participantError;
}

async function closeAgendaStage(full: FullAdminRow, stage: string, actorUserId: string, note?: string) {
  const admin = createSupabaseAdminClient();
  const sourceKey = actionTaskKey(full.id, stage, full.current_revision);
  const { error } = await admin
    .from("oraculo_agenda_tasks")
    .update({
      status: "concluida",
      completed_at: new Date().toISOString(),
      completed_by: actorUserId,
      updated_at: new Date().toISOString(),
      metadata: { full_id: full.id, full_number: full.number, stage, revision: full.current_revision, resolution_note: note ?? null }
    })
    .eq("source_key", sourceKey)
    .eq("status", "pendente");
  if (error) throw error;
}

async function buildValidatedItems(channel: FullChannel, storeKey: string, inputs: DraftInput[]) {
  const catalog = await loadFullCreationCatalog();
  const commercial = new Map(
    catalog.commercialItems
      .filter((item) => item.channel === channel && item.storeKey === storeKey)
      .map((item) => [item.key, item])
  );
  const physical = new Map(catalog.physicalProducts.map((product) => [product.id, product]));
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.commercialKey)) throw new Error("O mesmo anúncio/variação não pode aparecer duas vezes.");
    seen.add(input.commercialKey);
    if (!commercial.has(input.commercialKey)) throw new Error(`Item comercial indisponível: ${input.commercialKey}.`);
    if (!physical.has(input.physicalProductId)) throw new Error("Produto físico não encontrado no Olist.");
  }

  const admin = createSupabaseAdminClient();
  const physicalIds = [...new Set(inputs.map((item) => item.physicalProductId))];
  const { data: selectedProducts, error } = await admin
    .from("olist_products")
    .select("id,sku,nome,tipo,payload")
    .in("id", physicalIds)
    .eq("active", true);
  if (error) throw error;
  const selectedById = new Map((selectedProducts ?? []).map((product) => [String(product.id), product]));

  const componentIds = new Set<string>();
  for (const product of selectedProducts ?? []) {
    if (product.tipo !== "K") continue;
    for (const component of Array.isArray(product.payload?.kit) ? product.payload.kit : []) {
      const componentId = String(component?.produto?.id ?? "");
      if (componentId) componentIds.add(componentId);
    }
  }
  const { data: components, error: componentError } = componentIds.size
    ? await admin.from("olist_products").select("id,sku,nome,active").in("id", [...componentIds])
    : { data: [], error: null };
  if (componentError) throw componentError;
  const componentsById = new Map((components ?? []).map((product) => [String(product.id), product]));

  return inputs.map((input, index) => {
    const item = commercial.get(input.commercialKey)!;
    const product = selectedById.get(input.physicalProductId);
    if (!product?.sku) throw new Error(`Produto físico sem SKU: ${input.physicalProductId}.`);
    const expanded = product.tipo === "K"
      ? (Array.isArray(product.payload?.kit) ? product.payload.kit : []).map((component: Record<string, unknown>) => {
          const nested = component.produto as Record<string, unknown> | undefined;
          const componentProduct = componentsById.get(String(nested?.id ?? ""));
          const units = Number(component.quantidade ?? 0);
          if (!componentProduct?.sku || !Number.isFinite(units) || units <= 0) {
            throw new Error(`O kit ${product.sku} possui componente incompleto no Olist.`);
          }
          return {
            productId: String(componentProduct.id), sku: String(componentProduct.sku),
            title: String(componentProduct.nome || componentProduct.sku), units,
            requiredQty: Math.ceil(input.quantity * units)
          };
        })
      : [{ productId: String(product.id), sku: String(product.sku), title: String(product.nome || product.sku), units: 1, requiredQty: input.quantity }];
    if (expanded.length === 0) throw new Error(`O kit ${product.sku} não possui componentes cadastrados.`);
    return {
      item,
      input,
      position: index + 1,
      selectedProduct: {
        id: String(product.id),
        sku: String(product.sku),
        title: String(product.nome || product.sku),
        isKit: product.tipo === "K"
      },
      components: expanded
    };
  });
}

async function writeRevision(args: {
  fullId: string;
  revisionNo: number;
  creatorId: string;
  reason: string | null;
  rows: Awaited<ReturnType<typeof buildValidatedItems>>;
}) {
  const admin = createSupabaseAdminClient();
  const rows = args.rows.map((row) => ({
    channel_item_key: row.item.key,
    channel_item_id: row.item.itemId,
    channel_model_id: row.item.modelId,
    marketplace_sku: row.item.sku,
    marketplace_title: row.item.title,
    marketplace_variation: row.item.variation,
    selected_olist_product_id: row.selectedProduct.id,
    selected_olist_sku: row.selectedProduct.sku,
    selected_olist_title: row.selectedProduct.title,
    selected_olist_is_kit: row.selectedProduct.isKit,
    requested_qty: row.input.quantity,
    position: row.position,
    components: row.components.map((component: { productId: string; sku: string; title: string; units: number; requiredQty: number }) => ({
      olist_product_id: component.productId,
      olist_sku: component.sku,
      olist_title: component.title,
      units_per_marketplace: component.units,
      required_qty: component.requiredQty
    }))
  }));
  const { data, error } = await admin.rpc("oraculo_write_full_revision", {
    p_full_id: args.fullId,
    p_revision_no: args.revisionNo,
    p_created_by: args.creatorId,
    p_reason: args.reason,
    p_rows: rows
  });
  if (error) throw error;
  return String(data);
}

export async function createFull(formData: FormData) {
  const user = await assertTabAccess("full");
  const me = effectiveUserId(user);
  const channel = String(formData.get("channel") ?? "") as FullChannel;
  const storeKey = String(formData.get("store_key") ?? "");
  const logisticsUserId = String(formData.get("logistics_user_id") ?? "");
  if (!(["shopee", "mercadolivre", "amazon"] as string[]).includes(channel)) throw new Error("Marketplace inválido.");
  if (!storeKey || !UUID.test(logisticsUserId)) throw new Error("Loja ou responsável logístico inválido.");
  const knownUsers = new Set((await listOraculoUsers()).map((entry) => entry.id));
  if (!knownUsers.has(logisticsUserId)) throw new Error("Responsável logístico não encontrado.");
  const inputs = parseItems(formData.get("items_json"));
  const rows = await buildValidatedItems(channel, storeKey, inputs);
  if (rows.some((row) => row.selectedProduct.isKit) && formData.get("confirm_kits") !== "yes") {
    throw new Error("Confirme a expansão dos kits antes de criar o Full.");
  }

  const admin = createSupabaseAdminClient();
  const { data: config, error: configError } = await admin
    .from("oraculo_full_store_configs")
    .select("store_name,catalog_enabled")
    .eq("channel", channel)
    .eq("store_key", storeKey)
    .eq("operation_id", "uberlandia")
    .maybeSingle();
  if (configError) throw configError;
  if (!config?.catalog_enabled) throw new Error("O catálogo desta loja não está liberado.");

  const { data: full, error } = await admin
    .from("oraculo_fulls")
    .insert({ channel, store_key: storeKey, store_name: config.store_name, creator_user_id: me, logistics_user_id: logisticsUserId })
    .select("id,number")
    .single();
  if (error) throw error;
  try {
    const { error: participantError } = await admin.from("oraculo_full_participants").insert([
      { full_id: full.id, user_id: me, participant_role: "criador" },
      ...(logisticsUserId === me ? [] : [{ full_id: full.id, user_id: logisticsUserId, participant_role: "logistica" }])
    ]);
    if (participantError) throw participantError;
    await writeRevision({ fullId: full.id, revisionNo: 1, creatorId: me, reason: "Criação inicial", rows });
    await addEvent({ fullId: full.id, revisionNo: 1, eventType: "full_criado", actorUserId: me, toStatus: "rascunho", payload: { items: rows.length } });
  } catch (cause) {
    await admin.from("oraculo_fulls").delete().eq("id", full.id);
    throw cause;
  }
  await revalidatePath("/full");
  await redirect(`/full/${full.id}`);
}

export async function reviseFull(formData: FormData) {
  const user = await assertTabAccess("full");
  const me = effectiveUserId(user);
  const fullId = idFrom(formData);
  const full = await loadFullAdmin(fullId);
  if (full.creator_user_id !== me && !isFullManager(user)) throw new Error("Só o criador ou gestor pode revisar o Full.");
  if (full.workflow_status === "concluido" || full.workflow_status === "cancelado") throw new Error("Full encerrado não aceita revisão.");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) throw new Error("Informe o motivo da revisão.");
  const logisticsUserId = String(formData.get("logistics_user_id") ?? full.logistics_user_id);
  const knownUsers = new Set((await listOraculoUsers()).map((entry) => entry.id));
  if (!UUID.test(logisticsUserId) || !knownUsers.has(logisticsUserId)) throw new Error("Responsável logístico não encontrado.");
  const inputs = parseItems(formData.get("items_json"));
  const rows = await buildValidatedItems(full.channel, full.store_key, inputs);
  if (rows.some((row) => row.selectedProduct.isKit) && formData.get("confirm_kits") !== "yes") {
    throw new Error("Confirme a expansão dos kits antes de criar a revisão.");
  }
  const revisionNo = full.current_revision + 1;
  await writeRevision({ fullId, revisionNo, creatorId: me, reason, rows });
  const admin = createSupabaseAdminClient();
  const { data: productionLines, error: productionError } = await admin
    .from("oraculo_full_production_lines")
    .select("required_qty,ready_qty,shortage_qty")
    .eq("full_id", fullId)
    .eq("active", true);
  if (productionError) throw productionError;
  const nextProductionStatus = productionStatus((productionLines ?? []).map((line) => ({
    requiredQty: line.required_qty,
    readyQty: line.ready_qty,
    shortageQty: line.shortage_qty
  })));
  const { error } = await admin.from("oraculo_fulls").update({
    current_revision: revisionNo,
    logistics_user_id: logisticsUserId,
    workflow_status: "rascunho",
    production_status: nextProductionStatus,
    external_status: "nao_vinculado",
    proposed_pickup_day: null,
    proposed_pickup_note: null,
    proposed_by: null,
    proposed_at: null,
    approved_pickup_day: null,
    approved_by: null,
    approved_at: null,
    external_shipment_id: null,
    shipping_mode: null,
    scheduled_pickup_day: null,
    last_external_error: null,
    updated_at: new Date().toISOString()
  }).eq("id", fullId);
  if (error) throw error;
  const { error: participantError } = await admin.from("oraculo_full_participants").upsert(
    [
      { full_id: fullId, user_id: full.creator_user_id, participant_role: "criador" },
      ...(logisticsUserId === full.creator_user_id ? [] : [{ full_id: fullId, user_id: logisticsUserId, participant_role: "logistica" }])
    ],
    { onConflict: "full_id,user_id" }
  );
  if (participantError) throw participantError;
  const { error: oldTaskError } = await admin.from("oraculo_agenda_tasks").update({
    status: "concluida",
    completed_at: new Date().toISOString(),
    completed_by: me,
    updated_at: new Date().toISOString(),
    metadata: { full_id: fullId, full_number: full.number, resolution_note: "Marco substituído por nova revisão", substituted_by_revision: revisionNo }
  }).contains("metadata", { full_id: fullId }).eq("status", "pendente");
  if (oldTaskError) throw oldTaskError;
  await addEvent({ fullId, revisionNo, eventType: "nova_revisao", actorUserId: me, fromStatus: full.workflow_status, toStatus: "rascunho", note: reason, payload: { previous_revision: full.current_revision, previous_external_shipment_id: full.external_shipment_id } });
  await revalidatePath("/full");
  await redirect(`/full/${fullId}`);
}

export async function submitFull(formData: FormData) {
  const user = await assertTabAccess("full");
  const me = effectiveUserId(user);
  const full = await loadFullAdmin(idFrom(formData));
  if (full.creator_user_id !== me && !isFullManager(user)) throw new Error("Só o criador ou gestor pode enviar o Full.");
  assertFullTransition(full.workflow_status, "aguardando_logistica");
  const admin = createSupabaseAdminClient();
  const { data: config, error: configError } = await admin
    .from("oraculo_full_store_configs")
    .select("submission_enabled,validation_note")
    .eq("channel", full.channel)
    .eq("store_key", full.store_key)
    .maybeSingle();
  if (configError) throw configError;
  if (!config?.submission_enabled) {
    throw new Error(config?.validation_note || "Canal ainda não liberado: coleta e recebimento automáticos precisam ser validados.");
  }
  const { data: revision, error: revisionError } = await admin
    .from("oraculo_full_revisions")
    .select("id,frozen_at")
    .eq("full_id", full.id)
    .eq("revision_no", full.current_revision)
    .maybeSingle();
  if (revisionError) throw revisionError;
  if (!revision) throw new Error("Revisão atual não encontrada.");
  if (!revision.frozen_at) {
    const { error } = await admin.from("oraculo_full_revisions").update({ frozen_at: new Date().toISOString() }).eq("id", revision.id);
    if (error) throw error;
  }
  const { error } = await admin.from("oraculo_fulls").update({ workflow_status: "aguardando_logistica", updated_at: new Date().toISOString() }).eq("id", full.id).eq("workflow_status", "rascunho");
  if (error) throw error;
  await addEvent({ fullId: full.id, revisionNo: full.current_revision, eventType: "enviado_logistica", actorUserId: me, fromStatus: "rascunho", toStatus: "aguardando_logistica" });
  const updated = { ...full, workflow_status: "aguardando_logistica" as const };
  await createAgendaTask({
    full: updated, stage: "analise_logistica", title: `Full · ${full.store_name} · definir coleta`,
    description: `Revisão ${full.current_revision}. Confira os produtos, inicie a produção e proponha a melhor data.`,
    dueDay: nextBusinessDay(getSaoPauloToday()), participantIds: [full.logistics_user_id], actorUserId: me
  });
  await revalidatePath("/full");
  await revalidatePath("/agenda");
}

export async function proposePickupDate(formData: FormData) {
  const user = await assertTabAccess("full");
  const me = effectiveUserId(user);
  const full = await loadFullAdmin(idFrom(formData));
  if (full.logistics_user_id !== me && !isFullManager(user)) throw new Error("Só a logística responsável pode propor a data.");
  if (full.workflow_status !== "aguardando_logistica" || full.external_shipment_id) throw new Error("O Full não está aguardando proposta inicial da logística.");
  const day = String(formData.get("proposed_pickup_day") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!DATE_ONLY.test(day) || day < getSaoPauloToday()) throw new Error("Informe uma data de coleta válida e não passada.");
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("oraculo_fulls").update({
    workflow_status: "aguardando_criador", proposed_pickup_day: day, proposed_pickup_note: note,
    proposed_by: me, proposed_at: new Date().toISOString(), updated_at: new Date().toISOString()
  }).eq("id", full.id).eq("workflow_status", "aguardando_logistica");
  if (error) throw error;
  await closeAgendaStage(full, "analise_logistica", me);
  await addEvent({ fullId: full.id, revisionNo: full.current_revision, eventType: "data_proposta", actorUserId: me, fromStatus: "aguardando_logistica", toStatus: "aguardando_criador", note, payload: { proposed_pickup_day: day } });
  const updated = { ...full, workflow_status: "aguardando_criador" as const };
  await createAgendaTask({ full: updated, stage: "aprovar_data", title: `Full · ${full.store_name} · aprovar ${day.split("-").reverse().join("/")}`, description: "Aceite a data proposta pela logística ou solicite uma alternativa.", dueDay: nextBusinessDay(getSaoPauloToday()), participantIds: [full.creator_user_id], actorUserId: me });
  await revalidatePath("/full");
  await revalidatePath("/agenda");
}

export async function decidePickupDate(formData: FormData) {
  const user = await assertTabAccess("full");
  const me = effectiveUserId(user);
  const full = await loadFullAdmin(idFrom(formData));
  if (full.creator_user_id !== me && !isFullManager(user)) throw new Error("Só o criador pode decidir a data.");
  if (full.workflow_status !== "aguardando_criador" || !full.proposed_pickup_day) throw new Error("Não há uma data aguardando decisão.");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const admin = createSupabaseAdminClient();
  if (decision === "accept") {
    const { error } = await admin.from("oraculo_fulls").update({
      workflow_status: "aguardando_agendamento", approved_pickup_day: full.proposed_pickup_day,
      approved_by: me, approved_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq("id", full.id).eq("workflow_status", "aguardando_criador");
    if (error) throw error;
    await closeAgendaStage(full, "aprovar_data", me);
    await addEvent({ fullId: full.id, revisionNo: full.current_revision, eventType: "data_aprovada", actorUserId: me, fromStatus: "aguardando_criador", toStatus: "aguardando_agendamento", note, payload: { approved_pickup_day: full.proposed_pickup_day } });
    const updated = { ...full, workflow_status: "aguardando_agendamento" as const };
    await createAgendaTask({ full: updated, stage: "agendar_marketplace", title: `Full · ${full.store_name} · criar no marketplace`, description: "Crie a remessa no marketplace e registre código, modalidade e data agendada.", dueDay: nextBusinessDay(getSaoPauloToday()), participantIds: [full.creator_user_id], actorUserId: me });
  } else if (decision === "reject") {
    if (!note) throw new Error("Informe por que precisa de outra data.");
    const { error } = await admin.from("oraculo_fulls").update({ workflow_status: "aguardando_logistica", updated_at: new Date().toISOString() }).eq("id", full.id).eq("workflow_status", "aguardando_criador");
    if (error) throw error;
    await closeAgendaStage(full, "aprovar_data", me, note);
    await addEvent({ fullId: full.id, revisionNo: full.current_revision, eventType: "data_rejeitada", actorUserId: me, fromStatus: "aguardando_criador", toStatus: "aguardando_logistica", note });
    const updated = { ...full, workflow_status: "aguardando_logistica" as const };
    await createAgendaTask({ full: updated, stage: "analise_logistica", title: `Full · ${full.store_name} · rever coleta`, description: note, dueDay: nextBusinessDay(getSaoPauloToday()), participantIds: [full.logistics_user_id], actorUserId: me });
  } else {
    throw new Error("Decisão inválida.");
  }
  await revalidatePath("/full");
  await revalidatePath("/agenda");
}

async function beginMonitoring(full: FullAdminRow, actorUserId: string, scheduledDay: string) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("oraculo_fulls").update({ workflow_status: "monitorando", external_status: "agendado", updated_at: new Date().toISOString() }).eq("id", full.id);
  if (error) throw error;
  await addEvent({ fullId: full.id, revisionNo: full.current_revision, eventType: "monitoramento_iniciado", actorUserId, fromStatus: full.workflow_status, toStatus: "monitorando", payload: { external_shipment_id: full.external_shipment_id, scheduled_pickup_day: scheduledDay } });
  const updated = { ...full, workflow_status: "monitorando" as const };
  await createAgendaTask({ full: updated, stage: "coleta_prevista", title: `Full · ${full.store_name} · coleta prevista`, description: "Marco acompanhado automaticamente pelo conector do marketplace.", dueDay: scheduledDay, participantIds: [full.creator_user_id, full.logistics_user_id], actorUserId });
}

export async function registerMarketplaceShipment(formData: FormData) {
  const user = await assertTabAccess("full");
  const me = effectiveUserId(user);
  const full = await loadFullAdmin(idFrom(formData));
  if (full.creator_user_id !== me && !isFullManager(user)) throw new Error("Só o criador ou gestor pode registrar a remessa.");
  if (full.workflow_status !== "aguardando_agendamento") throw new Error("O Full não está aguardando agendamento.");
  const externalId = String(formData.get("external_shipment_id") ?? "").trim();
  const shippingMode = String(formData.get("shipping_mode") ?? "").trim();
  const scheduledDay = String(formData.get("scheduled_pickup_day") ?? "");
  if (!externalId || !shippingMode || !DATE_ONLY.test(scheduledDay)) throw new Error("Código, modalidade e data agendada são obrigatórios.");
  const admin = createSupabaseAdminClient();
  const diverged = scheduledDay !== full.approved_pickup_day;
  const nextStatus = diverged ? "aguardando_logistica" : "aguardando_agendamento";
  const { error } = await admin.from("oraculo_fulls").update({
    external_shipment_id: externalId, shipping_mode: shippingMode, scheduled_pickup_day: scheduledDay,
    workflow_status: nextStatus, external_status: "agendado", proposed_pickup_day: diverged ? scheduledDay : full.proposed_pickup_day,
    updated_at: new Date().toISOString()
  }).eq("id", full.id).eq("workflow_status", "aguardando_agendamento");
  if (error) throw error;
  await closeAgendaStage(full, "agendar_marketplace", me);
  await addEvent({ fullId: full.id, revisionNo: full.current_revision, eventType: diverged ? "data_marketplace_divergente" : "remessa_vinculada", actorUserId: me, fromStatus: "aguardando_agendamento", toStatus: nextStatus, payload: { external_shipment_id: externalId, shipping_mode: shippingMode, scheduled_pickup_day: scheduledDay, approved_pickup_day: full.approved_pickup_day } });
  const withExternal = { ...full, external_shipment_id: externalId, scheduled_pickup_day: scheduledDay, workflow_status: nextStatus as FullWorkflowStatus };
  if (diverged) {
    await createAgendaTask({ full: withExternal, stage: "aprovar_data_marketplace", title: `Full · ${full.store_name} · validar data do marketplace`, description: `O marketplace ofereceu ${scheduledDay.split("-").reverse().join("/")}, diferente da data aprovada.`, dueDay: nextBusinessDay(getSaoPauloToday()), participantIds: [full.logistics_user_id], actorUserId: me });
  } else {
    await beginMonitoring(withExternal, me, scheduledDay);
  }
  await revalidatePath("/full");
  await revalidatePath("/agenda");
}

export async function approveMarketplaceDate(formData: FormData) {
  const user = await assertTabAccess("full");
  const me = effectiveUserId(user);
  const full = await loadFullAdmin(idFrom(formData));
  if (full.logistics_user_id !== me && !isFullManager(user)) throw new Error("Só a logística responsável pode validar a data externa.");
  if (full.workflow_status !== "aguardando_logistica" || !full.external_shipment_id || !full.scheduled_pickup_day) throw new Error("Não há data externa aguardando validação.");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (decision === "accept") {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("oraculo_fulls").update({ approved_pickup_day: full.scheduled_pickup_day, approved_by: me, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", full.id);
    if (error) throw error;
    await closeAgendaStage(full, "aprovar_data_marketplace", me);
    await addEvent({ fullId: full.id, revisionNo: full.current_revision, eventType: "data_marketplace_aprovada", actorUserId: me, fromStatus: "aguardando_logistica", toStatus: "monitorando", note, payload: { scheduled_pickup_day: full.scheduled_pickup_day } });
    await beginMonitoring(full, me, full.scheduled_pickup_day);
  } else if (decision === "reject") {
    if (!note) throw new Error("Informe por que a data externa não é viável.");
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("oraculo_fulls").update({ workflow_status: "aguardando_agendamento", external_shipment_id: null, shipping_mode: null, scheduled_pickup_day: null, external_status: "nao_vinculado", updated_at: new Date().toISOString() }).eq("id", full.id);
    if (error) throw error;
    await closeAgendaStage(full, "aprovar_data_marketplace", me, note);
    await addEvent({ fullId: full.id, revisionNo: full.current_revision, eventType: "data_marketplace_rejeitada", actorUserId: me, fromStatus: "aguardando_logistica", toStatus: "aguardando_agendamento", note });
    const updated = { ...full, workflow_status: "aguardando_agendamento" as const };
    await createAgendaTask({ full: updated, stage: "agendar_marketplace", title: `Full · ${full.store_name} · reagendar no marketplace`, description: note, dueDay: nextBusinessDay(getSaoPauloToday()), participantIds: [full.creator_user_id], actorUserId: me });
  } else throw new Error("Decisão inválida.");
  await revalidatePath("/full");
  await revalidatePath("/agenda");
}

export async function updateProduction(formData: FormData) {
  const user = await assertTabAccess("full");
  const me = effectiveUserId(user);
  const full = await loadFullAdmin(idFrom(formData));
  if (full.logistics_user_id !== me && !isFullManager(user)) throw new Error("Só a logística responsável pode atualizar a produção.");
  if (["rascunho", "concluido", "cancelado"].includes(full.workflow_status)) throw new Error("A produção não pode ser alterada nesta etapa.");
  const lineId = String(formData.get("production_line_id") ?? "");
  const readyQty = Number(formData.get("ready_qty"));
  const shortageQty = Number(formData.get("shortage_qty"));
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!UUID.test(lineId) || !Number.isInteger(readyQty) || readyQty < 0 || !Number.isInteger(shortageQty) || shortageQty < 0) throw new Error("Quantidades de produção inválidas.");
  const admin = createSupabaseAdminClient();
  const { data: line, error: lineError } = await admin.from("oraculo_full_production_lines").select("id,required_qty").eq("id", lineId).eq("full_id", full.id).maybeSingle();
  if (lineError) throw lineError;
  if (!line) throw new Error("Linha de produção não encontrada.");
  const now = new Date().toISOString();
  const { error } = await admin.from("oraculo_full_production_lines").update({ ready_qty: readyQty, shortage_qty: shortageQty, shortage_note: shortageQty > 0 ? note : null, updated_by: me, updated_at: now }).eq("id", lineId);
  if (error) throw error;
  const { error: historyError } = await admin.from("oraculo_full_production_updates").insert({ full_id: full.id, production_line_id: lineId, revision_no: full.current_revision, ready_qty: readyQty, shortage_qty: shortageQty, note, actor_user_id: me });
  if (historyError) throw historyError;
  const { data: lines, error: linesError } = await admin.from("oraculo_full_production_lines").select("required_qty,ready_qty,shortage_qty").eq("full_id", full.id).eq("active", true);
  if (linesError) throw linesError;
  const status = productionStatus((lines ?? []).map((row) => ({ requiredQty: row.required_qty, readyQty: row.ready_qty, shortageQty: row.shortage_qty })));
  const { error: statusError } = await admin.from("oraculo_fulls").update({ production_status: status, updated_at: now }).eq("id", full.id);
  if (statusError) throw statusError;
  await addEvent({ fullId: full.id, revisionNo: full.current_revision, eventType: "producao_atualizada", actorUserId: me, note, payload: { production_line_id: lineId, required_qty: line.required_qty, ready_qty: readyQty, shortage_qty: shortageQty, production_status: status } });
  await revalidatePath(`/full/${full.id}`);
  await revalidatePath("/full");
}

async function ensureFullBucket() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.getBucket("full-documents");
  if (!data && error) {
    const created = await admin.storage.createBucket("full-documents", {
      public: false,
      fileSizeLimit: MAX_FILE_SIZE,
      allowedMimeTypes: [...ALLOWED_MIME]
    });
    if (created.error && !/already exists/i.test(created.error.message)) throw created.error;
  }
}

export async function uploadFullAttachment(formData: FormData) {
  const user = await assertTabAccess("full");
  const me = effectiveUserId(user);
  const fullId = idFrom(formData);
  await assertParticipant(fullId, me).catch((error) => {
    if (!isFullManager(user)) throw error;
  });
  const file = formData.get("file");
  if (!(file instanceof File) || file.size <= 0) throw new Error("Selecione um arquivo.");
  if (file.size > MAX_FILE_SIZE || !ALLOWED_MIME.has(file.type)) throw new Error("Arquivo inválido. Use PDF, PNG, JPG, ZIP, XLSX ou CSV com até 8 MB.");
  await ensureFullBucket();
  const safeName = file.name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "arquivo";
  const path = `${fullId}/${crypto.randomUUID()}-${safeName}`;
  const admin = createSupabaseAdminClient();
  const uploaded = await admin.storage.from("full-documents").upload(path, file, { contentType: file.type, upsert: false });
  if (uploaded.error) throw uploaded.error;
  const { error } = await admin.from("oraculo_full_attachments").insert({ full_id: fullId, storage_path: path, file_name: file.name, mime_type: file.type, file_size: file.size, uploaded_by: me });
  if (error) {
    await admin.storage.from("full-documents").remove([path]);
    throw error;
  }
  const full = await loadFullAdmin(fullId);
  await addEvent({ fullId, revisionNo: full.current_revision, eventType: "arquivo_anexado", actorUserId: me, payload: { file_name: file.name, mime_type: file.type, file_size: file.size } });
  await revalidatePath(`/full/${fullId}`);
}

export async function cancelFull(formData: FormData) {
  const user = await assertTabAccess("full");
  const me = effectiveUserId(user);
  const full = await loadFullAdmin(idFrom(formData));
  const linked = Boolean(full.external_shipment_id);
  if (linked ? !isFullManager(user) : full.creator_user_id !== me && !isFullManager(user)) {
    throw new Error(linked ? "Após vincular uma remessa, apenas gestor Full pode cancelar o registro interno." : "Só o criador ou gestor pode cancelar.");
  }
  if (full.workflow_status === "concluido" || full.workflow_status === "cancelado") throw new Error("Full já encerrado.");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) throw new Error("O motivo do cancelamento é obrigatório.");
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("oraculo_fulls").update({ workflow_status: "cancelado", cancelled_at: new Date().toISOString(), cancelled_by: me, cancellation_reason: reason, updated_at: new Date().toISOString() }).eq("id", full.id);
  if (error) throw error;
  await addEvent({ fullId: full.id, revisionNo: full.current_revision, eventType: "full_cancelado", actorUserId: me, fromStatus: full.workflow_status, toStatus: "cancelado", note: reason, payload: { external_shipment_id: full.external_shipment_id, marketplace_not_cancelled_automatically: linked } });
  const { error: taskError } = await admin.from("oraculo_agenda_tasks").update({ status: "concluida", completed_at: new Date().toISOString(), completed_by: me, updated_at: new Date().toISOString() }).contains("metadata", { full_id: full.id }).eq("status", "pendente");
  if (taskError) throw taskError;
  await revalidatePath("/full");
  await revalidatePath("/agenda");
}

export async function requestExternalSync(formData: FormData) {
  const user = await assertTabAccess("full");
  if (!isFullManager(user)) throw new Error("Só gestor Full pode solicitar nova sincronização.");
  const me = effectiveUserId(user);
  const full = await loadFullAdmin(idFrom(formData));
  if (full.workflow_status !== "monitorando" || !full.external_shipment_id) throw new Error("A remessa ainda não está em monitoramento.");
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("oraculo_fulls").update({ last_external_sync_at: null, last_external_error: null, updated_at: new Date().toISOString() }).eq("id", full.id);
  if (error) throw error;
  await addEvent({ fullId: full.id, revisionNo: full.current_revision, eventType: "ressincronizacao_solicitada", actorUserId: me });
  await revalidatePath(`/full/${full.id}`);
}

export async function correctExternalLink(formData: FormData) {
  const user = await assertTabAccess("full");
  if (!isFullManager(user)) throw new Error("Só gestor Full pode corrigir o vínculo externo.");
  const me = effectiveUserId(user);
  const full = await loadFullAdmin(idFrom(formData));
  if (!["monitorando", "excecao"].includes(full.workflow_status) || !full.external_shipment_id) {
    throw new Error("A correção exige uma remessa já vinculada em monitoramento ou exceção.");
  }
  const externalId = String(formData.get("external_shipment_id") ?? "").trim();
  const shippingMode = String(formData.get("shipping_mode") ?? "").trim();
  const scheduledDay = String(formData.get("scheduled_pickup_day") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!externalId || !shippingMode || !DATE_ONLY.test(scheduledDay) || !note) {
    throw new Error("Código, modalidade, data e justificativa são obrigatórios.");
  }
  const diverged = scheduledDay !== full.approved_pickup_day;
  const nextStatus: FullWorkflowStatus = diverged ? "aguardando_logistica" : "monitorando";
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("oraculo_fulls").update({
    external_shipment_id: externalId,
    shipping_mode: shippingMode,
    scheduled_pickup_day: scheduledDay,
    proposed_pickup_day: diverged ? scheduledDay : full.proposed_pickup_day,
    external_status: "agendado",
    workflow_status: nextStatus,
    external_collected_at: null,
    external_received_at: null,
    last_external_sync_at: null,
    last_external_error: null,
    updated_at: new Date().toISOString()
  }).eq("id", full.id);
  if (error) throw error;
  await closeAgendaStage(full, "coleta_prevista", me, "Marco substituído após correção do vínculo externo");
  await addEvent({
    fullId: full.id,
    revisionNo: full.current_revision,
    eventType: "vinculo_externo_corrigido",
    actorUserId: me,
    fromStatus: full.workflow_status,
    toStatus: nextStatus,
    note,
    payload: {
      previous_external_shipment_id: full.external_shipment_id,
      external_shipment_id: externalId,
      previous_scheduled_pickup_day: full.scheduled_pickup_day,
      scheduled_pickup_day: scheduledDay
    }
  });
  const updated = { ...full, external_shipment_id: externalId, scheduled_pickup_day: scheduledDay, workflow_status: nextStatus };
  if (diverged) {
    await createAgendaTask({
      full: updated,
      stage: "aprovar_data_marketplace",
      title: `Full · ${full.store_name} · validar data corrigida`,
      description: `O vínculo corrigido prevê ${scheduledDay.split("-").reverse().join("/")}.`,
      dueDay: nextBusinessDay(getSaoPauloToday()),
      participantIds: [full.logistics_user_id],
      actorUserId: me
    });
  } else {
    await createAgendaTask({
      full: updated,
      stage: "coleta_prevista",
      title: `Full · ${full.store_name} · coleta prevista`,
      description: "Marco recriado após correção gerencial do vínculo externo.",
      dueDay: scheduledDay,
      participantIds: [full.creator_user_id, full.logistics_user_id],
      actorUserId: me
    });
  }
  await revalidatePath(`/full/${full.id}`);
  await revalidatePath("/full");
  await revalidatePath("/agenda");
}
