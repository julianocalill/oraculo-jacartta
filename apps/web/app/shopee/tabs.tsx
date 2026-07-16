import Link from "next/link";

// Navegação entre as abas do canal Shopee
export function ShopeeTabs({ active }: { active: "takerate" | "estoque" | "reposicao" }) {
  return (
    <div className="pill-row" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      <Link href="/shopee" className={active === "takerate" ? "pill pill-gold" : "pill"}>
        Take Rate
      </Link>
      <Link href="/shopee/estoque" className={active === "estoque" ? "pill pill-gold" : "pill"}>
        Estoque &amp; FBS
      </Link>
      <Link href="/shopee/reposicao" className={active === "reposicao" ? "pill pill-gold" : "pill"}>
        Sugestão de reposição
      </Link>
    </div>
  );
}
