"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { IntelligencePayload, IntelligenceProduct, MarketAction } from "./data";

type Block = "radar" | "produto" | "concorrentes" | "preco";
type Competitor = {
  id: string;
  name: string;
  price: number | null;
  sales: number | null;
  rating: number | null;
  reviews: number | null;
  movement: string;
  status?: string;
};

const BLOCKS: Array<{ key: Block; number: string; label: string; caption: string }> = [
  { key: "radar", number: "01", label: "Radar de Ações", caption: "O que merece atenção agora" },
  { key: "produto", number: "02", label: "Produto 360", caption: "Diagnóstico completo por anúncio" },
  { key: "concorrentes", number: "03", label: "Concorrentes", caption: "Sinais externos demonstrativos" },
  { key: "preco", number: "04", label: "Precificação", caption: "Simulação com custo real" }
];

const ACTION_LABELS: Record<MarketAction | "todos", string> = {
  todos: "Todas",
  repor: "Repor",
  reprecificar: "Reprecificar",
  acelerar: "Acelerar",
  liquidar: "Liquidar",
  investigar: "Investigar"
};

function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function number(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);
}

function pct(value: number) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function compactName(value: string) {
  return value.length > 74 ? `${value.slice(0, 71)}…` : value;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

function needsAction(product: IntelligenceProduct) {
  return product.priority >= 60;
}

function actionTone(action: MarketAction) {
  if (action === "reprecificar" || action === "liquidar") return "danger";
  if (action === "repor" || action === "investigar") return "warning";
  return "good";
}

function competitorsFor(product: IntelligenceProduct): Competitor[] {
  return [
    { id: "c1", name: "Casa & Ordem Oficial", price: product.price * 0.94, sales: Math.max(42, Math.round(product.sold30 * 1.42)), rating: 4.8, reviews: 2840, movement: "▲ 18% em 30 dias" },
    { id: "c2", name: "Mundo Prático", price: product.price * 0.99, sales: Math.max(31, Math.round(product.sold30 * 1.08)), rating: 4.7, reviews: 1630, movement: "Estável" },
    { id: "c3", name: "Loja Essencial BR", price: product.price * 1.06, sales: Math.max(18, Math.round(product.sold30 * 0.74)), rating: 4.9, reviews: 904, movement: "▼ 6% em 30 dias" }
  ];
}

function TrendBars({ values }: { values: [number, number, number, number] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="market-trend" aria-label={`Últimas quatro semanas: ${values.join(", ")}`}>
      {values.map((value, index) => (
        <i key={index} style={{ height: `${Math.max(8, (value / max) * 100)}%` }} />
      ))}
    </div>
  );
}

export function IntelligenceDashboard({ payload }: { payload: IntelligencePayload }) {
  const [block, setBlock] = useState<Block>("radar");
  const [selectedId, setSelectedId] = useState(payload.products[0]?.id ?? "");
  const [actionFilter, setActionFilter] = useState<MarketAction | "todos">("todos");
  const [searchQuery, setSearchQuery] = useState("");
  const [monitorUrl, setMonitorUrl] = useState("");
  const [localMonitors, setLocalMonitors] = useState<Competitor[]>([]);

  const selected = payload.products.find((product) => product.id === selectedId) ?? payload.products[0];
  const filtered = useMemo(
    () => payload.products.filter((product) => actionFilter === "todos" || product.action === actionFilter),
    [actionFilter, payload.products]
  );
  const normalizedQuery = normalizeSearch(searchQuery);
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return [];
    return payload.products
      .map((product) => {
        const sku = normalizeSearch(product.sku);
        const name = normalizeSearch(product.name);
        const variation = normalizeSearch(product.variation ?? "");
        const shop = normalizeSearch(product.shop);
        const matches = sku.includes(normalizedQuery)
          || name.includes(normalizedQuery)
          || variation.includes(normalizedQuery)
          || shop.includes(normalizedQuery);
        const score = sku === normalizedQuery ? 0
          : sku.startsWith(normalizedQuery) ? 1
          : name.startsWith(normalizedQuery) ? 2
          : variation.startsWith(normalizedQuery) ? 3
          : 4;
        return { product, matches, score };
      })
      .filter((row) => row.matches)
      .sort((a, b) => a.score - b.score || b.product.priority - a.product.priority || a.product.name.localeCompare(b.product.name, "pt-BR"))
      .slice(0, 8)
      .map((row) => row.product);
  }, [normalizedQuery, payload.products]);
  const externalCompetitors = useMemo(() => competitorsFor(selected), [selected]);
  const competitors = [...externalCompetitors, ...localMonitors];
  const competitorPrices = externalCompetitors.flatMap((row) => (row.price === null ? [] : [row.price]));
  const competitorMedian = competitorPrices.slice().sort((a, b) => a - b)[Math.floor(competitorPrices.length / 2)] ?? selected.price;

  const effectiveBurden = selected.price > 0
    ? Math.min(0.78, Math.max(0.05, (selected.price - selected.totalCost - selected.profitUnit) / selected.price))
    : 0.35;
  const breakEven = selected.totalCost / Math.max(0.05, 1 - effectiveBurden);
  const priceMin = Math.max(1, Math.floor(Math.min(selected.price * 0.82, breakEven * 0.98) * 2) / 2);
  const priceMax = Math.ceil(Math.max(selected.price * 1.22, competitorMedian * 1.12) * 2) / 2;
  const [simulatedPrice, setSimulatedPrice] = useState(selected.price);

  useEffect(() => setSimulatedPrice(selected.price), [selected.id, selected.price]);

  const simulatedProfit = simulatedPrice * (1 - effectiveBurden) - selected.totalCost;
  const simulatedMargin = simulatedPrice > 0 ? (simulatedProfit / simulatedPrice) * 100 : 0;
  const monthlyImpact = (simulatedProfit - selected.profitUnit) * selected.sold30;
  const urgent = payload.products.filter((product) => product.priority >= 80).length;
  const lowCoverage = payload.products.filter((product) => product.coverageDays !== null && product.coverageDays < 12).length;
  const opportunity = payload.products.reduce(
    (sum, product) => product.action === "liquidar" ? sum : sum + Math.max(0, product.opportunityValue),
    0,
  );

  function addLocalMonitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = monitorUrl.trim();
    if (!value || !value.toLowerCase().includes("shopee")) return;
    setLocalMonitors((current) => [
      ...current,
      {
        id: `local-${current.length + 1}`,
        name: `Novo monitor ${current.length + 1}`,
        price: null,
        sales: null,
        rating: null,
        reviews: null,
        movement: "Primeira coleta pendente",
        status: "Simulação local · não salvo"
      }
    ]);
    setMonitorUrl("");
  }

  function openSearchedProduct(product: IntelligenceProduct) {
    setSelectedId(product.id);
    setBlock("produto");
    setSearchQuery("");
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searchResults[0]) openSearchedProduct(searchResults[0]);
  }

  return (
    <>
      <header className="topbar market-topbar">
        <div>
          <p className="eyebrow">Comercial · MVP localhost</p>
          <h1>Inteligência de Mercado</h1>
          <p>Da oportunidade à ação: mercado externo combinado com margem, vendas e estoque do Oráculo.</p>
        </div>
        <div className="market-source-legend" aria-label="Origem dos dados">
          <span className={payload.internalSource === "real" ? "is-real" : "is-demo"}>
            <i /> Interno: {payload.internalSource === "real" ? "dados reais" : "demonstração"}
          </span>
          <span className="is-demo"><i /> Externo: demonstração</span>
        </div>
      </header>

      <section className="market-block-nav" aria-label="Blocos da primeira versão">
        {BLOCKS.map((item) => (
          <button key={item.key} type="button" className={block === item.key ? "is-active" : ""} onClick={() => setBlock(item.key)} aria-pressed={block === item.key}>
            <b>{item.number}</b>
            <span><strong>{item.label}</strong><small>{item.caption}</small></span>
          </button>
        ))}
      </section>

      <section className="panel market-product-search" aria-label="Buscar produto para analisar">
        <div className="market-search-copy">
          <p className="eyebrow">Consulta rápida</p>
          <h2>Este produto precisa de ação?</h2>
          <p>Busque por SKU, nome, variação ou loja e abra o diagnóstico completo.</p>
        </div>
        <form className="market-search-form" onSubmit={submitSearch} role="search">
          <label htmlFor="market-product-query">Produto</label>
          <div>
            <input
              id="market-product-query"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Ex.: 213169, cabide, panela…"
              autoComplete="off"
            />
            <button type="submit" disabled={searchResults.length === 0}>Analisar</button>
          </div>
          <small aria-live="polite">
            {normalizedQuery
              ? searchResults.length > 0
                ? `${searchResults.length} ${searchResults.length === 1 ? "resultado encontrado" : "resultados encontrados"}`
                : "Nenhum produto encontrado"
              : "Digite ao menos parte do SKU ou do nome."}
          </small>
        </form>
        {normalizedQuery ? (
          <div className="market-search-results" aria-label="Resultados da busca">
            {searchResults.map((product) => {
              const actionable = needsAction(product);
              return (
                <button key={product.id} type="button" onClick={() => openSearchedProduct(product)}>
                  <span className="market-product-name">
                    <strong>{compactName(product.name)}</strong>
                    <small>{product.shop} · SKU {product.sku}{product.variation ? ` · ${product.variation}` : ""}</small>
                  </span>
                  <span className={`market-search-status ${actionable ? actionTone(product.action) : "good"}`}>
                    <strong>{actionable ? "Precisa de ação" : "Sem ação imediata"}</strong>
                    <small>{actionable ? product.actionLabel : "Acompanhar"}</small>
                  </span>
                  <span className="market-search-reason">{product.reason}</span>
                  <span className="market-row-arrow">›</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="market-summary-grid" aria-label="Resumo">
        <article><span>Ações urgentes</span><strong>{urgent}</strong><small>prejuízo, ruptura ou estoque parado</small></article>
        <article><span>Oportunidade mapeada</span><strong>{brl(opportunity)}</strong><small>impacto indicativo dos produtos exibidos</small></article>
        <article><span>Cobertura crítica</span><strong>{lowCoverage}</strong><small>produtos abaixo de 12 dias</small></article>
        <article><span>Concorrentes</span><strong>{competitors.length}</strong><small>{localMonitors.length ? `${localMonitors.length} incluído localmente` : "cenário demonstrativo"}</small></article>
      </section>

      {block === "radar" ? (
        <section className="panel market-panel">
          <div className="market-panel-head">
            <div><p className="eyebrow">Prioridade executiva</p><h2>Radar de ações</h2><p>Recomendações calculadas com preço, custo, venda e estoque disponíveis.</p></div>
            <div className="market-filter-row">
              {(Object.keys(ACTION_LABELS) as Array<MarketAction | "todos">).map((key) => (
                <button key={key} type="button" className={actionFilter === key ? "is-active" : ""} onClick={() => setActionFilter(key)}>{ACTION_LABELS[key]}</button>
              ))}
            </div>
          </div>
          <div className="market-action-list">
            {filtered.slice(0, 14).map((product) => (
              <button key={product.id} type="button" className="market-action-row" onClick={() => { setSelectedId(product.id); setBlock("produto"); }}>
                <span className={`market-action-badge ${actionTone(product.action)}`}>{product.actionLabel}</span>
                <span className="market-product-name"><strong>{compactName(product.name)}</strong><small>{product.shop} · SKU {product.sku}{product.variation ? ` · ${product.variation}` : ""}</small></span>
                <span className="market-action-reason">{product.reason}</span>
                <span className="market-action-metrics">
                  <strong>{brl(product.opportunityValue)}</strong>
                  <small>{product.action === "liquidar" ? "capital em estoque" : "impacto indicativo"}</small>
                </span>
                <TrendBars values={product.trend} />
                <span className="market-row-arrow">›</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {block === "produto" ? (
        <section className="market-two-column">
          <article className="panel market-panel market-product-hero">
            <div className="market-panel-head">
              <div><p className="eyebrow">Produto 360</p><h2>{selected.name}</h2><p>{selected.shop} · SKU {selected.sku}{selected.variation ? ` · ${selected.variation}` : ""}</p></div>
              <select value={selected.id} onChange={(event) => setSelectedId(event.target.value)} aria-label="Escolher produto">
                {payload.products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.shop}</option>)}
              </select>
            </div>
            <div className="market-product-kpis">
              <div><span>Preço atual</span><strong>{brl(selected.price)}</strong></div>
              <div><span>Margem estimada</span><strong className={selected.marginPct < 0 ? "is-negative" : ""}>{pct(selected.marginPct)}</strong></div>
              <div><span>Vendas 30 dias</span><strong>{number(selected.sold30)}</strong></div>
              <div><span>Estoque</span><strong>{number(selected.stock)}</strong></div>
              <div><span>Cobertura</span><strong>{selected.coverageDays === null ? "—" : `${Math.round(selected.coverageDays)} dias`}</strong></div>
              <div><span>Lucro por venda</span><strong className={selected.profitUnit < 0 ? "is-negative" : ""}>{brl(selected.profitUnit)}</strong></div>
            </div>
            <div className={`market-recommendation ${actionTone(selected.action)}`}>
              <span>{selected.actionLabel}</span>
              <div><strong>{selected.reason}</strong><small>Recomendação automática do protótipo; valide antes de executar.</small></div>
            </div>
          </article>

          <aside className="panel market-panel market-context-panel">
            <p className="eyebrow">Leitura combinada</p>
            <h2>Contexto da decisão</h2>
            <div className="market-context-list">
              <div><span>Receita 30 dias</span><strong>{brl(selected.revenue30)}</strong></div>
              <div>
                <span>Custo líquido por venda</span>
                <strong>{brl(selected.totalCost)}</strong>
                <small>
                  livro canônico · <a href={`/parametros?secao=custos&q=${encodeURIComponent(selected.sku)}`}>conferir em Parâmetros</a>
                </small>
              </div>
              <div><span>Tendência</span><strong>{selected.trendText}</strong></div>
              <div><span>Preço mediano externo</span><strong>{brl(competitorMedian)}</strong><small>demonstração</small></div>
            </div>
            <TrendBars values={selected.trend} />
            <button type="button" className="market-primary-button" onClick={() => setBlock("preco")}>Simular novo preço</button>
          </aside>
        </section>
      ) : null}

      {block === "concorrentes" ? (
        <section className="panel market-panel">
          <div className="market-panel-head">
            <div><p className="eyebrow">Fonte externa ainda não conectada</p><h2>Monitor de concorrentes</h2><p>Dados abaixo são demonstrativos. O cadastro local serve apenas para testar o fluxo.</p></div>
            <select value={selected.id} onChange={(event) => setSelectedId(event.target.value)} aria-label="Produto usado na comparação">
              {payload.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </div>
          <form className="market-monitor-form" onSubmit={addLocalMonitor}>
            <label><span>Link de produto ou loja Shopee</span><input type="url" value={monitorUrl} onChange={(event) => setMonitorUrl(event.target.value)} placeholder="https://shopee.com.br/..." /></label>
            <button type="submit">Simular cadastro</button>
            <small>Não consulta a Shopee e não grava no banco nesta primeira versão.</small>
          </form>
          <div className="market-competitor-table" role="table" aria-label="Concorrentes monitorados">
            <div className="market-competitor-row is-head" role="row"><span>Loja</span><span>Preço</span><span>Venda aparente</span><span>Avaliação</span><span>Movimento</span></div>
            {competitors.map((row) => (
              <div className="market-competitor-row" role="row" key={row.id}>
                <span><strong>{row.name}</strong><small>{row.status ?? "Monitor demonstrativo"}</small></span>
                <span><strong>{row.price === null ? "—" : brl(row.price)}</strong></span>
                <span><strong>{row.sales === null ? "—" : number(row.sales)}</strong><small>estimada · 30 dias</small></span>
                <span><strong>{row.rating === null ? "—" : row.rating.toLocaleString("pt-BR")}</strong><small>{row.reviews === null ? "aguardando" : `${number(row.reviews)} avaliações`}</small></span>
                <span><strong>{row.movement}</strong></span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {block === "preco" ? (
        <section className="market-two-column market-price-layout">
          <article className="panel market-panel">
            <div className="market-panel-head">
              <div><p className="eyebrow">Precificação competitiva</p><h2>Simule sem perder a margem</h2><p>{selected.name} · {selected.shop}</p></div>
              <select value={selected.id} onChange={(event) => setSelectedId(event.target.value)} aria-label="Escolher produto para simular">
                {payload.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </div>
            <div className="market-price-control">
              <div className="market-price-value"><span>Novo preço</span><strong>{brl(simulatedPrice)}</strong></div>
              <input type="range" min={priceMin} max={priceMax} step="0.5" value={simulatedPrice} onChange={(event) => setSimulatedPrice(Number(event.target.value))} aria-label="Novo preço simulado" />
              <div className="market-range-labels"><span>{brl(priceMin)}</span><span>{brl(priceMax)}</span></div>
              <div className="market-quick-prices">
                <button type="button" onClick={() => setSimulatedPrice(selected.price)}>Atual</button>
                <button type="button" onClick={() => setSimulatedPrice(Number(competitorMedian.toFixed(2)))}>Mediana externa</button>
                <button type="button" onClick={() => setSimulatedPrice(Number((breakEven * 1.12).toFixed(2)))}>Margem de segurança</button>
              </div>
            </div>
          </article>

          <aside className="panel market-panel market-price-result">
            <p className="eyebrow">Resultado da simulação</p>
            <div className="market-price-comparison">
              <div><span>Lucro atual</span><strong>{brl(selected.profitUnit)}</strong></div>
              <div><span>Novo lucro</span><strong className={simulatedProfit < 0 ? "is-negative" : "is-positive"}>{brl(simulatedProfit)}</strong></div>
              <div><span>Nova margem</span><strong className={simulatedMargin < 0 ? "is-negative" : ""}>{pct(simulatedMargin)}</strong></div>
              <div><span>Impacto em 30 dias</span><strong className={monthlyImpact < 0 ? "is-negative" : "is-positive"}>{monthlyImpact >= 0 ? "+" : ""}{brl(monthlyImpact)}</strong></div>
            </div>
            <div className="market-price-benchmarks">
              <div><span>Equilíbrio estimado</span><strong>{brl(breakEven)}</strong></div>
              <div><span>Mediana concorrente</span><strong>{brl(competitorMedian)}</strong><small>demonstração externa</small></div>
            </div>
            <p className="market-method-note">Simulação usa a carga efetiva de taxas do preço atual. É um cenário indicativo, não o cálculo fiscal histórico.</p>
          </aside>
        </section>
      ) : null}
    </>
  );
}
