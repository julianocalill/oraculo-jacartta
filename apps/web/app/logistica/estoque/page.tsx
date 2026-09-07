import Link from "next/link";
import { requireTabAccess } from "../../../lib/auth/access";
import { NoAccess } from "../../components/no-access";
import { AppShell } from "../../components/app-shell";
import { loadActionableAlertCount } from "../../../lib/alert-count";
import { SortableTable, type SortableCell, type SortableColumn } from "../../components/sortable-table";
import { LogisticaTabs } from "../tabs";
import { filterItems, loadEstoqueData, type DepositBucket } from "./data";

export const dynamic = "force-dynamic";

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function count(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(n(value));
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(n(value));
}

function signalLabel(signal: string | null) {
  const labels: Record<string, string> = {
    ruptura: "Ruptura",
    ruptura_iminente: "Ruptura iminente",
    parado: "Parado",
    sem_venda: "Sem venda",
    sem_estoque_mapeado: "Sem estoque mapeado",
    ok: "OK"
  };
  return labels[signal ?? ""] ?? "-";
}

function signalBadge(signal: string | null) {
  if (signal === "ruptura") return "status-pill signal-danger";
  if (signal === "ruptura_iminente") return "status-pill signal-warning";
  if (signal === "parado" || signal === "sem_venda") return "status-pill signal-muted";
  return "status-pill signal-good";
}

function bucketCell(bucket: DepositBucket | undefined): SortableCell {
  const value = bucket ? n(bucket.disponivel) : 0;
  if (!bucket || (value === 0 && n(bucket.saldo) === 0 && n(bucket.reservado) === 0)) {
    return { text: "-", sort: null };
  }
  const reserved = n(bucket.reservado);
  return {
    text: count(value),
    sort: value,
    subtitle: reserved > 0 ? `${count(reserved)} res.` : undefined
  };
}

export default async function LogisticaEstoquePage({
  searchParams
}: {
  searchParams?: Promise<{ deposito?: string; sinal?: string; q?: string }>;
}) {
  const params = await searchParams;
  const filters = {
    deposito: params?.deposito ?? "all",
    sinal: params?.sinal ?? "all",
    busca: params?.q ?? ""
  };

  const [{ allowed }, alertCount, data] = await Promise.all([
    requireTabAccess("logistica"),
    loadActionableAlertCount(),
    loadEstoqueData()
  ]);
  if (!allowed) return <NoAccess tab="logistica" />;

  const visible = filterItems(data.items, filters);
  const visibleDisponivel = visible.reduce((sum, item) => sum + n(item.disponivel), 0);
  const visibleCapital = visible.reduce((sum, item) => sum + n(item.capital_custo), 0);

  const exportParams = new URLSearchParams();
  if (filters.deposito !== "all") exportParams.set("deposito", filters.deposito);
  if (filters.sinal !== "all") exportParams.set("sinal", filters.sinal);
  if (filters.busca) exportParams.set("q", filters.busca);
  const exportHref = exportParams.size > 0
    ? `/logistica/estoque/export?${exportParams.toString()}`
    : "/logistica/estoque/export";

  const columns: SortableColumn[] = [
    { label: "Produto" },
    { label: "Sinal" },
    { label: "Disponível", numeric: true, hint: "Saldo disponível consolidado do ERP (depósitos marcados como \"desconsiderar\" ficam fora)." },
    ...data.depositColumns.map((deposito) => ({
      label: deposito.nome,
      numeric: true as const,
      hint: `Disponível no depósito ${deposito.nome}. "res." indica quantidade reservada.`
    })),
    { label: "Custo unit.", numeric: true, hint: "Custo unitário canônico (oraculo_sku_unit_cost): override manual > custo do ERP > custo efetivo de kit." },
    { label: "Capital", numeric: true, hint: "Disponível × custo unitário. Vazio quando o SKU está sem custo resolvido." }
  ];

  const rows = visible.map((item) => [
    {
      text: item.nome ?? "Sem nome",
      sort: item.nome ?? null,
      subtitle: item.sku ?? undefined,
      href: `/skus?source=olist&sku=${encodeURIComponent(item.sku ?? "")}`
    },
    item.stock_signal
      ? { text: signalLabel(item.stock_signal), sort: item.stock_signal, badge: signalBadge(item.stock_signal) }
      : { text: "-", sort: null },
    { text: count(item.disponivel), sort: item.disponivel ?? null },
    ...data.depositColumns.map((deposito) => bucketCell(item.porDeposito[deposito.id])),
    item.unit_cost != null
      ? { text: money(item.unit_cost), sort: item.unit_cost }
      : { text: "Sem custo", sort: null, badge: "status-pill signal-muted" },
    { text: item.capital_custo != null ? money(item.capital_custo) : "-", sort: item.capital_custo ?? null }
  ]);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Estoque por depósito</h1>
          <p>Onde o estoque está: saldo do ERP quebrado por depósito, com sinal de ruptura e capital a custo</p>
        </div>
        <form className="filter-row filter-form" method="get">
          <label>
            <span>Depósito</span>
            <select name="deposito" defaultValue={filters.deposito}>
              <option value="all">Todos</option>
              {data.depositColumns.map((deposito) => (
                <option key={deposito.id} value={deposito.id}>{deposito.nome}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Sinal</span>
            <select name="sinal" defaultValue={filters.sinal}>
              <option value="all">Todos</option>
              <option value="ruptura">Ruptura</option>
              <option value="ruptura_iminente">Ruptura iminente</option>
              <option value="parado">Parado</option>
              <option value="sem_venda">Sem venda</option>
            </select>
          </label>
          <label>
            <span>Buscar</span>
            <input type="text" name="q" defaultValue={filters.busca} placeholder="SKU ou nome" />
          </label>
          <button type="submit">Aplicar</button>
          <Link className="button-link" href={exportHref}>Exportar</Link>
        </form>
      </header>

      <LogisticaTabs active="estoque" />

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-blue">
          <span className="label">Produtos exibidos</span>
          <strong>{count(visible.length)}</strong>
          <small>de {count(data.totals.produtos)} ativos no ERP</small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Disponível no filtro</span>
          <strong>{count(visibleDisponivel)}</strong>
          <small>unidades disponíveis</small>
        </article>
        <article className="metric accent-emerald">
          <span className="label">Capital a custo</span>
          <strong>
            {new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
              notation: "compact",
              maximumFractionDigits: 1
            }).format(n(visibleCapital))}
          </strong>
          <small>{count(data.totals.semCusto)} produtos com estoque sem custo</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Rupturas</span>
          <strong>{count(data.totals.ruptura)}</strong>
          <small>{count(data.totals.rupturaIminente)} em ruptura iminente</small>
        </article>
      </section>

      <section className="panel product-panel">
        <div className="section-head section-row">
          <div>
            <p className="eyebrow">Estoque Olist por depósito</p>
            <h2>{filters.deposito === "all" ? "Todos os depósitos" : data.depositColumns.find((d) => d.id === filters.deposito)?.nome ?? "Depósito"}</h2>
          </div>
          <span className="pill">Sync a cada 30 min · varredura completa ~16h</span>
        </div>
        <SortableTable columns={columns} initialSort={2} initialDir="desc" rows={rows} />
      </section>
    </AppShell>
  );
}
