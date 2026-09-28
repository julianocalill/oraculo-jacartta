"use client";

import { createContext, useContext, type ReactNode, type ComponentProps } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { operationHref, parseOperationPath } from "@oraculo/domain/operations.js";

const OperationContext = createContext("uberlandia");
export const useOperation = () => useContext(OperationContext);
export function OperationProvider({ operation, children }: { operation: string; children: ReactNode }) {
  // O layout raiz é preservado nas navegações do Next. A operação inicial que
  // veio do servidor pode ficar antiga depois de trocar MG ↔ SP pelo seletor.
  // A URL visível é a fonte atual para todos os links e formulários clientes.
  const pathname = usePathname();
  const activeOperation = parseOperationPath(pathname ?? "").operation?.id ?? operation;
  return <OperationContext.Provider value={activeOperation}>{children}</OperationContext.Provider>;
}

export function OperationLink({ href, ...props }: ComponentProps<typeof NextLink>) {
  const operation = useOperation();
  const target = typeof href === "string" ? operationHref(href, operation)
    : { ...href, pathname: operationHref(href.pathname ?? "/", operation) };
  return <NextLink {...props} href={target} />;
}

export function OperationAnchor({ href, ...props }: ComponentProps<"a">) {
  const operation = useOperation();
  return <a {...props} href={href ? operationHref(href, operation) : href} />;
}

export function OperationForm({ action, ...props }: ComponentProps<"form">) {
  const operation = useOperation();
  return <form {...props} action={typeof action === "string" ? operationHref(action, operation) : action} />;
}
