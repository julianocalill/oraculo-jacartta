"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type SkuTableRow = {
  source: string | null;
  sku: string | null;
  product_name: string | null;
  status_label: string | null;
  units_30d: number | null;
  revenue_30d: number | null;
  revenue_change_pct: number | null;
  available_stock: number | null;
  days_until_stockout: number | null;
  margin_rate_30d: number | null;
  roi_30d: number | null;
  margin_signal: string | null;
  fiscalMarginRate: number | null;
  fiscalRoi: number | null;
};

function n(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(n(value));
}
function count(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR").format(n(value));
}
function stock(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  const current = n(value);
  if (current <= 0) return "Sem estoque";
  return count(current);
}
function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(value);
}
function coverage(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  if (value <= 0) return "Sem estoque";
  if (value > 999) return "999d+";
  return `${Math.round(value)}d`;
}
function sourceLabel(value: string | null | undefined) {
  if (value === "shopee") return "Shopee";
  if (value === "olist") return "Olist";
  return "Outros";
}
function marginSignalLabel(value: string | null | undefined) {
  if (value === "saudavel") return "Saudável";
  if (value === "atencao") return "Atenção";
  if (value === "critico") return "Crítico";
  if (value === "sem_custo") return "Sem custo";
  if (value === "configurar_parametros") return "Configurar";
  if (value === "sem_venda") return "Sem venda";
  return "Pendente";
}
function marginSignalClass(value: string | null | undefined) {
  if (value === "saudavel") return "signal-good";
  if (value === "atencao") return "signal-warning";
  if (value === "critico") return "signal-danger";
  return "signal-muted";
}

function ticket(row: SkuTableRow) {
  return n(row.revenue_30d) / Math.max(n(row.units_30d), 1);
}

type SortKey =
  | "source" | "sku" | "product_name" | "status_label"
  | "revenue_30d" | "units_30d" | "ticket" | "margin_rate_30d" | "roi_30d"
  | "fiscalMarginRate" | "fiscalRoi" | "margin_signal"
  | "revenue_change_pct" | "available_stock" | "days_until_stockout";

type Column = {
  key: SortKey;
  label: string;
  numeric: boolean;
  value: (row: SkuTableRow) => number | string | null;
};

// Colunas ordenáveis (o valor `value` é o que ordena; a renderização é feita no corpo).
const COLUMNS: Column[] = [
  { key: "source", label: "Fonte", numeric: false, value: (r) => sourceLabel(r.source) },
  { key: "sku", label: "SKU", numeric: false, value: (r) => r.sku },
  { key: "product_name", label: "Produto", numeric: false, value: (r) => r.product_name },
  { key: "status_label", label: "Status", numeric: false, value: (r) => r.status_label },
  { key: "revenue_30d", label: "Receita", numeric: true, value: (r) => r.revenue_30d },
  { key: "units_30d", label: "Un.", numeric: true, value: (r) => r.units_30d },
  { key: "ticket", label: "Ticket", numeric: true, value: (r) => ticket(r) },
  { key: "margin_rate_30d", label: "Margem", numeric: true, value: (r) => r.margin_rate_30d },
  { key: "roi_30d", label: "ROI", numeric: true, value: (r) => r.roi_30d },
  { key: "fiscalMarginRate", label: "Margem fiscal", numeric: true, value: (r) => r.fiscalMarginRate },
  { key: "fiscalRoi", label: "ROI fiscal", numeric: true, value: (r) => r.fiscalRoi },
  { key: "margin_signal", label: "Status margem", numeric: false, value: (r) => marginSignalLabel(r.margin_signal) },
  { key: "revenue_change_pct", label: "Var.", numeric: true, value: (r) => r.revenue_change_pct },
  { key: "available_stock", label: "Estoque", numeric: true, value: (r) => r.available_stock },
  { key: "days_until_stockout", label: "Cobertura", numeric: true, value: (r) => r.days_until_stockout }
];

function compare(a: number | string | null, b: number | string | null, dir: "asc" | "desc") {
  // Nulos sempre por último, independente da direção.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  let r: number;
  if (typeof a === "number" && typeof b === "number") r = a - b;
  else r = String(a).localeCompare(String(b), "pt-BR", { numeric: true });
  return dir === "asc" ? r : -r;
}

export function SkuTable({ rows, source }: { rows: SkuTableRow[]; source: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("revenue_30d");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col) return rows;
    return rows
      .map((row, i) => ({ row, i }))
      .sort((x, y) => {
        const r = compare(col.value(x.row), col.value(y.row), dir);
        return r !== 0 ? r : x.i - y.i; // estável
      })
      .map((x) => x.row);
  }, [rows, sortKey, dir]);

  function onSort(col: Column) {
    if (col.key === sortKey) {
      setDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(col.key);
      setDir(col.numeric ? "desc" : "asc"); // números começam do maior; texto A→Z
    }
  }

  return (
    <div className="table-wrap dense-table-wrap">
      <table className="data-table dense-table">
        <thead>
          <tr>
            <th>#</th>
            {COLUMNS.map((col) => {
              const active = col.key === sortKey;
              return (
                <th key={col.key} className={col.numeric ? "numeric" : undefined}>
                  <button
                    type="button"
                    className={`th-sort${active ? " is-active" : ""}`}
                    onClick={() => onSort(col)}
                    aria-label={`Ordenar por ${col.label}`}
                  >
                    <span>{col.label}</span>
                    <span className="th-caret" aria-hidden="true">
                      {active ? (dir === "desc" ? "▼" : "▲") : "↕"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={`${row.source}-${row.sku ?? row.product_name}`}>
              <td className="rank-cell">{index + 1}</td>
              <td>{sourceLabel(row.source)}</td>
              <td>{row.sku || "-"}</td>
              <td>
                <Link
                  className="row-link"
                  href={`/skus?source=${encodeURIComponent(source)}&sku=${encodeURIComponent(row.sku ?? "")}`}
                >
                  {row.product_name ?? "Sem nome"}
                </Link>
              </td>
              <td>{row.status_label ?? "-"}</td>
              <td className="numeric">{money(row.revenue_30d)}</td>
              <td className="numeric">{count(row.units_30d)}</td>
              <td className="numeric">{money(ticket(row))}</td>
              <td className="numeric">{percent(row.margin_rate_30d)}</td>
              <td className="numeric">{percent(row.roi_30d)}</td>
              <td className="numeric">{row.fiscalMarginRate == null ? "-" : percent(row.fiscalMarginRate)}</td>
              <td className="numeric">{row.fiscalRoi == null ? "-" : percent(row.fiscalRoi)}</td>
              <td>
                <span className={`status-pill ${marginSignalClass(row.margin_signal)}`}>
                  {marginSignalLabel(row.margin_signal)}
                </span>
              </td>
              <td className="numeric trend-value">{percent(row.revenue_change_pct)}</td>
              <td className="numeric">{stock(row.available_stock)}</td>
              <td className="numeric">{coverage(row.days_until_stockout)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
