import { createSupabaseUserClient } from "../../lib/supabase/user";

export type Fatura = {
  invoice_number: string;
  process_name: string | null;
  production_start: string | null;
  production_end: string | null;
  bl: string | null;
  container_number: string | null;
  vessel_name: string | null;
  destination: string | null;
  port_arrival: string | null;
  transit_agent: string | null;
  packing_list_yuan: number | null;
  packing_list_usd: number | null;
  packing_list_brl: number | null;
  taxes_brl: number | null;
  total_cash_brl: number | null;
  transfer_invoice: string | null;
  origin: string;
  source_first_row: number | null;
  updated_at: string | null;
};

export type Item = {
  id: number;
  invoice_number: string;
  description: string;
  quantity: number | null;
  unit_cost_yuan: number | null;
  unit_cost_with_tax_brl: number | null;
  cartons: number | null;
  quantity_per_carton: number | null;
  cbm: number | null;
  cbm_total: number | null;
  source_row: number | null;
};

export type Navio = {
  name: string;
  aliases: string[];
  imo: string | null;
  mmsi: string | null;
};

export type Posicao = {
  mmsi: string;
  vessel_name: string | null;
  latitude: number;
  longitude: number;
  speed_knots: number | null;
  observed_at: string | null;
};

/** Dados serializáveis enviados ao componente client do mapa. */
export type MapVessel = {
  name: string;
  manualNames: string[];
  imo: string | null;
  mmsi: string | null;
  latitude: number | null;
  longitude: number | null;
  speedKnots: number | null;
  observedAt: string | null;
  destinations: string[];
  nextArrival: string | null;
  invoiceNumbers: string[];
  items: { description: string; quantity: number | null }[];
};

export async function loadImportacoes() {
  const supabase = await createSupabaseUserClient();

  const [faturasResponse, itensResponse, naviosResponse, posicoesResponse] = await Promise.all([
    supabase
      .from("importacao_faturas")
      .select("*")
      .order("port_arrival", { ascending: true, nullsFirst: false }),
    supabase.from("importacao_itens").select("*").order("source_row", { ascending: true }),
    supabase.from("importacao_navios").select("name, aliases, imo, mmsi"),
    supabase.from("importacao_posicoes").select("mmsi, vessel_name, latitude, longitude, speed_knots, observed_at")
  ]);

  if (faturasResponse.error) throw faturasResponse.error;
  if (itensResponse.error) throw itensResponse.error;
  if (naviosResponse.error) throw naviosResponse.error;
  if (posicoesResponse.error) throw posicoesResponse.error;

  return {
    faturas: (faturasResponse.data ?? []) as Fatura[],
    itens: (itensResponse.data ?? []) as Item[],
    navios: (naviosResponse.data ?? []) as Navio[],
    posicoes: (posicoesResponse.data ?? []) as Posicao[]
  };
}

function normalizeName(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

/**
 * Agrupa as faturas por navio, resolve IMO/MMSI pelo registro (nome ou alias,
 * como no buildFleet do MVP local) e anexa a última posição AIS conhecida.
 */
export function buildMapVessels(
  faturas: Fatura[],
  itens: Item[],
  navios: Navio[],
  posicoes: Posicao[]
): MapVessel[] {
  const registryByName = new Map<string, Navio>();
  for (const navio of navios) {
    registryByName.set(normalizeName(navio.name), navio);
    for (const alias of navio.aliases ?? []) {
      registryByName.set(normalizeName(alias), navio);
    }
  }

  const positionByMmsi = new Map(posicoes.map((posicao) => [posicao.mmsi, posicao]));
  const itensByInvoice = new Map<string, Item[]>();
  for (const item of itens) {
    const list = itensByInvoice.get(item.invoice_number) ?? [];
    list.push(item);
    itensByInvoice.set(item.invoice_number, list);
  }

  const groups = new Map<string, { registry: Navio | null; manualNames: Set<string>; faturas: Fatura[] }>();
  for (const fatura of faturas) {
    const manualName = normalizeName(fatura.vessel_name);
    if (!manualName) continue;
    const registry = registryByName.get(manualName) ?? null;
    const key = registry ? `registry:${normalizeName(registry.name)}` : `manual:${manualName}`;
    const group = groups.get(key) ?? { registry, manualNames: new Set<string>(), faturas: [] };
    group.manualNames.add(fatura.vessel_name as string);
    group.faturas.push(fatura);
    groups.set(key, group);
  }

  const today = new Date().toISOString().slice(0, 10);

  const vessels = Array.from(groups.values()).map((group) => {
    const mmsi = group.registry?.mmsi ?? null;
    const position = mmsi ? positionByMmsi.get(mmsi) ?? null : null;
    const destinations = Array.from(
      new Set(group.faturas.map((fatura) => fatura.destination).filter((value): value is string => Boolean(value)))
    );
    const arrivals = Array.from(
      new Set(group.faturas.map((fatura) => fatura.port_arrival).filter((value): value is string => Boolean(value)))
    ).sort();
    const invoiceNumbers = group.faturas.map((fatura) => fatura.invoice_number);
    const items = invoiceNumbers.flatMap((invoiceNumber) =>
      (itensByInvoice.get(invoiceNumber) ?? []).map((item) => ({
        description: item.description,
        quantity: item.quantity
      }))
    );

    return {
      name: group.registry?.name ?? Array.from(group.manualNames)[0],
      manualNames: Array.from(group.manualNames),
      imo: group.registry?.imo ?? null,
      mmsi,
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
      speedKnots: position?.speed_knots ?? null,
      observedAt: position?.observed_at ?? null,
      destinations,
      nextArrival: arrivals.find((arrival) => arrival >= today) ?? arrivals[arrivals.length - 1] ?? null,
      invoiceNumbers,
      items
    };
  });

  return vessels.sort((a, b) => (a.nextArrival ?? "9999").localeCompare(b.nextArrival ?? "9999"));
}
