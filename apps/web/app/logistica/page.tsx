import Link from "next/link";
import { requireTabAccess } from "../../lib/auth/access";
import { NoAccess } from "../components/no-access";
import { AppShell } from "../components/app-shell";
import { loadActionableAlertCount } from "../../lib/alert-count";
import { LogisticaTabs } from "./tabs";
import { loadEstoqueData } from "./estoque/data";

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

function moneyCompact(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1
  }).format(n(value));
}

function tipoLabel(tipo: string | null) {
  const labels: Record<string, string> = {
    proprio: "Próprio",
    full_ml: "Full ML",
    full_shopee: "Full Shopee",
    terceiro: "Terceiro"
  };
  return labels[tipo ?? ""] ?? "Sem tipo";
}

export default async function LogisticaPage() {
  const [{ allowed }, alertCount, data] = await Promise.all([
    requireTabAccess("logistica"),
    loadActionableAlertCount(),
    loadEstoqueData()
  ]);
  if (!allowed) return <NoAccess tab="logistica" />;

  const maxCapital = Math.max(...data.depositSummaries.map((deposito) => deposito.capitalCusto), 1);

  return (
    <AppShell alertCount={alertCount}>
      <header className="topbar">
        <div>
          <h1>Logística</h1>
          <p>Visão do depósito: capital em estoque, onde ele está e o que pede atenção</p>
        </div>
      </header>

      <LogisticaTabs active="visao-geral" />

      <section className="metric-grid metric-grid-eight">
        <article className="metric accent-emerald">
          <span className="label">Capital em estoque</span>
          <strong>{moneyCompact(data.totals.capitalCusto)}</strong>
          <small>{money(data.totals.capitalCusto)} · disponível × custo canônico</small>
        </article>
        <article className="metric accent-blue">
          <span className="label">Unidades disponíveis</span>
          <strong>{count(data.totals.disponivel)}</strong>
          <small>{count(data.totals.reservado)} reservadas</small>
        </article>
        <article className="metric accent-red">
          <span className="label">Rupturas</span>
          <strong>{count(data.totals.ruptura)}</strong>
          <small>
            <Link href="/logistica/estoque?sinal=ruptura">ver produtos</Link>
          </small>
        </article>
        <article className="metric accent-yellow">
          <span className="label">Ruptura iminente</span>
          <strong>{count(data.totals.rupturaIminente)}</strong>
          <small>
            <Link href="/logistica/estoque?sinal=ruptura_iminente">ver produtos</Link>
          </small>
        </article>
      </section>

      <section className="control-grid">
        <article className="panel curve-panel">
          <div className="section-head section-row">
            <div>
              <p className="eyebrow">Capital por depósito</p>
              <h2>Onde o estoque está</h2>
            </div>
            <span className="pill">a custo unitário</span>
          </div>
          <div className="horizontal-curve-chart" aria-label="Capital em estoque por depósito">
            {data.depositSummaries.map((deposito) => {
              const width = Math.max((deposito.capitalCusto / maxCapital) * 100, deposito.capitalCusto > 0 ? 2 : 0);
              return (
                <div className="horizontal-curve-row" key={deposito.id}>
                  <div className="horizontal-curve-label">
                    <strong>{deposito.nome}</strong>
                    <span>{tipoLabel(deposito.tipo)} · {count(deposito.produtos)} produtos</span>
                  </div>
                  <div className="horizontal-curve-track">
                    <i style={{ width: `${width}%` }} />
                  </div>
                  <div className="horizontal-curve-values">
                    <strong>{money(deposito.capitalCusto)}</strong>
                    <span>{count(deposito.disponivel)} un.</span>
                  </div>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel curve-panel">
          <div className="section-head section-row">
            <div>
              <p className="eyebrow">Área logística</p>
              <h2>Atalhos</h2>
            </div>
          </div>
          <div className="quick-links">
            <p>
              <Link href="/logistica/estoque">Estoque por depósito</Link> — saldo do ERP quebrado por
              depósito, sinal de ruptura e capital a custo. {count(data.totals.semCusto)} produtos com
              estoque ainda sem custo resolvido.
            </p>
            <p>
              <Link href="/logistica/etiqueta">Etiqueta de palete</Link> — gera a etiqueta A4 horizontal
              com QR Code para rastrear paletes no galpão.
            </p>
            <p>
              <Link href="/expedicao">Expedição Shopee</Link> — funil operacional por pacote e
              rastreio (Shopee × Bip). <Link href="/importacoes">Importações</Link> — embarques e
              navios em rota.
            </p>
          </div>
        </article>
      </section>
    </AppShell>
  );
}
