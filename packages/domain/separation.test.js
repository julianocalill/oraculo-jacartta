import test from "node:test";
import assert from "node:assert/strict";

import {
  expectedSeparationSlot,
  officialSeparationPeriod,
  separationFreshness,
  validateCustomSeparationWindow
} from "./separation.js";

test("usa o fechamento anterior antes das 07:15 BRT", () => {
  assert.equal(expectedSeparationSlot(new Date("2026-09-09T10:14:59Z")).slotKey, "2026-09-08-1330");
});

test("passa a esperar 07:00 exatamente as 07:15 BRT", () => {
  assert.equal(expectedSeparationSlot(new Date("2026-09-09T10:15:00Z")).slotKey, "2026-09-09-0700");
});

test("passa a esperar 13:30 exatamente as 13:45 BRT", () => {
  assert.equal(expectedSeparationSlot(new Date("2026-09-09T16:45:00Z")).slotKey, "2026-09-09-1330");
});

test("resolve o periodo operacional exibido para cada slot", () => {
  assert.deepEqual(officialSeparationPeriod(expectedSeparationSlot(new Date("2026-09-09T10:15:00Z"))), {
    start: "2026-09-08T14:00:00-03:00",
    end: "2026-09-09T06:30:00-03:00"
  });
  assert.deepEqual(officialSeparationPeriod(expectedSeparationSlot(new Date("2026-09-09T16:45:00Z"))), {
    start: "2026-09-09T07:00:00-03:00",
    end: "2026-09-09T13:30:00-03:00"
  });
});

test("considera pronto apenas o slot esperado e com status ready", () => {
  const expected = expectedSeparationSlot(new Date("2026-09-09T17:00:00Z"));
  assert.equal(separationFreshness(expected, { slot_key: "2026-09-09-1330", status: "ready" }).state, "ready");
  assert.equal(separationFreshness(expected, { slot_key: "2026-09-09-0700", status: "ready" }).state, "stale");
  assert.equal(separationFreshness(expected, { slot_key: "2026-09-09-1330", status: "processing" }).state, "processing");
});

test("limita periodo personalizado a sete dias e ao passado", () => {
  const now = new Date("2026-09-09T18:00:00Z");
  assert.equal(validateCustomSeparationWindow("2026-09-02T18:00:00Z", "2026-09-09T18:00:00Z", now), null);
  assert.match(validateCustomSeparationWindow("2026-09-01T17:59:00Z", "2026-09-09T18:00:00Z", now), /7 dias/);
  assert.match(validateCustomSeparationWindow("2026-09-09T18:00:00Z", "2026-09-09T18:02:00Z", now), /futuro/);
});
