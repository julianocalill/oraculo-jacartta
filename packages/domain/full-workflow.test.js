import assert from "node:assert/strict";
import test from "node:test";
import {
  assertFullTransition,
  canTransitionFull,
  fullNumber,
  nextBusinessDay,
  productionStatus,
  shouldAcceptExternalStatus
} from "./full-workflow.js";

test("próximo dia útil ignora sábado e domingo", () => {
  assert.equal(nextBusinessDay("2026-09-11"), "2026-09-14");
  assert.equal(nextBusinessDay("2026-09-14"), "2026-09-15");
});

test("máquina de estados impede atalhos e estados terminais", () => {
  assert.equal(canTransitionFull("rascunho", "aguardando_logistica"), true);
  assert.equal(canTransitionFull("rascunho", "monitorando"), false);
  assert.equal(canTransitionFull("concluido", "monitorando"), false);
  assert.throws(() => assertFullTransition("rascunho", "concluido"), /Transição inválida/);
});

test("todas as transições operacionais permitidas estão explícitas", () => {
  const allowed = new Set([
    "rascunho>aguardando_logistica", "rascunho>cancelado",
    "aguardando_logistica>aguardando_criador", "aguardando_logistica>cancelado", "aguardando_logistica>excecao",
    "aguardando_criador>aguardando_logistica", "aguardando_criador>aguardando_agendamento", "aguardando_criador>cancelado", "aguardando_criador>excecao",
    "aguardando_agendamento>aguardando_logistica", "aguardando_agendamento>monitorando", "aguardando_agendamento>cancelado", "aguardando_agendamento>excecao",
    "monitorando>concluido", "monitorando>cancelado", "monitorando>excecao",
    "excecao>aguardando_logistica", "excecao>aguardando_agendamento", "excecao>monitorando", "excecao>cancelado"
  ]);
  const statuses = ["rascunho", "aguardando_logistica", "aguardando_criador", "aguardando_agendamento", "monitorando", "concluido", "cancelado", "excecao"];
  for (const from of statuses) {
    for (const to of statuses) {
      assert.equal(canTransitionFull(from, to), allowed.has(`${from}>${to}`), `${from} → ${to}`);
    }
  }
});

test("produção é derivada de quantidade pronta e falta", () => {
  assert.equal(productionStatus([{ requiredQty: 10, readyQty: 0, shortageQty: 0 }]), "nao_iniciada");
  assert.equal(productionStatus([{ requiredQty: 10, readyQty: 3, shortageQty: 0 }]), "em_producao");
  assert.equal(productionStatus([{ requiredQty: 10, readyQty: 10, shortageQty: 0 }]), "pronta");
  assert.equal(productionStatus([{ requiredQty: 10, readyQty: 8, shortageQty: 2 }]), "com_falta");
});

test("evento externo atrasado não regride remessa", () => {
  assert.equal(shouldAcceptExternalStatus("em_transito", "coletado"), false);
  assert.equal(shouldAcceptExternalStatus("coletado", "recebendo"), true);
  assert.equal(shouldAcceptExternalStatus("recebido", "recebendo"), false);
  assert.equal(shouldAcceptExternalStatus("cancelado", "recebido"), false);
  assert.equal(shouldAcceptExternalStatus("agendado", "desconhecido"), true);
  assert.equal(shouldAcceptExternalStatus("desconhecido", "coletado"), true);
});

test("número humano do Full é estável", () => {
  assert.equal(fullNumber(42), "FULL-000042");
});
