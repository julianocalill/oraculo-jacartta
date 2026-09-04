#!/usr/bin/env node
const base = process.env.SUPABASE_URL;
const secret = process.env.GIRACASA_OLIST_SYNC_JOB_SECRET;
if (!base || !secret) throw new Error("SUPABASE_URL e GIRACASA_OLIST_SYNC_JOB_SECRET são obrigatórios.");
const end = new Date();
const first = new Date(end); first.setUTCDate(first.getUTCDate() - 89);
const iso = (d) => d.toISOString().slice(0, 10);
async function run(fn, body) {
  const response = await fetch(`${base.replace(/\/$/, "")}/functions/v1/${fn}`, { method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": secret }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`${fn}: HTTP ${response.status} ${await response.text()}`);
}
// 14 days also satisfies Shopee's stricter window if the same slices are reused.
for (let cursor = first; cursor <= end;) {
  const sliceEnd = new Date(cursor); sliceEnd.setUTCDate(sliceEnd.getUTCDate() + 13);
  if (sliceEnd > end) sliceEnd.setTime(end.getTime());
  const body = { startDate: iso(cursor), endDate: iso(sliceEnd), maxPages: 1000, hydrateDetails: true };
  await run("giracasa-olist-sync-orders", body);
  await run("giracasa-olist-sync-invoices", body);
  console.log(`${body.startDate}..${body.endDate} concluído`);
  cursor = new Date(sliceEnd); cursor.setUTCDate(cursor.getUTCDate() + 1);
}
