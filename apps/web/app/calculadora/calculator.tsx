"use client";

import { useMemo, useState } from "react";

// Porte fiel da calculadora.oliverhome.com.br (projetos/08-calculadora-marketplace).
// As regras são PRÓPRIAS da calculadora — simplificadas de propósito, um "norte"
// de precificação — e independentes do motor fiscal do Oráculo (que não muda aqui).

const DEFAULT_RATES = {
  icmsMg: 1.3,
  difal: 6,
  pisCofins: 9.25,
  ads: 3,
  fixedOperational: 3,
  averageRefund: 1
};

type RateKey = keyof typeof DEFAULT_RATES;

const RATE_FIELDS: Array<{ key: RateKey; label: string; suffix: "%" | "R$" }> = [
  { key: "icmsMg", label: "ICMS MG", suffix: "%" },
  { key: "difal", label: "DIFAL", suffix: "%" },
  { key: "pisCofins", label: "PIS/COFINS", suffix: "%" },
  { key: "ads", label: "Ads", suffix: "%" },
  { key: "fixedOperational", label: "Custo fixo operacional", suffix: "%" },
  { key: "averageRefund", label: "Reembolso médio (R$)", suffix: "R$" }
];

// Presets de comissão por marketplace. Shopee = faixas originais da calculadora.
// ML e TikTok = taxas públicas vigentes (jul/2026); comissão varia por categoria,
// então tudo continua editável na tela. Último degrau é sempre faixa aberta.
type MarketplaceKey = "shopee" | "meliClassico" | "meliPremium" | "tiktok";

const MARKETPLACE_PRESETS: Record<
  MarketplaceKey,
  { label: string; note: string; tiers: Array<{ max: number; rate: number; fixed: number }> }
> = {
  shopee: {
    label: "Shopee",
    note: "Faixas originais da calculadora (comissão + fixo por faixa de preço).",
    tiers: [
      { max: 79.99, rate: 20, fixed: 4 },
      { max: 99.99, rate: 14, fixed: 16 },
      { max: 199.99, rate: 14, fixed: 20 },
      { max: 499.99, rate: 14, fixed: 26 },
      { max: Infinity, rate: 14, fixed: 28 }
    ]
  },
  meliClassico: {
    label: "ML Clássico",
    note: "Comissão 10–14% conforme categoria (padrão 13% — ajuste para a sua) + custo fixo por unidade até R$ 78,99. Itens abaixo de R$ 12,50 pagam 50% do item como tarifa (não modelado).",
    tiers: [
      { max: 28.99, rate: 13, fixed: 6.25 },
      { max: 49.99, rate: 13, fixed: 6.5 },
      { max: 78.99, rate: 13, fixed: 6.75 },
      { max: Infinity, rate: 13, fixed: 0 }
    ]
  },
  meliPremium: {
    label: "ML Premium",
    note: "Comissão 15–19% conforme categoria (padrão 18% — ajuste para a sua) + custo fixo por unidade até R$ 78,99. Parcelamento sem juros incluso no plano.",
    tiers: [
      { max: 28.99, rate: 18, fixed: 6.25 },
      { max: 49.99, rate: 18, fixed: 6.5 },
      { max: 78.99, rate: 18, fixed: 6.75 },
      { max: Infinity, rate: 18, fixed: 0 }
    ]
  },
  tiktok: {
    label: "TikTok Shop",
    note: "Comissão 5–8% conforme categoria (padrão 6%) + R$ 4,00 fixo por item até R$ 78,99 (vigente fev/2026). Programa de frete SFP (~6%, teto R$ 50) não incluído — some em Ads/custo fixo se usar.",
    tiers: [
      { max: 78.99, rate: 6, fixed: 4 },
      { max: Infinity, rate: 6, fixed: 0 }
    ]
  }
};

const MARKETPLACE_ORDER: MarketplaceKey[] = ["shopee", "meliClassico", "meliPremium", "tiktok"];

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const percentFmt = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const decimalFmt = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function money(value: number) {
  return currency.format(Number.isFinite(value) ? value : 0);
}

function asNumber(value: string) {
  const number = Number.parseFloat(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function formatPercentValue(rate: number) {
  return `${decimalFmt.format(rate * 100)}%`;
}

type Tier = { max: number; rate: number; fixed: number };

function getTierLabel(tier: Tier, tiers: Tier[]) {
  const index = tiers.indexOf(tier);
  const previousMax = index > 0 ? tiers[index - 1].max : 0;
  const range =
    index === 0
      ? `Até ${money(tier.max)}`
      : Number.isFinite(tier.max)
        ? `${money(previousMax + 0.01)} a ${money(tier.max)}`
        : `Acima de ${money(previousMax)}`;
  return `${range}: ${formatPercentValue(tier.rate)} + ${money(tier.fixed)}`;
}

// Cálculo idêntico ao app.js original (calculate()).
function calculate(
  unitCost: number,
  quantity: number,
  mode: "markup" | "price",
  markupInput: number,
  salePriceInput: number,
  rates: { icmsMg: number; difal: number; pisCofins: number; ads: number; fixedOperational: number; averageRefund: number },
  marketplaceTiers: Tier[]
) {
  const totalProductCost = unitCost * quantity;
  const salePrice = mode === "markup" ? totalProductCost * markupInput : salePriceInput;
  const appliedMarkup = totalProductCost > 0 ? salePrice / totalProductCost : 0;
  const addedValue = salePrice - totalProductCost;
  const marketplaceTier =
    marketplaceTiers.find((tier) => salePrice <= tier.max) ?? marketplaceTiers[marketplaceTiers.length - 1];
  const marketplaceVariable = salePrice * marketplaceTier.rate;
  const icmsMg = salePrice * rates.icmsMg;
  const difal = salePrice * rates.difal;
  const pisCofins = addedValue * rates.pisCofins;
  const ads = salePrice * rates.ads;
  const fixedOperational = salePrice * rates.fixedOperational;

  const costs = [
    { name: "Custo dos produtos", basis: `${quantity} un. × ${money(unitCost)}`, value: totalProductCost },
    { name: "Marketplace variável", basis: formatPercentValue(marketplaceTier.rate), value: marketplaceVariable },
    { name: "Marketplace fixo", basis: "Faixa", value: marketplaceTier.fixed },
    { name: "ICMS MG", basis: `${formatPercentValue(rates.icmsMg)} venda`, value: icmsMg },
    { name: "DIFAL", basis: `${formatPercentValue(rates.difal)} venda`, value: difal },
    { name: "PIS/COFINS Lucro Real", basis: `${formatPercentValue(rates.pisCofins)} valor agregado`, value: pisCofins },
    { name: "Ads", basis: `${formatPercentValue(rates.ads)} venda`, value: ads },
    { name: "Custo fixo operacional", basis: `${formatPercentValue(rates.fixedOperational)} venda`, value: fixedOperational },
    { name: "Reembolso médio", basis: "Por pedido", value: rates.averageRefund }
  ];

  const totalCosts = costs.reduce((sum, item) => sum + item.value, 0);
  const netProfit = salePrice - totalCosts;
  const netMargin = salePrice > 0 ? netProfit / salePrice : 0;

  return {
    salePrice,
    totalProductCost,
    appliedMarkup,
    addedValue,
    marketplaceTierLabel: getTierLabel(marketplaceTier, marketplaceTiers),
    costs,
    totalCosts,
    netProfit,
    netMargin
  };
}

const DEFAULT_RATE_STRINGS = Object.fromEntries(
  Object.entries(DEFAULT_RATES).map(([key, value]) => [key, value.toFixed(2)])
) as Record<RateKey, string>;

function tierStringsFor(key: MarketplaceKey) {
  return MARKETPLACE_PRESETS[key].tiers.map((tier) => ({
    max: Number.isFinite(tier.max) ? tier.max.toFixed(2) : "",
    rate: tier.rate.toFixed(2),
    fixed: tier.fixed.toFixed(2)
  }));
}

export function PricingCalculator() {
  const [unitCost, setUnitCost] = useState("50,00");
  const [quantity, setQuantity] = useState("1");
  const [mode, setMode] = useState<"markup" | "price">("markup");
  const [markup, setMarkup] = useState("2,50");
  const [salePrice, setSalePrice] = useState("125,00");
  const [rateStrings, setRateStrings] = useState(DEFAULT_RATE_STRINGS);
  const [marketplace, setMarketplace] = useState<MarketplaceKey>("shopee");
  const [tierStrings, setTierStrings] = useState(() => tierStringsFor("shopee"));

  function selectMarketplace(key: MarketplaceKey) {
    setMarketplace(key);
    setTierStrings(tierStringsFor(key));
  }

  const result = useMemo(() => {
    const rates = {
      icmsMg: Math.max(asNumber(rateStrings.icmsMg), 0) / 100,
      difal: Math.max(asNumber(rateStrings.difal), 0) / 100,
      pisCofins: Math.max(asNumber(rateStrings.pisCofins), 0) / 100,
      ads: Math.max(asNumber(rateStrings.ads), 0) / 100,
      fixedOperational: Math.max(asNumber(rateStrings.fixedOperational), 0) / 100,
      averageRefund: Math.max(asNumber(rateStrings.averageRefund), 0)
    };
    const tiers: Tier[] = tierStrings.map((tier, index) => ({
      max: index === tierStrings.length - 1 ? Infinity : Math.max(asNumber(tier.max), 0),
      rate: Math.max(asNumber(tier.rate), 0) / 100,
      fixed: Math.max(asNumber(tier.fixed), 0)
    }));

    return calculate(
      Math.max(asNumber(unitCost), 0),
      Math.max(Math.floor(asNumber(quantity)), 1),
      mode,
      Math.max(asNumber(markup), 0),
      Math.max(asNumber(salePrice), 0),
      rates,
      tiers
    );
  }, [unitCost, quantity, mode, markup, salePrice, rateStrings, tierStrings]);

  const status =
    result.netProfit < 0
      ? { label: "Prejuízo", className: "signal-danger" }
      : result.netMargin < 0.1
        ? { label: "Margem baixa", className: "signal-warning" }
        : { label: "Rentável", className: "signal-good" };

  function resetRates() {
    setRateStrings(DEFAULT_RATE_STRINGS);
    setTierStrings(tierStringsFor(marketplace));
  }

  return (
    <div className="calc-layout">
      <section className="panel calc-inputs">
        <div className="section-head">
          <p className="eyebrow">Anúncio</p>
          <h2>Dados do produto</h2>
        </div>

        <div className="calc-field-grid">
          <label className="calc-field">
            <span>Custo unitário do produto (R$)</span>
            <input inputMode="decimal" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </label>
          <label className="calc-field">
            <span>Unidades no anúncio</span>
            <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </label>
        </div>

        <div className="calc-mode" role="radiogroup" aria-label="Modo de cálculo">
          <label className={mode === "markup" ? "is-active" : undefined}>
            <input
              type="radio"
              name="calculationMode"
              checked={mode === "markup"}
              onChange={() => setMode("markup")}
            />
            Por markup
          </label>
          <label className={mode === "price" ? "is-active" : undefined}>
            <input
              type="radio"
              name="calculationMode"
              checked={mode === "price"}
              onChange={() => setMode("price")}
            />
            Por preço de venda
          </label>
        </div>

        <div className="calc-field-grid">
          {mode === "markup" ? (
            <label className="calc-field">
              <span>Markup (×)</span>
              <input inputMode="decimal" value={markup} onChange={(e) => setMarkup(e.target.value)} />
            </label>
          ) : (
            <label className="calc-field">
              <span>Preço de venda (R$)</span>
              <input inputMode="decimal" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
            </label>
          )}
        </div>

        <div className="section-head calc-rates-head">
          <div>
            <p className="eyebrow">Taxas editáveis</p>
            <h2>Impostos e custos</h2>
          </div>
          <button type="button" className="calc-reset" onClick={resetRates}>
            Restaurar padrão
          </button>
        </div>

        <div className="calc-field-grid calc-rates-grid">
          {RATE_FIELDS.map((field) => (
            <label className="calc-field" key={field.key}>
              <span>{field.label}{field.suffix === "%" ? " (%)" : ""}</span>
              <input
                inputMode="decimal"
                value={rateStrings[field.key]}
                onChange={(e) => setRateStrings({ ...rateStrings, [field.key]: e.target.value })}
              />
            </label>
          ))}
        </div>

        <div className="section-head calc-rates-head">
          <div>
            <p className="eyebrow">Marketplace</p>
            <h2>Faixas de comissão</h2>
          </div>
        </div>

        <div className="calc-mode calc-marketplace" role="radiogroup" aria-label="Marketplace">
          {MARKETPLACE_ORDER.map((key) => (
            <label key={key} className={marketplace === key ? "is-active" : undefined}>
              <input
                type="radio"
                name="marketplacePreset"
                checked={marketplace === key}
                onChange={() => selectMarketplace(key)}
              />
              {MARKETPLACE_PRESETS[key].label}
            </label>
          ))}
        </div>

        <p className="table-note">{MARKETPLACE_PRESETS[marketplace].note}</p>

        <div className="calc-tiers">
          <div className="calc-tier calc-tier-head" aria-hidden="true">
            <span>Faixa até (R$)</span>
            <span>Taxa (%)</span>
            <span>Fixo (R$)</span>
          </div>
          {tierStrings.map((tier, index) => {
            const isLast = index === tierStrings.length - 1;
            return (
              <div className="calc-tier" key={index}>
                {isLast ? (
                  <span className="calc-tier-open">Acima de {money(asNumber(tierStrings[index - 1].max))}</span>
                ) : (
                  <input
                    inputMode="decimal"
                    value={tier.max}
                    aria-label={`Limite da faixa ${index + 1}`}
                    onChange={(e) =>
                      setTierStrings(tierStrings.map((t, i) => (i === index ? { ...t, max: e.target.value } : t)))
                    }
                  />
                )}
                <input
                  inputMode="decimal"
                  value={tier.rate}
                  aria-label={`Taxa da faixa ${index + 1}`}
                  onChange={(e) =>
                    setTierStrings(tierStrings.map((t, i) => (i === index ? { ...t, rate: e.target.value } : t)))
                  }
                />
                <input
                  inputMode="decimal"
                  value={tier.fixed}
                  aria-label={`Valor fixo da faixa ${index + 1}`}
                  onChange={(e) =>
                    setTierStrings(tierStrings.map((t, i) => (i === index ? { ...t, fixed: e.target.value } : t)))
                  }
                />
              </div>
            );
          })}
        </div>
      </section>

      <div className="calc-results">
        <section className="metric-grid metric-grid-eight calc-metrics">
          <article className="metric accent-yellow">
            <span className="label">Preço de venda</span>
            <strong>{money(result.salePrice)}</strong>
            <small>{result.marketplaceTierLabel}</small>
          </article>
          <article className={`metric ${result.netProfit < 0 ? "accent-red" : "accent-emerald"}`}>
            <span className="label">Lucro líquido</span>
            <strong>{money(result.netProfit)}</strong>
            <small>Após taxas, impostos e custos</small>
          </article>
          <article className="metric accent-violet">
            <span className="label">Margem líquida</span>
            <strong>{percentFmt.format(result.netMargin)}</strong>
            <small>Lucro / preço de venda</small>
          </article>
          <article className="metric accent-blue">
            <span className="label">Markup aplicado</span>
            <strong>{decimalFmt.format(result.appliedMarkup)}×</strong>
            <small>Preço / custo total</small>
          </article>
        </section>

        <section className="panel calc-breakdown">
          <div className="section-head section-row">
            <div>
              <p className="eyebrow">Decomposição</p>
              <h2>Para onde vai o preço</h2>
            </div>
            <span className={`status-pill ${status.className}`}>{status.label}</span>
          </div>

          <div className="calc-rows">
            {result.costs.map((row) => (
              <div className="calc-row" key={row.name}>
                <span className="calc-row-name">{row.name}</span>
                <span className="calc-row-basis">{row.basis}</span>
                <strong>{money(row.value)}</strong>
              </div>
            ))}
            <div className="calc-row calc-row-total">
              <span className="calc-row-name">Custos totais</span>
              <span className="calc-row-basis" />
              <strong>{money(result.totalCosts)}</strong>
            </div>
            <div className="calc-row calc-row-total">
              <span className="calc-row-name">Valor agregado</span>
              <span className="calc-row-basis">Preço − custo dos produtos</span>
              <strong>{money(result.addedValue)}</strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
