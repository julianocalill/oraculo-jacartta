const TIME_ZONE = "America/Sao_Paulo";
const OFFSET = "-03:00";

function brtParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function previousDate(localDate) {
  const noon = Date.parse(`${localDate}T12:00:00${OFFSET}`);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(noon - 86_400_000));
}

/** Fechamento que ja deveria estar pronto, considerando 15 min de tolerancia. */
export function expectedSeparationSlot(now = new Date()) {
  const parts = brtParts(now);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);

  if (minutes >= 13 * 60 + 45) {
    return {
      slotKey: `${today}-1330`,
      slot: "1330",
      localDate: today,
      scheduledAt: `${today}T13:30:00${OFFSET}`
    };
  }
  if (minutes >= 7 * 60 + 15) {
    return {
      slotKey: `${today}-0700`,
      slot: "0700",
      localDate: today,
      scheduledAt: `${today}T07:00:00${OFFSET}`
    };
  }

  const yesterday = previousDate(today);
  return {
    slotKey: `${yesterday}-1330`,
    slot: "1330",
    localDate: yesterday,
    scheduledAt: `${yesterday}T13:30:00${OFFSET}`
  };
}

export function officialSeparationPeriod(slot) {
  if (!slot || !/^\d{4}-\d{2}-\d{2}-(0700|1330)$/.test(slot.slotKey)) {
    throw new Error("Slot oficial invalido.");
  }
  if (slot.slot === "0700") {
    const prior = previousDate(slot.localDate);
    return {
      start: `${prior}T14:00:00${OFFSET}`,
      end: `${slot.localDate}T06:30:00${OFFSET}`
    };
  }
  return {
    start: `${slot.localDate}T07:00:00${OFFSET}`,
    end: `${slot.localDate}T13:30:00${OFFSET}`
  };
}

export function separationFreshness(expectedSlot, officialList) {
  if (!officialList || officialList.slot_key !== expectedSlot.slotKey) {
    return { state: "stale", reason: "O fechamento esperado ainda nao foi gerado." };
  }
  if (officialList.status === "ready") return { state: "ready", reason: null };
  if (["pending", "syncing", "processing"].includes(officialList.status)) {
    return { state: "processing", reason: "Atualizacao em andamento." };
  }
  if (officialList.status === "blocked") {
    return { state: "stale", reason: officialList.last_error || "A lista foi bloqueada por dados incompletos." };
  }
  return { state: "stale", reason: officialList.last_error || "A ultima tentativa falhou." };
}

export function validateCustomSeparationWindow(start, end, now = new Date()) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return "Informe inicio e fim validos.";
  if (endMs <= startMs) return "O fim precisa ser posterior ao inicio.";
  if (endMs > now.getTime() + 60_000) return "O fim nao pode estar no futuro.";
  if (endMs - startMs > 7 * 86_400_000) return "O periodo personalizado pode ter no maximo 7 dias.";
  return null;
}
