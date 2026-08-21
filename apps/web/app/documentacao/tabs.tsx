import Link from "next/link";

// Sub-abas da Documentação, no padrão de ImportacoesTabs/DevolucoesTabs.
const TABS = [
  { key: "visao", label: "Visão geral", href: "/documentacao" },
  { key: "conectar", label: "Conectar BI", href: "/documentacao/conectar" },
  { key: "dicionario", label: "Dicionário de dados", href: "/documentacao/dicionario" },
  { key: "funcoes", label: "Funções (RPC)", href: "/documentacao/funcoes" },
  { key: "receitas", label: "Receitas de SQL", href: "/documentacao/receitas" },
  { key: "armadilhas", label: "Armadilhas", href: "/documentacao/armadilhas" }
] as const;

export type DocTabKey = (typeof TABS)[number]["key"];

export function DocumentacaoTabs({ active }: { active: DocTabKey }) {
  return (
    <div className="pill-row" style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
      {TABS.map((tab) => (
        <Link key={tab.key} href={tab.href} className={active === tab.key ? "pill pill-gold" : "pill"}>
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
