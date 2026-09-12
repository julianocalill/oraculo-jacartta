"use client";
import { useOperation } from "../../components/operation-provider";
import { operationHref } from "@oraculo/domain/operations.js";

import { useEffect } from "react";

/**
 * Dispara o download do ZIP assim que a página do lote aprovado abre com
 * `?baixar=1`. Mesma ideia do `print-trigger.tsx` da etiqueta de palete: um
 * efeito de uma linha para o passo final acontecer sozinho, com o botão manual
 * continuando na tela como caminho de sempre.
 *
 * Usa `location.assign` em vez de `<a>.click()` porque a rota devolve
 * `Content-Disposition: attachment` — o navegador baixa e a página fica onde
 * está, sem navegar para lugar nenhum.
 */
export function DownloadTrigger({ href }: { href: string }) {
  const operation = useOperation();
  useEffect(() => {
    const timer = window.setTimeout(() => window.location.assign(operationHref(href, operation)), 400);
    return () => window.clearTimeout(timer);
  }, [href, operation]);
  return null;
}
