import Link from "next/link";

// Navegação entre as abas de Logística
export type LogisticaTab = "visao-geral" | "estoque" | "recebimento" | "etiqueta";

const TABS: Array<{ key: LogisticaTab; href: string; label: string }> = [
  { key: "visao-geral", href: "/logistica", label: "Visão geral" },
  { key: "estoque", href: "/logistica/estoque", label: "Estoque" },
  { key: "recebimento", href: "/logistica/recebimento", label: "Recebimento" },
  { key: "etiqueta", href: "/logistica/etiqueta", label: "Etiqueta" }
];

export function LogisticaTabs({ active }: { active: LogisticaTab }) {
  return (
    <div className="pill-row" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      {TABS.map((tab) => (
        <Link key={tab.key} href={tab.href} className={active === tab.key ? "pill pill-gold" : "pill"}>
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
