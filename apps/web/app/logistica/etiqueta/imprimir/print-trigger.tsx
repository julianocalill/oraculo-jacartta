"use client";

import { useEffect } from "react";

/**
 * Abre a caixa de impressão sozinha ao carregar.
 *
 * É o único JS da tela: o resto da etiqueta é HTML renderizado no servidor,
 * então se o print automático falhar (bloqueio do navegador, impressão
 * cancelada) a página continua completa e o Ctrl+P manual funciona igual.
 */
export function PrintTrigger() {
  useEffect(() => {
    const timer = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
