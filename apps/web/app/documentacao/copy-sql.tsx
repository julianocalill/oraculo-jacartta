"use client";

import { useState } from "react";

// Único client component da aba. A filosofia do repo é zero JS no cliente, mas
// o propósito desta área é justamente tirar SQL daqui e colar no Metabase, e
// selecionar texto num <pre> com rolagem horizontal é ruim de verdade (o
// arraste rola em vez de selecionar). Mesma justificativa das outras exceções
// deliberadas: sortable-table, calculator, leaflet-map.
//
// Renderiza só o botão — o <pre> continua no server component. Sem JS, o SQL
// segue selecionável e nada quebra.
export function CopySqlButton({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className={copied ? "copy-sql is-copied" : "copy-sql"} onClick={copy}>
      {copied ? "Copiado" : "Copiar SQL"}
    </button>
  );
}
