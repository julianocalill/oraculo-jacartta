import Link from "next/link";

// Navegação entre as abas do canal Mercado Livre
export function MlTabs({ active }: { active: "visao" | "envio" }) {
  return (
    <div className="pill-row" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      <Link href="/mercado-livre" className={active === "visao" ? "pill pill-gold" : "pill"}>
        Visão geral
      </Link>
      <Link href="/mercado-livre/envio" className={active === "envio" ? "pill pill-gold" : "pill"}>
        Sugestão de envio Full
      </Link>
    </div>
  );
}
