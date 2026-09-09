"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getColumnHint } from "../../lib/column-hints";

function headerLabel(header: HTMLTableCellElement) {
  const sortableLabel = header.querySelector<HTMLElement>(".th-sort > span:first-child");
  if (sortableLabel?.textContent?.trim()) return sortableLabel.textContent.trim();

  const copy = header.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".sr-only, .th-hint-mark, .th-caret").forEach((node) => node.remove());
  return copy.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

/**
 * Completa tabelas legadas que ainda renderizam <th> diretamente. Tabelas
 * ordenáveis já saem do React com a ajuda pronta; este reforço garante a mesma
 * experiência nas telas antigas e em novos cabeçalhos sem exigir marcação
 * duplicada em cada página.
 */
export function TableColumnHints() {
  const pathname = usePathname();

  useEffect(() => {
    let hintSequence = 0;

    function enhanceHeaders() {
      document
        .querySelectorAll<HTMLTableCellElement>("table.data-table thead th")
        .forEach((header) => {
          const label = headerLabel(header);
          const hasAuthoredHint = Boolean(header.dataset.hint)
            && header.dataset.columnHintGenerated !== "true";
          const hint = hasAuthoredHint
            ? header.dataset.hint!
            : getColumnHint(label, pathname);

          header.dataset.hint = hint;
          if (!hasAuthoredHint) header.dataset.columnHintGenerated = "true";
          header.classList.add("th-has-hint");
          header.title = hint;

          if (!header.querySelector(".th-hint-mark")) {
            const mark = document.createElement("span");
            mark.className = "th-hint-mark";
            mark.setAttribute("aria-hidden", "true");
            mark.textContent = "?";
            header.append(mark);
          }

          const existingAccessibleHint = header.querySelector<HTMLElement>(".column-hint-accessible");
          if (existingAccessibleHint) {
            // MutationObserver observa childList. Reatribuir o mesmo
            // textContent substitui o nó de texto e dispara o observer de
            // novo, criando um loop que trava páginas com tabelas.
            if (existingAccessibleHint.textContent !== hint) {
              existingAccessibleHint.textContent = hint;
            }
          } else if (!header.querySelector(".sr-only")) {
            const accessibleHint = document.createElement("span");
            accessibleHint.className = "sr-only column-hint-accessible";
            accessibleHint.id = `column-hint-${hintSequence++}`;
            accessibleHint.textContent = hint;
            header.append(accessibleHint);
            header.setAttribute("aria-describedby", accessibleHint.id);
          }

          // Cabeçalhos estáticos precisam receber foco para abrir a explicação
          // por teclado ou toque. Os ordenáveis já possuem um botão focável.
          if (!header.querySelector("button, a")) header.tabIndex = 0;
        });
    }

    enhanceHeaders();
    const observer = new MutationObserver(enhanceHeaders);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [pathname]);

  return null;
}
