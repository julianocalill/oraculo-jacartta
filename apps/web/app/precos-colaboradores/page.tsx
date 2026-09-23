import { requireTabAccess } from "../../lib/auth/access";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { AppShell } from "../components/app-shell";
import { NoAccess } from "../components/no-access";
import { OperationForm } from "../components/operation-provider";
import { SortableTable, type SortableCell } from "../components/sortable-table";
import { EMPLOYEE_PRICE_PRODUCTS, EMPLOYEE_PRICE_UPDATED_AT } from "./data";

export const dynamic = "force-dynamic";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const updatedAt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
  new Date(`${EMPLOYEE_PRICE_UPDATED_AT}T12:00:00Z`)
);

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

export default async function EmployeePricesPage({ searchParams }: { searchParams?: Promise<{ q?: string | string[] }> }) {
  const [{ allowed }, alertCount] = await Promise.all([
    requireTabAccess("precos-colaboradores"),
    loadActionableAlertCount()
  ]);
  if (!allowed) return <NoAccess tab="precos-colaboradores" />;

  const params = searchParams ? await searchParams : {};
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = normalize(rawQuery ?? "");
  const codeCounts = new Map<number, number>();
  for (const [code] of EMPLOYEE_PRICE_PRODUCTS) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);

  const products = EMPLOYEE_PRICE_PRODUCTS.filter(([code, product]) =>
    !query || normalize(`${code} ${product}`).includes(query)
  );
  const rows: SortableCell[][] = products.map(([code, product, priceCents]) => [
    { text: String(code), sort: code },
    {
      text: product,
      sort: product,
      subtitle: (codeCounts.get(code) ?? 0) > 1 ? "Código repetido na planilha de origem" : undefined
    },
    { text: money.format(priceCents / 100), sort: priceCents }
  ]);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Pessoas · benefício interno</p>
          <h1>Preços para colaboradores</h1>
          <p>Consulte o valor dos produtos disponíveis para compra interna.</p>
        </div>
        <span className="pill">Atualizado em {updatedAt}</span>
      </header>

      <section className="panel product-panel">
        <div className="sku-toolbar">
          <div>
            <p className="eyebrow">Catálogo</p>
            <h2>Produtos e valores</h2>
          </div>
          <div className="sku-actions">
            <strong>{products.length} {products.length === 1 ? "item" : "itens"}</strong>
            <span>{EMPLOYEE_PRICE_PRODUCTS.length} na tabela vigente</span>
          </div>
        </div>

        <OperationForm className="filter-form filter-row employee-price-filter" action="/precos-colaboradores">
          <label>
            <span>Buscar produto</span>
            <input name="q" type="search" defaultValue={rawQuery ?? ""} placeholder="Nome ou código" />
          </label>
          <button type="submit">Buscar</button>
        </OperationForm>

        <p className="employee-price-note">Os preços reproduzem a planilha vigente. Em caso de divergência ou código repetido, confirme o valor com o responsável antes da compra.</p>

        <SortableTable
          columns={[
            { label: "Código", numeric: true },
            { label: "Produto" },
            { label: "Preço para colaborador", numeric: true }
          ]}
          rows={rows}
          initialSort={1}
          initialDir="asc"
        />
      </section>
    </AppShell>
  );
}
