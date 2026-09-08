#!/usr/bin/env node
import { pathToFileURL } from "node:url";

export const DEFAULT_DAYS = 40;
export const DEFAULT_SLICE_DAYS = 14;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value, label) {
  if (!ISO_DATE.test(String(value ?? ""))) {
    throw new Error(`${label} deve usar o formato AAAA-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} é uma data inválida.`);
  }
  return date;
}

function addUtcDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function positiveInteger(value, label, maximum = 1000) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${label} deve ser um inteiro entre 1 e ${maximum}.`);
  }
  return number;
}

function option(argv, name) {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export function createBackfillPlan({ days = DEFAULT_DAYS, start, end, sliceDays = DEFAULT_SLICE_DAYS } = {}) {
  const endDate = parseIsoDate(end ?? new Date().toISOString().slice(0, 10), "--end");
  const explicitStart = start == null ? null : parseIsoDate(start, "--start");
  const totalDays = positiveInteger(days, "--days", 366);
  const chunkDays = positiveInteger(sliceDays, "--slice-days", 14);
  const startDate = explicitStart ?? addUtcDays(endDate, -(totalDays - 1));

  if (startDate > endDate) throw new Error("--start não pode ser posterior a --end.");

  const slices = [];
  for (let cursor = startDate; cursor <= endDate;) {
    let sliceEnd = addUtcDays(cursor, chunkDays - 1);
    if (sliceEnd > endDate) sliceEnd = endDate;
    slices.push({ startDate: iso(cursor), endDate: iso(sliceEnd) });
    cursor = addUtcDays(sliceEnd, 1);
  }

  const inclusiveDays = Math.round((endDate - startDate) / 86_400_000) + 1;
  return { startDate: iso(startDate), endDate: iso(endDate), days: inclusiveDays, sliceDays: chunkDays, slices };
}

export function parseBackfillArgs(argv) {
  const start = option(argv, "start");
  const explicitDays = option(argv, "days");
  if (start && explicitDays) throw new Error("Use --start ou --days; não use os dois juntos.");

  return {
    planOnly: argv.includes("--plan"),
    plan: createBackfillPlan({
      start,
      end: option(argv, "end"),
      days: explicitDays ?? DEFAULT_DAYS,
      sliceDays: option(argv, "slice-days") ?? DEFAULT_SLICE_DAYS
    }),
    // Detalhes exigem uma chamada por pedido/NF. Uma página por invocação
    // manteve 100 pedidos dentro do wall clock; três páginas atingiram 150 s.
    orderPages: positiveInteger(option(argv, "order-pages") ?? 1, "--order-pages", 10),
    invoicePages: positiveInteger(option(argv, "invoice-pages") ?? 1, "--invoice-pages", 10),
    maxInvocations: positiveInteger(option(argv, "max-invocations") ?? 500, "--max-invocations", 2000)
  };
}

export async function runUntilComplete({ name, body, invoke, maxInvocations }) {
  for (let attempt = 1; attempt <= maxInvocations; attempt += 1) {
    const result = await invoke(name, body);
    if (result?.completed === true) return { attempts: attempt, result };
    if (result?.completed !== false) {
      throw new Error(`${name} não informou se o bloco foi concluído.`);
    }
  }
  throw new Error(`${name} excedeu ${maxInvocations} invocações no mesmo bloco.`);
}

async function invokeFunction(base, secret, name, body) {
  const response = await fetch(`${base.replace(/\/$/, "")}/functions/v1/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": secret },
    body: JSON.stringify(body)
  });
  const responseText = await response.text();
  let payload;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = { responseText };
  }
  if (!response.ok || payload?.ok === false) {
    throw new Error(`${name}: HTTP ${response.status} ${responseText}`);
  }
  return payload;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const { planOnly, plan, orderPages, invoicePages, maxInvocations } = parseBackfillArgs(argv);
  console.log(`Giracasa: ${plan.days} dias (${plan.startDate}..${plan.endDate}), ${plan.slices.length} blocos.`);
  for (const slice of plan.slices) console.log(`  ${slice.startDate}..${slice.endDate}`);
  if (planOnly) return plan;

  const base = env.SUPABASE_URL;
  const secret = env.GIRACASA_OLIST_SYNC_JOB_SECRET;
  if (!base || !secret) {
    throw new Error("SUPABASE_URL e GIRACASA_OLIST_SYNC_JOB_SECRET são obrigatórios.");
  }

  const invoke = (name, body) => invokeFunction(base, secret, name, body);
  for (const slice of plan.slices) {
    const common = { ...slice, hydrateDetails: true, resume: true };
    const orders = await runUntilComplete({
      name: "giracasa-olist-sync-orders",
      body: { ...common, maxPages: orderPages },
      invoke,
      maxInvocations
    });
    const invoices = await runUntilComplete({
      name: "giracasa-olist-sync-invoices",
      body: { ...common, maxPages: invoicePages },
      invoke,
      maxInvocations
    });
    console.log(`${slice.startDate}..${slice.endDate} concluído (${orders.attempts} chamada(s) de pedidos; ${invoices.attempts} de NFs).`);
  }
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
