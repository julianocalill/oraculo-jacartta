"use client";

import { createContext, useContext, type ReactNode, type ComponentProps } from "react";
import NextLink from "next/link";
import { operationHref } from "@oraculo/domain/operations.js";

const OperationContext = createContext("uberlandia");
export const useOperation = () => useContext(OperationContext);
export function OperationProvider({ operation, children }: { operation: string; children: ReactNode }) {
  return <OperationContext.Provider value={operation}>{children}</OperationContext.Provider>;
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
