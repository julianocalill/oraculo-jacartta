import Link from "next/link";

// Uma aba por canal, no padrão de ImportacoesTabs. Só aparecem canais que têm
// dado no período: aba vazia de canal não integrado é ruído, e pior, sugere
// que o canal não devolve nada.
export function DevolucoesTabs({
  active,
  month,
  channels
}: {
  active: string;
  month: string;
  channels: { key: string; label: string; count: number }[];
}) {
  const tabs = [{ key: "todos", label: "Todos os canais", count: null as number | null }, ...channels];

  return (
    <div className="pill-row" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={`/devolucoes?mes=${month}&canal=${tab.key}`}
          className={active === tab.key ? "pill pill-gold" : "pill"}
        >
          {tab.label}
          {tab.count != null ? (
            <span className="pill-count">{new Intl.NumberFormat("pt-BR").format(tab.count)}</span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
