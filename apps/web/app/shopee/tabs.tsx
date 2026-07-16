import Link from "next/link";

// Filtro por loja em "abas" (pills), preservando os demais parâmetros da URL
export function LojaPills({
  shops,
  active,
  basePath,
  extraParams = {}
}: {
  shops: { shop_id: number; shop_name: string | null }[];
  active: number | null;
  basePath: string;
  extraParams?: Record<string, string | number>;
}) {
  const href = (lojaId: number | null) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(extraParams)) params.set(key, String(value));
    if (lojaId) params.set("loja", String(lojaId));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  return (
    <div className="pill-row" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
      <Link href={href(null)} className={active === null ? "pill pill-gold" : "pill"}>
        Todas as lojas
      </Link>
      {shops.map((shop) => (
        <Link
          key={shop.shop_id}
          href={href(shop.shop_id)}
          className={active === shop.shop_id ? "pill pill-gold" : "pill"}
        >
          {shop.shop_name ?? shop.shop_id}
        </Link>
      ))}
    </div>
  );
}

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
