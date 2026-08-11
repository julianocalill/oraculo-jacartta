import Link from "next/link";

// Navegação entre as abas de Logística
export function LogisticaTabs({ active }: { active: "etiqueta" }) {
  return (
    <div className="pill-row" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      <Link href="/logistica/etiqueta" className={active === "etiqueta" ? "pill pill-gold" : "pill"}>
        Etiqueta
      </Link>
    </div>
  );
}
