import test from "node:test";
import assert from "node:assert/strict";
import { createBackfillPlan, parseBackfillArgs, runUntilComplete } from "./giracasa-backfill.mjs";

test("carga Giracasa usa 40 dias inclusivos e blocos de até 14 dias", () => {
  const plan = createBackfillPlan({ end: "2026-09-08" });
  assert.equal(plan.days, 40);
  assert.deepEqual(plan.slices, [
    { startDate: "2026-07-31", endDate: "2026-08-13" },
    { startDate: "2026-08-14", endDate: "2026-08-27" },
    { startDate: "2026-08-28", endDate: "2026-09-08" }
  ]);
});

test("janela explícita pode retomar de uma data sem ampliar a carga", () => {
  const { plan } = parseBackfillArgs(["--start=2026-08-20", "--end=2026-09-08", "--plan"]);
  assert.equal(plan.days, 20);
  assert.equal(plan.slices.at(-1).endDate, "2026-09-08");
});

test("start e days juntos são rejeitados", () => {
  assert.throws(
    () => parseBackfillArgs(["--start=2026-08-20", "--days=40"]),
    /não use os dois/
  );
});

test("orquestrador retoma chamadas limitadas até a Edge Function concluir", async () => {
  const completions = [false, false, true];
  const calls = [];
  const result = await runUntilComplete({
    name: "giracasa-olist-sync-orders",
    body: { startDate: "2026-08-01", endDate: "2026-08-14" },
    maxInvocations: 4,
    invoke: async (name, body) => {
      calls.push({ name, body });
      return { completed: completions.shift() };
    }
  });
  assert.equal(result.attempts, 3);
  assert.equal(calls.length, 3);
});

test("orquestrador interrompe um bloco que nunca termina", async () => {
  await assert.rejects(
    runUntilComplete({
      name: "giracasa-olist-sync-invoices",
      body: {},
      maxInvocations: 2,
      invoke: async () => ({ completed: false })
    }),
    /excedeu 2 invocações/
  );
});
