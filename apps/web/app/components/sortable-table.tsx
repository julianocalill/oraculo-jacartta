"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// Tabela ordenável genérica. As células chegam serializadas do server
// component (texto + valor de ordenação + extras opcionais), então qualquer
// página consegue usar sem duplicar lógica de ordenação.
export type SortableCell = {
  /** Texto exibido na célula. */
  text: string;
  /** Valor usado para ordenar; null ordena por último em qualquer direção. */
  sort: number | string | null;
  /** Se presente, o texto vira link (row-link). */
  href?: string;
  /** Classe(s) de badge/pill que envolvem o texto (ex.: "status-pill signal-good"). */
  badge?: string;
  /** Linha secundária discreta abaixo do texto (ex.: status do produto). */
  subtitle?: string;
};

export type SortableColumn = {
  label: string;
  numeric?: boolean;
  /** Explicação da coluna, exibida em tooltip ao passar o mouse no cabeçalho. */
  hint?: string;
};

function compare(a: number | string | null, b: number | string | null, dir: "asc" | "desc") {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  let r: number;
  if (typeof a === "number" && typeof b === "number") r = a - b;
  else r = String(a).localeCompare(String(b), "pt-BR", { numeric: true });
  return dir === "asc" ? r : -r;
}

export function SortableTable({
  columns,
  rows,
  initialSort = 0,
  initialDir,
  showRank = false
}: {
  columns: SortableColumn[];
  rows: SortableCell[][];
  /** Índice da coluna de ordenação inicial. */
  initialSort?: number;
  initialDir?: "asc" | "desc";
  /** Exibe coluna # com a posição na ordem atual. */
  showRank?: boolean;
}) {
  const [sortIdx, setSortIdx] = useState(initialSort);
  const [dir, setDir] = useState<"asc" | "desc">(
    initialDir ?? (columns[initialSort]?.numeric ? "desc" : "asc")
  );

  const sorted = useMemo(() => {
    return rows
      .map((row, i) => ({ row, i }))
      .sort((x, y) => {
        const r = compare(x.row[sortIdx]?.sort ?? null, y.row[sortIdx]?.sort ?? null, dir);
        return r !== 0 ? r : x.i - y.i; // estável
      })
      .map((x) => x.row);
  }, [rows, sortIdx, dir]);

  function onSort(idx: number) {
    if (idx === sortIdx) {
      setDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortIdx(idx);
      setDir(columns[idx]?.numeric ? "desc" : "asc");
    }
  }

  return (
    <div className="table-wrap dense-table-wrap">
      <table className="data-table dense-table">
        <thead>
          <tr>
            {showRank && <th>#</th>}
            {columns.map((col, idx) => {
              const active = idx === sortIdx;
              return (
                <th
                  key={col.label}
                  className={[col.numeric ? "numeric" : null, col.hint ? "th-has-hint" : null]
                    .filter(Boolean)
                    .join(" ") || undefined}
                  data-hint={col.hint}
                >
                  <button
                    type="button"
                    className={`th-sort${active ? " is-active" : ""}`}
                    onClick={() => onSort(idx)}
                    aria-label={`Ordenar por ${col.label}`}
                  >
                    <span>{col.label}</span>
                    {col.hint ? (
                      <>
                        {/* leitores de tela recebem a explicação; o visual é o tooltip do th */}
                        <span className="sr-only">{col.hint}</span>
                        <span className="th-hint-mark" aria-hidden="true">
                          ?
                        </span>
                      </>
                    ) : null}
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
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (showRank ? 1 : 0)}>
                <p className="empty-state table-empty">Nenhum item encontrado.</p>
              </td>
            </tr>
          ) : (
            sorted.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {showRank && <td className="rank-cell">{rowIdx + 1}</td>}
                {row.map((cell, cellIdx) => {
                  let content: React.ReactNode = cell.text;
                  if (cell.badge) {
                    content = <span className={cell.badge}>{cell.text}</span>;
                  } else if (cell.href) {
                    content = (
                      <Link className="row-link" href={cell.href}>
                        {cell.text}
                      </Link>
                    );
                  }
                  return (
                    <td key={cellIdx} className={columns[cellIdx]?.numeric ? "numeric" : undefined}>
                      {content}
                      {cell.subtitle ? <div className="row-subtitle">{cell.subtitle}</div> : null}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
