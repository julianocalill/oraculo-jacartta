import { OperationLink as Link } from "../../../../components/operation-provider";
import { requireTabAccess } from "../../../../../lib/auth/access";
import { loadPickingList } from "../../data";
import { PrintTrigger } from "../../../etiqueta/imprimir/print-trigger";

export const dynamic = "force-dynamic";

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});
const numberFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

export default async function PrintSeparationPage({ params }: { params: Promise<{ id: string }> }) {
  const { allowed } = await requireTabAccess("logistica");
  if (!allowed) return <p style={{ padding: 24 }}>Sem acesso à aba Logística.</p>;
  const { id } = await params;
  const data = await loadPickingList(id);
  if (!data || data.list.status !== "ready") {
    return <main style={{ padding: 24 }}><p>Lista não encontrada ou ainda não está pronta.</p><Link href="/logistica/separacao">Voltar</Link></main>;
  }

  const { list, items } = data;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @page { size: A4 portrait; margin: 12mm; }
        body { background: #fff !important; color: #000 !important; margin: 0; font-family: Arial, Helvetica, sans-serif; }
        .separation-print-toolbar { display: flex; gap: 14px; padding: 14px; color: #111; font: 14px system-ui, sans-serif; }
        .separation-print-toolbar a { color: #111; }
        .separation-document { color: #000; padding: 0 12mm 12mm; }
        .separation-document h1 { font-size: 21px; margin: 0 0 4px; }
        .separation-document .meta { font-size: 11px; margin: 0 0 12px; }
        .separation-document table { width: 100%; border-collapse: collapse; font-size: 9px; }
        .separation-document th, .separation-document td { border: 1px solid #777; padding: 5px 6px; text-align: left; vertical-align: top; }
        .separation-document th { background: #eee; font-weight: 700; }
        .separation-document td.num, .separation-document th.num { text-align: right; white-space: nowrap; }
        .separation-document tbody tr { break-inside: avoid; page-break-inside: avoid; }
        .separation-document thead { display: table-header-group; }
        .separation-empty { border: 1px solid #777; padding: 18px; font-size: 13px; }
        @media print {
          .separation-print-toolbar { display: none; }
          .separation-document { padding: 0; }
        }
      ` }} />
      <div className="separation-print-toolbar"><Link href="/logistica/separacao">← Voltar</Link><span>A caixa de impressão abrirá automaticamente; Ctrl+P também funciona.</span></div>
      <main className="separation-document">
        <h1>Lista de separação — todos os marketplaces</h1>
        <p className="meta">
          Período: {dateTimeFormatter.format(new Date(list.period_start))} até {dateTimeFormatter.format(new Date(list.period_end))}
          {list.slot_key ? ` · fechamento ${list.slot_key}` : " · período personalizado"}
          {` · ${numberFormatter.format(list.orders_count)} pedidos · ${numberFormatter.format(list.rows_count)} linhas`}
        </p>
        {items.length === 0 ? <div className="separation-empty">Nenhum SKU atingiu o mínimo de duas caixas neste fechamento.</div> : (
          <table>
            <thead><tr><th>#</th><th>SKU</th><th>Produto</th><th>Descritivo</th><th className="num">Itens vendidos</th><th className="num">Caixas</th><th className="num">Unidades avulsas</th></tr></thead>
            <tbody>{items.map((item) => <tr key={item.position}><td>{item.position}</td><td>{item.sku ?? "—"}</td><td>{item.product}</td><td>{item.description}</td><td className="num">{numberFormatter.format(item.sold_quantity)}</td><td className="num">{numberFormatter.format(item.boxes)}</td><td className="num">{numberFormatter.format(item.loose_units)}</td></tr>)}</tbody>
          </table>
        )}
      </main>
      <PrintTrigger />
    </>
  );
}
