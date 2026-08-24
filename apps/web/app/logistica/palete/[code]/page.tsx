import { formatLabelLine, loadPaleteByCode } from "../../data";

export const dynamic = "force-dynamic";

const quantityFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

/** Ficha pública do palete — destino do QR Code impresso na etiqueta. */
export default async function PaletePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const palete = await loadPaleteByCode(String(code ?? "").trim().toUpperCase());

  if (!palete) {
    return (
      <main className="palete-publico">
        <section className="panel">
          <p className="eyebrow">Logística · Oráculo</p>
          <h1>Palete não encontrado</h1>
          <p>Confira o código impresso embaixo do QR: {code}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="palete-publico">
      <section className="panel">
        <header className="palete-publico-head">
          <div>
            <p className="eyebrow">Logística · Oráculo</p>
            <h1>{palete.product_label}</h1>
            <p>{palete.product_sku ? `SKU ${palete.product_sku} · ` : ""}Palete {palete.code}</p>
          </div>
        </header>

        <div className="section-head">
          <h2>Conteúdo do palete</h2>
        </div>

        <ul className="palete-linhas">
          {palete.itens.map((item) => (
            <li key={item.position}>
              {formatLabelLine(palete.product_label, item.variation_label, item.quantity)}
            </li>
          ))}
        </ul>

        <dl className="palete-dados">
          <div>
            <dt>SKU</dt>
            <dd>{palete.product_sku ?? "—"}</dd>
          </div>
          <div>
            <dt>Nota fiscal</dt>
            <dd>{palete.invoice_number ?? "—"}</dd>
          </div>
          <div>
            <dt>Caixas por palete</dt>
            <dd>{palete.boxes_per_pallet == null ? "—" : quantityFormatter.format(palete.boxes_per_pallet)}</dd>
          </div>
          <div>
            <dt>Qtd Unidade</dt>
            <dd>{palete.unit_quantity == null ? "—" : quantityFormatter.format(palete.unit_quantity)}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
