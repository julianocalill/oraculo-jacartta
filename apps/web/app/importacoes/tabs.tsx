import Link from "next/link";

// Navegação entre as abas de Importações
export function ImportacoesTabs({ active }: { active: "mapa" | "cadastro" }) {
  return (
    <div className="pill-row" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
      <Link href="/importacoes" className={active === "mapa" ? "pill pill-gold" : "pill"}>
        Mapa e embarques
      </Link>
      <Link href="/importacoes/cadastro" className={active === "cadastro" ? "pill pill-gold" : "pill"}>
        Cadastro
      </Link>
    </div>
  );
}
