"use server";

import {
  expectedSeparationSlot,
  officialSeparationPeriod,
  validateCustomSeparationWindow
} from "@oraculo/domain/separation.js";
import { assertTabAccess } from "../../../lib/auth/access";
import { getRequestOperation } from "../../../lib/operation-context";
import { redirect, revalidatePath } from "../../../lib/operation-navigation";
import { readEnvValue } from "../../../lib/auth/session";
import { createSupabaseAdminClient } from "../../../lib/supabase/admin";
import { effectiveUserId } from "../../../lib/users";

type WorkerRequest = {
  listId: string;
  syncOrders: boolean;
  lookbackDays: number;
  advanceCursor: boolean;
  sendWhatsapp: boolean;
};

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Falha desconhecida.";
}

function isUniqueViolation(error: { code?: string } | null) {
  return error?.code === "23505";
}

function localInputToIso(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return "";
  const parsed = Date.parse(`${text}:00-03:00`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

async function markFailed(listId: string, error: unknown) {
  const admin = createSupabaseAdminClient({ operation: await getRequestOperation() });
  await admin.rpc("logistica_picking_fail", { p_lista_id: listId, p_message: messageOf(error) });
}

async function expireAbandonedRequests(admin: AdminClient, operation: string) {
  const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { error } = await admin
    .from("logistica_picking_listas")
    .update({ status: "failed", last_error: "Atualização interrompida por tempo excedido.", updated_at: new Date().toISOString() })
    .eq("operation_id", operation)
    .in("status", ["pending", "syncing", "processing"])
    .lt("updated_at", cutoff);
  if (error) throw error;
}

async function hasActiveRequest(admin: AdminClient, operation: string) {
  const { data, error } = await admin
    .from("logistica_picking_listas")
    .select("id")
    .eq("operation_id", operation)
    .in("status", ["pending", "syncing", "processing"])
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function triggerWorker(request: WorkerRequest) {
  const url = readEnvValue("N8N_SEPARATION_WEBHOOK_URL");
  const secret = readEnvValue("N8N_SEPARATION_WEBHOOK_SECRET");
  if (!url || !secret) throw new Error("Worker da separação ainda não foi configurado.");

  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "Content-Type": "application/json",
      "x-oraculo-separation-secret": secret
    },
    body: JSON.stringify({
      list_id: request.listId,
      sync_orders: request.syncOrders,
      lookback_days: Math.max(1, Math.min(7, Math.ceil(request.lookbackDays))),
      advance_cursor: request.advanceCursor,
      send_whatsapp: request.sendWhatsapp,
      operation_id: await getRequestOperation()
    })
  });
  if (!response.ok) throw new Error(`Worker recusou a atualização (${response.status}).`);
}

export async function refreshOfficialSeparation() {
  const user = await assertTabAccess("logistica");
  const operation = await getRequestOperation();
  if (operation !== "uberlandia") throw new Error("Separação multicanal ainda não está disponível nesta operação.");
  const admin = createSupabaseAdminClient({ operation });
  await expireAbandonedRequests(admin, operation);
  const expected = expectedSeparationSlot(new Date());
  const period = officialSeparationPeriod(expected);

  const { data: cursor, error: cursorError } = await admin
    .from("logistica_picking_cursor")
    .select("last_cursor_end")
    .eq("operation_id", operation)
    .maybeSingle();
  if (cursorError) throw cursorError;
  const cursorStart = cursor?.last_cursor_end ? String(cursor.last_cursor_end) : null;
  if (!cursorStart) {
    await redirect("/logistica/separacao?erro=O+cursor+oficial+ainda+nao+foi+inicializado");
  }

  const { data: existing, error: existingError } = await admin
    .from("logistica_picking_listas")
    .select("id,status")
    .eq("operation_id", operation)
    .eq("kind", "official")
    .eq("slot_key", expected.slotKey)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.status === "ready") {
    await redirect("/logistica/separacao?mensagem=O+fechamento+esperado+ja+esta+pronto");
  }
  if (existing && ["pending", "syncing", "processing"].includes(existing.status)) {
    await redirect("/logistica/separacao?mensagem=A+atualizacao+ja+esta+em+andamento");
  }
  if (await hasActiveRequest(admin, operation)) {
    await redirect("/logistica/separacao?mensagem=Ja+existe+uma+atualizacao+em+andamento");
  }

  const payload = {
    operation_id: operation,
    kind: "official",
    trigger_source: "refresh_button",
    status: "pending",
    slot_key: expected.slotKey,
    cursor_start: cursorStart,
    cursor_end: new Date().toISOString(),
    period_start: period.start,
    period_end: period.end,
    requested_by: effectiveUserId(user),
    requested_by_email: user.email ?? null,
    whatsapp_status: "not_requested",
    last_error: null,
    updated_at: new Date().toISOString()
  };

  let listId = existing?.id ? String(existing.id) : "";
  if (listId) {
    const { error } = await admin.from("logistica_picking_listas").update(payload).eq("operation_id", operation).eq("id", listId);
    if (isUniqueViolation(error)) {
      await redirect("/logistica/separacao?mensagem=Ja+existe+uma+atualizacao+em+andamento");
    }
    if (error) throw error;
  } else {
    const { data, error } = await admin.from("logistica_picking_listas").insert(payload).select("id").single();
    if (isUniqueViolation(error)) {
      await redirect("/logistica/separacao?mensagem=Ja+existe+uma+atualizacao+em+andamento");
    }
    if (error) throw error;
    listId = String(data.id);
  }

  try {
    await triggerWorker({ listId, syncOrders: true, lookbackDays: 3, advanceCursor: true, sendWhatsapp: false });
  } catch (error) {
    await markFailed(listId, error);
    await redirect(`/logistica/separacao?erro=${encodeURIComponent(messageOf(error))}`);
  }
  await revalidatePath("/logistica/separacao");
  await redirect("/logistica/separacao?mensagem=Atualizacao+iniciada");
}

export async function createCustomSeparation(formData: FormData) {
  const user = await assertTabAccess("logistica");
  const operation = await getRequestOperation();
  if (operation !== "uberlandia") throw new Error("Separação multicanal ainda não está disponível nesta operação.");
  const start = localInputToIso(formData.get("start"));
  const end = localInputToIso(formData.get("end"));
  const validation = validateCustomSeparationWindow(start, end, new Date());
  if (validation) await redirect(`/logistica/separacao?erro=${encodeURIComponent(validation)}`);

  const admin = createSupabaseAdminClient({ operation });
  await expireAbandonedRequests(admin, operation);
  if (await hasActiveRequest(admin, operation)) {
    await redirect("/logistica/separacao?mensagem=Ja+existe+uma+atualizacao+em+andamento");
  }
  const { data, error } = await admin
    .from("logistica_picking_listas")
    .insert({
      operation_id: operation,
      kind: "custom",
      trigger_source: "custom_form",
      status: "pending",
      cursor_start: start,
      cursor_end: end,
      period_start: start,
      period_end: end,
      requested_by: effectiveUserId(user),
      requested_by_email: user.email ?? null,
      whatsapp_status: "not_requested"
    })
    .select("id")
    .single();
  if (isUniqueViolation(error)) {
    await redirect("/logistica/separacao?mensagem=Ja+existe+uma+atualizacao+em+andamento");
  }
  if (error) throw error;

  const listId = String(data.id);
  const lookbackDays = Math.max(1, Math.ceil((Date.now() - Date.parse(start)) / 86_400_000));
  try {
    await triggerWorker({ listId, syncOrders: true, lookbackDays, advanceCursor: false, sendWhatsapp: false });
  } catch (workerError) {
    await markFailed(listId, workerError);
    await redirect(`/logistica/separacao?erro=${encodeURIComponent(messageOf(workerError))}`);
  }
  await revalidatePath("/logistica/separacao");
  await redirect("/logistica/separacao?mensagem=Lista+personalizada+enfileirada");
}

export async function retryCustomSeparation(formData: FormData) {
  await assertTabAccess("logistica");
  const operation = await getRequestOperation();
  if (operation !== "uberlandia") throw new Error("Separação multicanal ainda não está disponível nesta operação.");
  const listId = String(formData.get("list_id") ?? "");
  const admin = createSupabaseAdminClient({ operation });
  await expireAbandonedRequests(admin, operation);
  if (await hasActiveRequest(admin, operation)) {
    await redirect("/logistica/separacao?mensagem=Ja+existe+uma+atualizacao+em+andamento");
  }
  const { data: list, error } = await admin
    .from("logistica_picking_listas")
    .select("id,kind,status,period_start")
    .eq("operation_id", operation)
    .eq("id", listId)
    .maybeSingle();
  if (error) throw error;
  if (!list || list.kind !== "custom" || !["failed", "blocked"].includes(list.status)) {
    await redirect("/logistica/separacao?erro=Esta+lista+nao+pode+ser+reprocessada");
  }
  if (!list) throw new Error("Lista personalizada não encontrada.");
  const { error: updateError } = await admin
    .from("logistica_picking_listas")
    .update({ status: "pending", last_error: null, updated_at: new Date().toISOString() })
    .eq("operation_id", operation)
    .eq("id", listId);
  if (isUniqueViolation(updateError)) {
    await redirect("/logistica/separacao?mensagem=Ja+existe+uma+atualizacao+em+andamento");
  }
  if (updateError) throw updateError;
  const lookbackDays = Math.max(1, Math.ceil((Date.now() - Date.parse(String(list.period_start))) / 86_400_000));
  try {
    await triggerWorker({ listId, syncOrders: true, lookbackDays, advanceCursor: false, sendWhatsapp: false });
  } catch (workerError) {
    await markFailed(listId, workerError);
    await redirect(`/logistica/separacao?erro=${encodeURIComponent(messageOf(workerError))}`);
  }
  await redirect("/logistica/separacao?mensagem=Nova+tentativa+iniciada");
}

export async function printSeparation(formData: FormData) {
  const user = await assertTabAccess("logistica");
  const operation = await getRequestOperation();
  if (operation !== "uberlandia") throw new Error("Separação multicanal ainda não está disponível nesta operação.");
  const listId = String(formData.get("list_id") ?? "");
  const admin = createSupabaseAdminClient({ operation });
  const { data: list, error } = await admin
    .from("logistica_picking_listas")
    .select("id,status")
    .eq("operation_id", operation)
    .eq("id", listId)
    .maybeSingle();
  if (error) throw error;
  if (!list || list.status !== "ready") {
    await redirect("/logistica/separacao?erro=A+lista+ainda+nao+esta+pronta+para+impressao");
  }
  const { error: auditError } = await admin.from("logistica_picking_impressoes").insert({
    operation_id: operation,
    lista_id: listId,
    printed_by: effectiveUserId(user),
    printed_by_email: user.email ?? null
  });
  if (auditError) throw auditError;
  await redirect(`/logistica/separacao/${listId}/imprimir`);
}
