import { CopySqlButton } from "./copy-sql";

// O SQL rola dentro do próprio bloco (overflow-x: auto + white-space: pre),
// nunca o documento — mesma regra de .table-wrap, por causa do invariante
// .workspace > * { min-width: 0 }.
export function SqlBlock({ sql, title }: { sql: string; title?: string }) {
  return (
    <div className="sql-block">
      <div className="sql-block-head">
        <span>{title ?? "SQL"}</span>
        <CopySqlButton sql={sql} />
      </div>
      <pre>{sql}</pre>
    </div>
  );
}
